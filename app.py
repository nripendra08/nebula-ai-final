import os, re, uuid, random, time, math, hashlib
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)
SESSIONS = {}
RECENT_QUESTIONS = {}
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '').strip()
DEMO_MODE = os.getenv('DEMO_MODE', 'true').lower() == 'true'
client = None
if OPENAI_API_KEY and not DEMO_MODE:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        client = None

STOPWORDS=set('the a an and or of to in on for with is are was were be been this that it as at by from into about how what why when where which who you your i we they he she our their have has had do did can could would should will may might'.split())
TECH=set('python java javascript typescript c cpp csharp flask django fastapi react node express html css sql mysql sqlite postgresql mongodb redis docker kubernetes aws azure gcp git github api rest graphql spring boot machine learning ml ai tensorflow pytorch pandas numpy linux cloud kafka microservices oop dsa dbms networking'.split())
JUNK={'asdf','asdfgh','qwerty','qwertyui','qazwsx','zxcvbn','aaaa','aaaaaa','xxxx','xxxxx','random','blah','xyz','lol','test','testing','none','nothing','nonsense'}
QUESTION_TEMPLATES={
'project':['Walk me through {topic}. What problem did it solve, what was your specific contribution, and what technical decision mattered most?','You listed {topic} on your resume. What was the hardest technical challenge you faced, and how did you solve it?','If you had to improve {topic} for a larger number of users, what would you change first and why?'],
'skill':['You list {topic} as a skill. Tell me about a real situation where you used it and explain the key decision you made.','How have you applied {topic} in a project or practical setting? Walk me through your approach and the result.','What is one difficult problem you have solved using {topic}, and what trade-off did you make?'],
'experience':['Tell me about your work on {topic}. What did you personally own, and what was the most challenging part?','What impact did you have in {topic}, and how did you measure whether your work was successful?'],
'education':['Which part of your academic background has prepared you most for a {role} role, and how have you applied it outside the classroom?'],
'role':['For a {role} role, how would you approach a problem where the requirements are incomplete or changing?','What technical area would you prioritize learning for a {role} position, and why?'],
'problem':['Imagine a production feature suddenly becomes slow. How would you investigate it step by step before changing anything?','You inherit a system you did not build and a bug appears under load. How would you isolate the root cause?'],
'system':['Design a service for a {role} product that must handle rapid growth. What would you decide first, and why?']}

def words(t): return re.findall(r"[A-Za-z][A-Za-z0-9+#.-]*",t or '')
def clean_topic(s): return re.sub(r'\s+',' ',re.sub(r'[^A-Za-z0-9+.#/& -]',' ',s or '').strip())[:100]

def extract_uploaded_resume(file):
    if not file or not file.filename:return ''
    name=file.filename.lower()
    try:
        if name.endswith('.txt'): return file.read().decode('utf-8',errors='ignore')
        if name.endswith('.pdf'):
            from pypdf import PdfReader
            return '\n'.join((p.extract_text() or '') for p in PdfReader(file.stream).pages)
        if name.endswith('.docx'):
            from docx import Document
            return '\n'.join(p.text for p in Document(file.stream).paragraphs)
    except Exception:return ''
    return ''

def uniq(xs):
    out=[];seen=set()
    for x in xs:
        k=x.lower()
        if k not in seen and len(x)>3:seen.add(k);out.append(x)
    return out[:10]

def extract_profile(resume,role):
    text=resume or '';low=text.lower();skills=[]
    for t in sorted(TECH,key=len,reverse=True):
        if re.search(r'(?<![\w])'+re.escape(t)+r'(?![\w])',low):skills.append(t)
    for t in re.findall(r'\b(?:communication|leadership|problem solving|data structures|algorithms|software testing|unit testing|system design|prompt engineering|natural language processing|computer vision|communication skills)\b',low):
        if t not in skills:skills.append(t)
    projects=[];experience=[];education=[];section=''
    for raw in text.splitlines():
        line=raw.strip()
        if not line:continue
        ll=line.lower().rstrip(':')
        if any(k in ll for k in ['project','projects']):section='projects';continue
        if any(k in ll for k in ['experience','internship','work experience']):section='experience';continue
        if any(k in ll for k in ['education','academic']):section='education';continue
        if line.startswith(('-','•','*')):
            val=clean_topic(line.lstrip('-•* ').strip())
            if len(val)>=5:
                {'projects':projects,'experience':experience,'education':education}.get(section,[]).append(val)
    if not projects:
        projects += [clean_topic(m) for m in re.findall(r'(?:project|built|developed|created|application|portal|manager)[:\- ]+([A-Z][A-Za-z0-9 &_-]{3,60})',text)]
    if not education:
        education += [clean_topic(m) for m in re.findall(r'((?:B\.?Tech|B\.?E\.?|M\.?Tech|M\.?S\.?|Bachelor|Master)[^\n]{0,100})',text,re.I)]
    profile={'skills':uniq(skills),'projects':uniq(projects),'experience':uniq(experience),'education':uniq(education),'role':role}
    profile['strengths']=profile['skills'][:6]
    profile['resume_depth']=min(12,2+len(profile['skills'])+2*len(profile['projects'])+2*len(profile['experience']))
    return profile

def make_topics(p,role):
    topics=[]
    for x in p['projects']:topics.append({'topic':x,'kind':'project','priority':5})
    for x in p['experience']:topics.append({'topic':x,'kind':'experience','priority':5})
    for x in p['skills'][:12]:topics.append({'topic':x,'kind':'skill','priority':4})
    if p['education']:topics.append({'topic':p['education'][0],'kind':'education','priority':2})
    topics += [{'topic':'role-fit','kind':'role','priority':3},{'topic':'problem-solving','kind':'problem','priority':4}]
    return topics

def question_for(s,followup=False):
    if followup and s.get('last_topic'):
        t=s['last_topic'];k=s.get('last_kind','skill')
        qs=[f'You mentioned {t}. What trade-off did you consider before choosing your approach?',f'Going one level deeper on {t}: how did you test or validate that your solution actually worked?',f'If you rebuilt {t} today, what would you change and why?',f'What failure mode would you expect in {t}, and how would you detect it early?']
        recent=set(s.get('used_questions',[])); choices=[q for q in qs if q not in recent] or qs
        q=random.SystemRandom().choice(choices)
    else:
        candidates=[t for t in s['topics'] if t['topic'] not in s['covered']] or s['topics']
        mx=max(t['priority'] for t in candidates);pool=[t for t in candidates if t['priority']>=mx-1]
        # Use secure per-start randomness and avoid the exact questions used by recent sessions
        # with the same resume. The same resume still drives topics, but starts no longer repeat the same prompt by default.
        chosen=random.SystemRandom().choice(pool)
        qs=QUESTION_TEMPLATES.get(chosen['kind'],QUESTION_TEMPLATES['skill'])
        recent=set(s.get('used_questions',[]))|set(RECENT_QUESTIONS.get(s['resume_key'],[]))
        formatted=[x.format(topic=chosen['topic'],role=s['role']) for x in qs]
        available=[x for x in formatted if x not in recent] or formatted
        q=random.SystemRandom().choice(available)
    if q not in s.setdefault('used_questions',[]): s['used_questions'].append(q)
    RECENT_QUESTIONS.setdefault(s['resume_key'],[]).append(q)
    RECENT_QUESTIONS[s['resume_key']]=RECENT_QUESTIONS[s['resume_key']][-8:]
    return {'category':('Adaptive Follow-up' if followup else s.get('last_kind', 'skill').replace('_',' ').title()) if followup else chosen['kind'].replace('_',' ').title(),'question':q,'topic':t if followup else chosen['topic'],'kind':k if followup else chosen['kind'],'followup':followup,'why':'NEBULA is probing deeper into evidence from your previous response.' if followup else f'NEBULA selected {chosen["kind"]} evidence from your profile and current interview coverage.'}

def gibberish(a):
    a=a.strip().lower();ws=words(a)
    if not ws or a in JUNK:return True
    alpha=re.sub('[^a-z]','',a)
    if len(alpha)>=10 and not re.search('[aeiou]',alpha):return True
    if re.search(r'(.)\1{7,}',a):return True
    if len(ws)<=2 and max(map(len,ws))>20:return True
    if len(a)>20 and len(re.sub(r'[a-z0-9\s.,!?+#/&-]','',a))/len(a)>.25:return True
    return False

def answer_quality(a,q,p):
    ws=words(a)
    if not a.strip():return False,'Please provide a response before continuing.','garbage'
    if gibberish(a):return False,'This response is not a meaningful interview answer. NEBULA will move to another question.','garbage'
    if len(ws)<3:return False,'This response is too short to evaluate. NEBULA will move to another question.','weak'
    text=a.lower();topic=(q.get('topic') or '').lower()
    terms=set(re.findall(r'[a-z0-9+#.]+',topic))|set(re.findall(r'[a-z0-9+#.]+',' '.join(p.get('skills',[])+p.get('projects',[])+p.get('experience',[])).lower()))|set(re.findall(r'[a-z0-9+#.]+',p.get('role','').lower()))
    terms-=STOPWORDS
    markers={'because','approach','built','developed','implemented','tested','debug','solved','result','challenge','project','experience','used','designed','created','learned','improved','measured','decided','chose','trade-off','tradeoff','reason','impact'}
    hits=sum(1 for t in terms if t in text);marks=sum(1 for m in markers if m in text)
    if len(ws)<=7 and hits==0 and marks==0:return False,'That response did not provide enough evidence for this question. NEBULA will move on.','weak'
    return True,'','meaningful'

def score_answer(a,q,p):
    ws=words(a);text=a.lower();topic=(q.get('topic') or '').lower();topic_tokens=set(re.findall(r'[a-z0-9+#.]+',topic))-STOPWORDS
    topical=sum(1 for t in topic_tokens if t in text);markers=sum(1 for m in ['because','approach','trade-off','tradeoff','tested','validated','result','impact','challenge','decision','designed','implemented','measured','improved'] if m in text)
    relevance=min(1,.55+.12*topical+.03*min(5,markers));content=min(1,.5+.035*min(12,len(ws))+(.08 if topical else 0));depth=min(1,.35+.1*min(5,markers)+.05*min(4,topical));evidence=min(1,.35+.11*min(5,markers)+.04*min(4,topical));communication=min(1,.55+.015*min(25,len(ws)))
    dims={'Relevance':round(relevance*25),'Technical / Content Quality':round(content*25),'Reasoning & Depth':round(depth*20),'Evidence & Examples':round(evidence*15),'Communication':round(communication*15)}
    return max(0,min(100,sum(dims.values()))),dims

def integrity_risk(meta,answer):
    sig=[];wc=len(words(answer));elapsed=float(meta.get('elapsed_ms') or 0);pasted=int(meta.get('paste_chars') or 0);tab=int(meta.get('tab_switches') or 0)
    # Normal keyboard typing is allowed. Do not treat fast typing speed as a cheating signal.
    # Integrity events rely on explicit signals such as large clipboard insertion, tab exits,
    # camera interruption, audio anomalies, or speaker-change heuristics.
    if pasted>=35:sig.append('large_text_insertion')
    if tab>=2:sig.append('repeated_page_exit')
    if meta.get('camera_lost'):sig.append('camera_interruptions')
    if meta.get('audio_anomaly'):sig.append('audio_activity')
    if meta.get('speaker_change'):sig.append('speaker_change')
    risk=min(100,len(sig)*24+(15 if wc>=100 and elapsed<5000 else 0))
    return risk,sig

def register_integrity_event(s,event,meta=None):
    now=time.time();meta=meta or {};state=s.setdefault('integrity_state',{'warnings':0,'terminated':False,'recent':[],'last_alert':0})
    s['integrity_events'].append({'event':event,'t':now,'meta':meta});state['recent']=[x for x in state['recent'] if now-x['t']<=20];state['recent'].append({'event':event,'t':now})
    same=[x for x in state['recent'] if x['event']==event];distinct={x['event'] for x in state['recent']}
    should=False
    if event=='tab_switch':
        # Each genuine page exit is one integrity warning, with a short debounce
        # on the client to prevent duplicate visibility events from one action.
        should=now-state.get('last_alert',0)>1.0
    elif event=='speaker_change':
        should=now-state.get('last_alert',0)>5
    elif len(distinct)>=2 and now-state.get('last_alert',0)>6:should=True
    elif len(same)>=3 and now-state.get('last_alert',0)>10:should=True
    if should:
        state['warnings']+=1;state['last_alert']=now;s['integrity_alerts']=state['warnings']
        if state['warnings']>=3:state['terminated']=True
    return state['warnings'],state['terminated']

def competency_update(s,q,score):
    kind=q.get('kind','skill');mapping={'skill':'Technical Knowledge','project':'Role Fit','experience':'Role Fit','problem':'Problem Solving','education':'Technical Knowledge','role':'Role Fit','system':'System Design'};comp=mapping.get(kind,'Depth & Reasoning')
    s['competencies'].setdefault(comp,[]).append(score);s['competencies'].setdefault('Communication',[]).append(score)
    if q.get('followup'):s['competencies'].setdefault('Depth & Reasoning',[]).append(score)

def report(s):
    terminated=s.get('integrity_state',{}).get('terminated',False);qs=s['answers']
    if terminated:
        return {'overall':None,'invalidated':True,'question_scores':[],'competencies':{},'strengths':[],'gaps':[],'recommendations':['This attempt was invalidated because the integrity monitor reached its three-warning termination threshold. Start a new interview for a valid performance assessment.'],'integrity':{'status':'Interview Integrity Failed','alerts':s['integrity_alerts'],'timeline':s['integrity_events']},'profile':s['profile'],'evidence':s['evidence'],'replay':s['replay']}
    overall=round(sum(x['score'] for x in qs)/len(qs)) if qs else 0;comps={k:round(sum(v)/len(v)) for k,v in s['competencies'].items() if v};strengths=[];gaps=[]
    if overall>=80:strengths.append('Consistent, relevant interview performance with structured responses.')
    if comps.get('Technical Knowledge',0)>=80:strengths.append('Strong technical understanding in the areas discussed.')
    if comps.get('Problem Solving',0)>=80:strengths.append('Structured approach to diagnosing and solving problems.')
    for k,v in comps.items():
        if v<70:gaps.append(f'{k} needs deeper, more evidence-based responses.')
    if not gaps:gaps.append('Continue improving depth by explaining trade-offs, validation, and measurable outcomes.')
    recs=['Use a situation → decision → trade-off → result structure for stronger answers.','Tie technical claims to concrete project evidence and measurable outcomes.']
    if comps.get('System Design',0)<70:recs.append('Practice scalability, caching, database design and failure-handling scenarios.')
    return {'overall':overall,'invalidated':False,'question_scores':[{'number':i+1,'score':x['score'],'question':x['question'],'answer':x['answer'],'category':x['category'],'why':x['why'],'dims':x['dims']} for i,x in enumerate(qs)],'competencies':comps,'strengths':strengths[:4],'gaps':gaps[:5],'recommendations':recs[:5],'integrity':{'status':'Ended by Candidate' if s.get('manually_ended') else ('Review Required' if s['integrity_alerts'] else 'Passed'),'alerts':s['integrity_alerts'],'timeline':s['integrity_events']},'profile':s['profile'],'evidence':s['evidence'],'replay':s['replay']}

@app.get('/')
def index():return render_template('index.html')
@app.get('/api/health')
def health():return jsonify({'ok':True,'mode':'ai' if client else 'demo'})
@app.get('/api/dashboard')
def dashboard():
    rows=[]
    for sid,s in SESSIONS.items():
        r=report(s);rows.append({'session_id':sid,'role':s['role'],'created':s['created'],'status':r['integrity']['status'],'overall':r['overall'],'questions':len(s['answers'])})
    return jsonify({'ok':True,'assessments':sorted(rows,key=lambda x:x['created'],reverse=True)})
@app.post('/api/start')
def start():
    d=request.form if request.form else (request.get_json(silent=True) or {});role=(d.get('role') or 'Software Engineer').strip();mode=(d.get('mode') or 'text').strip();uploaded=request.files.get('resume_file');resume=extract_uploaded_resume(uploaded) if uploaded else (d.get('resume') or '').strip()
    if not resume.strip(): return jsonify({'ok':False,'error':'Resume upload required. Please upload a PDF, DOCX, or TXT resume before starting the interview.'}),400
    p=extract_profile(resume,role);sid=str(uuid.uuid4())
    s={'role':role,'mode':mode,'resume':resume[:12000],'resume_key':hashlib.sha256(resume.strip().lower().encode('utf-8',errors='ignore')).hexdigest(),'used_questions':[],'profile':p,'topics':make_topics(p,role),'covered':set(),'answers':[],'competencies':{},'integrity_alerts':0,'integrity_events':[],'integrity_state':{'warnings':0,'terminated':False,'recent':[],'last_alert':0},'invalid_answers':0,'created':time.time(),'evidence':[],'replay':[],'voice_profile':None}
    q=question_for(s);s['current']=q;s['last_topic']=q['topic'];s['last_kind']=q['kind'];SESSIONS[sid]=s
    return jsonify({'ok':True,'session_id':sid,'role':role,'profile':p,'question':q,'question_number':1,'adaptive':True,'monitoring':{'camera':True,'microphone':True,'interaction':True,'speaker_consistency':True}})
@app.post('/api/integrity-event')
def integrity_event():
    d=request.get_json(silent=True) or {};s=SESSIONS.get(d.get('session_id'))
    if not s:return jsonify({'ok':False}),404
    warnings,terminated=register_integrity_event(s,d.get('event') or 'unknown',d.get('meta',{}))
    return jsonify({'ok':True,'warnings':warnings,'terminated':terminated,'event':d.get('event') or 'unknown','report':report(s) if terminated else None})
@app.post('/api/voice-profile')
def voice_profile():
    d=request.get_json(silent=True) or {};s=SESSIONS.get(d.get('session_id'))
    if not s:return jsonify({'ok':False}),404
    feats=d.get('features') or []
    if not isinstance(feats,list) or len(feats)<3:return jsonify({'ok':False,'error':'Not enough voice data'}),400
    s['voice_profile']={'baseline':feats[-1],'samples':len(feats),'created':time.time()}
    return jsonify({'ok':True,'speaker_consistency':True})
@app.post('/api/answer')
def answer():
    d=request.get_json(silent=True) or {};s=SESSIONS.get(d.get('session_id'))
    if not s:return jsonify({'ok':False,'error':'Interview session expired. Please restart.'}),404
    if s.get('integrity_state',{}).get('terminated'):return jsonify({'ok':True,'finished':True,'terminated':True,'report':report(s)})
    a=(d.get('answer') or '').strip();meta=d.get('integrity') or {};risk,signals=integrity_risk(meta,a);warnings=s.get('integrity_alerts',0);terminated=False
    for sig in signals:warnings,terminated=register_integrity_event(s,sig,{'risk':risk})
    if terminated:return jsonify({'ok':True,'valid':False,'finished':True,'terminated':True,'message':'Interview integrity failed. This assessment has been invalidated.','report':report(s),'warnings':warnings})
    q=s['current'];ok,msg,quality=answer_quality(a,q,s['profile'])
    if not ok:
        s['invalid_answers']+=1
        if s['invalid_answers']>=2:return jsonify({'ok':True,'valid':False,'finished':True,'terminated':False,'message':'NEBULA received repeated non-evaluable responses. The interview has ended.','report':report(s),'warnings':warnings})
        nq=question_for(s);s['current']=nq;s['replay'].append({'type':'skip','question':q['question'],'reason':msg,'at':time.time()})
        return jsonify({'ok':True,'valid':False,'skipped':True,'finished':False,'question':nq,'question_number':len(s['answers'])+1,'message':msg,'warnings':warnings})
    score,dims=score_answer(a,q,s['profile']);s['answers'].append({'question':q['question'],'category':q['category'],'score':score,'dims':dims,'answer':a,'why':q.get('why','')});competency_update(s,q,score);s['covered'].add(q.get('topic',''));s['last_topic']=q.get('topic');s['last_kind']=q.get('kind');s['invalid_answers']=0
    s['evidence'].append({'claim':q.get('topic','Interview response'),'status':'Demonstrated','detail':f'Candidate provided evidence while discussing {q.get("topic","the topic")}.','score':score})
    s['replay'].append({'type':'answer','question':q['question'],'score':score,'at':time.time(),'followup':q.get('followup',False)})
    evidence=len(s['covered']);target=max(3,min(12,2+round(s['profile']['resume_depth']/2)));should_follow=score<72 or (q.get('kind') in {'project','experience'} and score<86);enough=evidence>=target and len(s['answers'])>=max(3,min(6,target))
    if len(s['answers'])>=20 or (enough and not should_follow):return jsonify({'ok':True,'valid':True,'finished':True,'report':report(s),'warnings':warnings})
    nq=question_for(s,followup=should_follow);s['current']=nq;return jsonify({'ok':True,'valid':True,'finished':False,'question':nq,'question_number':len(s['answers'])+1,'warnings':warnings})
@app.post('/api/end')
def end():
    d=request.get_json(silent=True) or {};s=SESSIONS.get(d.get('session_id'))
    if not s:return jsonify({'ok':False}),404
    s['manually_ended']=True;return jsonify({'ok':True,'report':report(s)})
if __name__=='__main__':app.run(debug=True,port=5000)
