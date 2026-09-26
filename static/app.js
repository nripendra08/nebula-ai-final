const $=id=>document.getElementById(id);
let state={session:null,question:null,questionNumber:1,questionShownAt:0,pasteChars:0,tabSwitches:0,stream:null,audioCtx:null,analyser:null,audioAnomaly:false,integrityWarnings:0,terminating:false,mode:'text',voiceBaseline:null,voiceFeatures:[],recognition:null,speakerCooldown:0,calibrationRecognition:null,calibrationTranscript:'',calibrationSpeechDetected:false,voiceVisualizer:null,ambientNoise:0,environmentModel:null,environmentTimer:null,environmentLastScan:0,environmentScanReady:false,environmentIssues:{phone:false,people:false}};
const setup=$('setup-screen'), readiness=$('readiness-screen'), interview=$('interview-screen'), report=$('report-screen'), dashboard=$('dashboard-screen');
for(let i=0;i<28;i++){const b=document.createElement('i');b.style.height='8%';$('voice-visualizer')?.appendChild(b)}
for(const id of ['passive-voice-visualizer','interview-voice-visualizer']){const host=$(id);if(host)for(let i=0;i<24;i++){const b=document.createElement('i');b.style.height='8%';host.appendChild(b)}}
let passiveVoiceMeterStarted=false;
function startPassiveVoiceMeter(){if(passiveVoiceMeterStarted||!state.analyser)return;passiveVoiceMeterStarted=true;const data=new Uint8Array(state.analyser.fftSize);const update=()=>{if(!state.analyser){requestAnimationFrame(update);return}state.analyser.getByteTimeDomainData(data);let mean=0;for(const x of data)mean+=x;mean/=data.length;let sum=0;for(const x of data){const v=(x-mean)/128;sum+=v*v}const rms=Math.sqrt(sum/data.length);const level=Math.min(1,Math.max(0,(rms-0.004)/0.09));const pct=Math.round(level*100);for(const id of ['passive-voice-meter-fill','interview-voice-meter-fill'])$(id)&&( $(id).style.width=pct+'%');const label=level>.34?'Strong signal':level>.13?'Voice activity':level>.035?'Low signal':'Quiet';const stateIds=['passive-voice-level','interview-voice-level'];stateIds.forEach(id=>{const el=$(id);if(el)el.textContent=label});['passive-voice-visualizer','interview-voice-visualizer'].forEach(id=>{const host=$(id);if(!host)return;const bars=host.querySelectorAll('i');bars.forEach((b,i)=>{const wave=Math.max(0,level*(0.45+0.55*Math.abs(Math.sin(i*.72+performance.now()/170))));b.style.height=(6+wave*88)+'%';b.style.opacity=String(.28+wave*.72)})});requestAnimationFrame(update)};requestAnimationFrame(update)}
$('resume').addEventListener('change',()=>{$('file-name').textContent=$('resume').files[0]?.name||'No file selected'});
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.mode='text'})); state.mode='text';
$('answer').addEventListener('input',e=>{$('word-count').textContent=`${(e.target.value.trim().match(/\S+/g)||[]).length} words`;$('typing-state').textContent='Typing…'});
$('answer').addEventListener('paste',e=>{const n=(e.clipboardData?.getData('text')||'').length;state.pasteChars+=n;sendEvent('large_paste',{chars:n})});
document.addEventListener('visibilitychange',()=>{if(state.session&&document.hidden){const now=Date.now();if(!state.lastTabSwitchAt||now-state.lastTabSwitchAt>1500){state.tabSwitches++;state.lastTabSwitchAt=now;sendEvent('tab_switch',{count:state.tabSwitches})}}});
window.addEventListener('beforeunload',()=>{if(state.session)navigator.sendBeacon('/api/integrity-event',new Blob([JSON.stringify({session_id:state.session,event:'page_exit'})],{type:'application/json'}))});
async function sendEvent(event,meta){if(!state.session||state.terminating)return;try{const r=await fetch('/api/integrity-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:state.session,event,meta})});const d=await r.json();handleIntegrityResult(d)}catch(e){}}
function integrityReason(event){const map={large_paste:{title:'Clipboard content detected',text:'A large amount of text was inserted from the clipboard. Please answer in your own words.'},repeated_page_exit:{title:'Repeated tab switching detected',text:'NEBULA detected repeated exits from the assessment page. Keep the interview tab active.'},camera_interruptions:{title:'Camera interruption detected',text:'The camera feed was interrupted during the assessment. Keep your camera connected.'},visible_phone:{title:'Possible phone detected',text:'NEBULA detected a mobile phone in the camera frame. Please keep external devices away from the assessment.'},multiple_people:{title:'Additional person detected',text:'NEBULA detected more than one visible person in the camera frame. Please complete the assessment alone.'},speaker_change:{title:'Possible additional speaker detected',text:'NEBULA detected a sustained voice pattern that differs from your calibrated voice. A brief cough or short noise does not trigger this warning.'},audio_activity:{title:'Unusual audio activity detected',text:'NEBULA detected an unusual sustained audio pattern. Short coughs, sneezes and normal room sounds are not treated as violations.'},page_exit:{title:'Assessment page exit detected',text:'The assessment page was exited or closed while the interview was active.'}};return map[event]||{title:'Integrity signal detected',text:'NEBULA detected unusual assessment activity. Please continue independently and keep the assessment environment clear.'}}
function showIntegrityWarning(count,event){state.integrityWarnings=Math.max(state.integrityWarnings,count||0);$('integrity-alert').classList.remove('hidden');$('integrity-count').textContent=`${state.integrityWarnings}/3`;const failed=state.integrityWarnings>=3;const reason=integrityReason(event);$('integrity-alert-title').textContent=failed?'Interview Integrity Failed':reason.title;$('integrity-alert-text').textContent=failed?'Three integrity warnings were recorded. This interview has been terminated and marked for review.':`${reason.text} You have ${3-state.integrityWarnings} warning${3-state.integrityWarnings===1?'':'s'} remaining.`;if(failed){$('submit-btn').disabled=true;$('answer').disabled=true;}}
function handleIntegrityResult(d){if(!d?.ok)return;if(d.terminated){state.terminating=true;window.__pendingReport=d.report||window.__pendingReport;showIntegrityWarning(3,d.event);if(window.__pendingReport){setTimeout(()=>showReport(window.__pendingReport),180);}}else if(d.warnings){showIntegrityWarning(d.warnings,d.event)}}
async function mediaSetup(){try{const AC=window.AudioContext||window.webkitAudioContext; if(!AC)throw Error('AudioContext unavailable'); state.audioCtx=new AC(); await state.audioCtx.resume(); state.stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});const rv=$('readiness-camera');if(rv)rv.srcObject=state.stream;$('readiness-camera-placeholder').classList.add('hidden');$('readiness-camera-text').textContent='Camera connected';$('readiness-audio-text').textContent='Microphone connected';setCheck('camera',true,'Camera connected');setCheck('mic',true,'Microphone connected');const vt=state.stream.getVideoTracks()[0],at=state.stream.getAudioTracks()[0];if(vt)vt.addEventListener('ended',()=>{if(state.session){$('cam-text').textContent='Interrupted';sendEvent('camera_lost',{})}});if(at)at.addEventListener('ended',()=>{if(state.session){$('mic-text').textContent='Interrupted';sendEvent('microphone_lost',{})}});const src=state.audioCtx.createMediaStreamSource(state.stream),an=state.audioCtx.createAnalyser();an.fftSize=512;an.smoothingTimeConstant=0.12;src.connect(an);state.analyser=an;await state.audioCtx.resume();await checkAudioEnvironment(an);return true}catch(e){return false}}
function setCheck(name,ok,text){const row=$('check-'+name);if(!row)return;row.classList.toggle('ready',!!ok);row.classList.toggle('failed',ok===false);const t=$('check-'+name+'-text');if(t)t.textContent=text;const status=row.querySelector('strong');if(status)status.textContent=ok?'✓':'—'}
function updateEnvironmentGate(){
  const issues=state.environmentIssues||{};
  const blocked=!!(issues.phone||issues.people)||!state.voiceBaseline;
  const btn=$('begin-interview');
  if(btn) btn.disabled=blocked;
  const err=$('readiness-error');
  if(err){
    const reasons=[];
    if(issues.phone) reasons.push('remove the visible phone');
    if(issues.people) reasons.push('make sure only you are visible');
    if(!state.voiceBaseline) reasons.push('complete voice calibration');
    if(reasons.length) err.textContent=`Action required before starting: ${reasons.join(' and ')}.`;
    else if(err.textContent.startsWith('Action required before starting:')) err.textContent='';
  }
}

function updateEnvironmentSignal(kind,status,title,detail){const root=document.querySelector(`[data-env-signal="${kind}"]`);if(!root)return;root.className=`environment-signal ${status}`;root.querySelector('b').textContent=title;root.querySelector('small').textContent=detail;root.querySelector('strong').textContent=status==='warn'?'Action needed':status==='ok'?'Clear':'Scanning'}
function ensureEnvironmentSignal(kind,label,detail){const list=$('environment-signal-list');if(!list)return;if(list.querySelector(`[data-env-signal="${kind}"]`))return;const el=document.createElement('div');el.className='environment-signal neutral';el.dataset.envSignal=kind;el.innerHTML=`<span class="signal-dot"></span><div><b>${label}</b><small>${detail}</small></div><strong>Scanning</strong>`;list.appendChild(el)}
async function startEnvironmentScan(){
  ensureEnvironmentSignal('phone','Phone check','Fast camera scan for a visible mobile phone.');
  ensureEnvironmentSignal('people','People check','Fast face/person check for more than one visible person.');
  const stateLabel=$('environment-scan-state'), row=$('check-environment'), rowText=$('check-environment-text'), rowStatus=$('check-environment-status');
  if(!state.stream?.getVideoTracks()?.length){if(stateLabel)stateLabel.textContent='Camera unavailable';return;}
  try{
    // Two lightweight paths: BlazeFace checks people quickly; COCO-SSD is reserved for phones.
    if(!state.faceModel && window.blazeface){
      if(stateLabel)stateLabel.textContent='Loading fast face scan…';
      state.faceModel=await blazeface.load();
    }
    if(!state.environmentModel && window.cocoSsd){
      // Start phone model loading in the background. Do not block the interview/readiness flow.
      state.environmentModelPromise=cocoSsd.load({base:'lite_mobilenet_v2'}).then(m=>{state.environmentModel=m;return m}).catch(()=>null);
    }
    state.environmentScanReady=true;
    if(stateLabel)stateLabel.textContent='Live camera environment scan active';
    if(rowText)rowText.textContent='Fast people scan active · phone scan running in background';
    if(rowStatus)rowStatus.textContent='✓'; row?.classList.add('ready');
    let faceBusy=false, phoneBusy=false, lastFace=0, lastPhone=0, cropIndex=0, lastCrop=0;
    const canvas=state.environmentScanCanvas||(state.environmentScanCanvas=document.createElement('canvas'));
    canvas.width=320;canvas.height=200;
    const ctx=canvas.getContext('2d',{willReadFrequently:false});
    const crops=[[0,0,.72,.72],[.28,0,.72,.72],[0,.28,.72,.72],[.28,.28,.72,.72]];
    const scan=async()=>{
      const activeVideo=readiness.classList.contains('hidden') ? $('camera') : $('readiness-camera');
      if(!activeVideo?.videoWidth){state.environmentTimer=requestAnimationFrame(scan);return;}
      const now=performance.now();
      // People: lightweight face model, target ~3-4 checks/sec.
      if(!faceBusy && state.faceModel && now-lastFace>=260){
        faceBusy=true;lastFace=now;
        try{
          const faces=await state.faceModel.estimateFaces(activeVideo,false,{returnTensors:false,flipHorizontal:false});
          const count=faces?.length||0;
          state.environmentPeopleCount=count;
          state.environmentPeopleHits=count>1?Math.min(5,(state.environmentPeopleHits||0)+1):Math.max(0,(state.environmentPeopleHits||0)-1.5);
          if(count>1){
            state.environmentIssues.people=true;
            updateEnvironmentSignal('people','warn','Multiple people detected',`${count} visible faces are in the camera frame.`);
            if(readiness.classList.contains('hidden')&&state.environmentPeopleHits>=2&&(!state.environmentPeopleAlertAt||Date.now()-state.environmentPeopleAlertAt>10000)){state.environmentPeopleAlertAt=Date.now();sendEvent('multiple_people',{count,source:'fast_face_scan'});}
          }else if(count===1){
            state.environmentIssues.people=false;updateEnvironmentSignal('people','ok','Single person detected','One visible face is present in the camera frame.');
          }else{
            state.environmentIssues.people=false;updateEnvironmentSignal('people','neutral','Person check uncertain','Keep your face and upper body visible to the camera.');
          }
          updateEnvironmentGate();
        }catch(e){}finally{faceBusy=false}
      }
      // Phone: COCO-SSD runs independently so it cannot delay the fast person scan.
      if(!phoneBusy && state.environmentModel && now-lastPhone>=850){
        phoneBusy=true;lastPhone=now;
        try{
          ctx.drawImage(activeVideo,0,0,canvas.width,canvas.height);
          const full=await state.environmentModel.detect(canvas,3,0.16);
          let phones=full.filter(x=>x.class==='cell phone'&&x.score>=0.16);
          // One small overlapping crop for edge/partial phones, but never block the main scan.
          if(performance.now()-lastCrop>=1700){
            const vw=activeVideo.videoWidth,vh=activeVideo.videoHeight;const [rx,ry,rw,rh]=crops[cropIndex++%crops.length];
            ctx.drawImage(activeVideo,vw*rx,vh*ry,vw*rw,vh*rh,0,0,canvas.width,canvas.height);
            const cp=await state.environmentModel.detect(canvas,3,0.14);
            phones.push(...cp.filter(x=>x.class==='cell phone'&&x.score>=0.14));lastCrop=performance.now();
          }
          const seen=phones.length>0;
          state.environmentPhoneHits=seen?Math.min(4,(state.environmentPhoneHits||0)+1):Math.max(0,(state.environmentPhoneHits||0)-1);
          if(phones.some(x=>x.score>=0.24)||state.environmentPhoneHits>=2){
            state.environmentIssues.phone=true;updateEnvironmentSignal('phone','warn','Possible phone detected','A mobile phone is visible or partially visible in the camera frame.');
            if(readiness.classList.contains('hidden')&&(!state.environmentPhoneAlertAt||Date.now()-state.environmentPhoneAlertAt>10000)){state.environmentPhoneAlertAt=Date.now();sendEvent('visible_phone',{source:'fast_phone_scan'});}
          }else if(seen){updateEnvironmentSignal('phone','warn','Possible phone detected','A possible mobile phone was detected. NEBULA is confirming the signal…');}
          else{state.environmentIssues.phone=false;updateEnvironmentSignal('phone','ok','Phone check clear','No mobile phone is currently visible in the camera frame.');}
        }catch(e){}finally{phoneBusy=false}
      }
      state.environmentTimer=requestAnimationFrame(scan);
    };
    scan();
  }catch(e){if(stateLabel)stateLabel.textContent='Camera AI scan unavailable';if(rowText)rowText.textContent='Basic camera monitoring active';if(rowStatus)rowStatus.textContent='—';}
}

function stopEnvironmentScan(){if(state.environmentTimer)cancelAnimationFrame(state.environmentTimer);state.environmentTimer=null;state.environmentScanReady=false}
async function checkAudioEnvironment(an){const track=state.stream?.getAudioTracks?.()[0];const live=!!track&&track.readyState==='live';if(!live){setCheck('audio',false,'Microphone track is unavailable');$('check-audio-text').textContent='Please check your microphone';return false}const data=new Uint8Array(an.frequencyBinCount);let total=0,peak=0,samples=0;const end=Date.now()+1200;while(Date.now()<end&&state.analyser){an.getByteTimeDomainData(data);let mean=0;for(const x of data)mean+=x;mean/=data.length;let sum=0;for(const x of data){const v=(x-mean)/128;sum+=v*v}const rms=Math.sqrt(sum/data.length);total+=rms;peak=Math.max(peak,rms);samples++;await new Promise(r=>setTimeout(r,80))}const avg=samples?total/samples:0;/* A quiet room is valid. Do not reject a working microphone just because nobody is speaking during this check; voice calibration is the speech test. */const usable=live&&Number.isFinite(avg);setCheck('audio',usable,usable?'Microphone ready':'Microphone unavailable');$('check-audio-text').textContent=usable?'Microphone ready · passive audio monitoring is active':'Please check your microphone';return usable}
function startAudioMonitor(){
  try{
    const an=state.analyser;if(!an)return;
    const data=new Uint8Array(an.fftSize);
    let lastCheck=0;
    function tick(now){
      if(!state.session||state.terminating)return;
      if(now-lastCheck>=160){an.getByteTimeDomainData(data);speakerSample(data);lastCheck=now;}
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }catch(e){}
}
function estimatePitch(data, sampleRate){
  let mean=0;for(const x of data)mean+=x;mean/=data.length;
  let energy=0;for(const x of data){const v=x-mean;energy+=v*v;}
  if(Math.sqrt(energy/data.length)/128<0.006)return 0;
  let bestLag=0,best=-Infinity;
  const minLag=Math.floor(sampleRate/280),maxLag=Math.floor(sampleRate/75);
  for(let lag=minLag;lag<=Math.min(maxLag,data.length-2);lag++){
    let sum=0;for(let i=0;i<data.length-lag;i++){const a=data[i]-mean,b=data[i+lag]-mean;sum+=a*b;}
    if(sum>best){best=sum;bestLag=lag;}
  }
  return bestLag?sampleRate/bestLag:0;
}
function spectralFeature(){
  if(!state.analyser)return {centroid:0,spread:0};
  const f=new Uint8Array(state.analyser.frequencyBinCount);state.analyser.getByteFrequencyData(f);
  let sum=0,weighted=0;for(let i=0;i<f.length;i++){const v=f[i]/255;sum+=v;weighted+=v*i;}
  const centroid=sum?weighted/sum:0;let spread=0;if(sum){for(let i=0;i<f.length;i++){const v=f[i]/255;spread+=v*Math.pow(i-centroid,2)}spread=Math.sqrt(spread/sum)}return {centroid,spread};
}
function speakerSample(data){
  if(Date.now()<state.speakerCooldown)return;
  let mean=0;for(const x of data)mean+=x;mean/=data.length;
  let z=0,energy=0;for(let i=1;i<data.length;i++){const a=data[i-1]-mean,b=data[i]-mean;if((a<0&&b>=0)||(a>=0&&b<0))z++;energy+=b*b;}
  const rms=Math.sqrt(energy/data.length)/128;
  const ambient=state.ambientNoise||.01;
  const speechGate=Math.max(.0045,ambient*1.05);
  if(rms<speechGate)return;
  const rel=Math.max(0,rms-ambient),zcr=z/data.length;
  const now=performance.now();
  if(!state.lastPitchAt||now-state.lastPitchAt>=320){
    state.lastPitch=estimatePitch(data,state.audioCtx?.sampleRate||48000);
    const sf=spectralFeature();state.lastCentroid=sf.centroid;state.lastSpread=sf.spread;state.lastPitchAt=now;
  }
  const pitch=state.lastPitch||0,centroid=state.lastCentroid||0,spread=state.lastSpread||0;
  if(!state.voiceBaseline){
    // With typing-only interviews there may be no candidate voice sample to calibrate against.
    // If speech is present while multiple faces are visible, treat it as a cautious additional-speaker signal.
    if((state.environmentPeopleCount||0)>1){
      state.speakerOutlierFrames=(state.speakerOutlierFrames||0)+1;
      if(state.speakerOutlierFrames>=4){
        state.speakerOutlierFrames=0;state.speakerCooldown=Date.now()+12000;
        sendEvent('speaker_change',{confidence:0.62,sustained_ms:640,source:'speech_plus_multiple_faces'});
        $('speaker-text').textContent='Consistency check';
        setTimeout(()=>{if(state.session&&!state.terminating)$('speaker-text').textContent='Passive monitor active'},2200);
      }
    }else{state.speakerOutlierFrames=Math.max(0,(state.speakerOutlierFrames||0)-1.5);}
    state.voiceLearn=state.voiceLearn||[];
    state.voiceLearn.push([rms,rel,ambient,zcr,pitch,centroid,spread]);
    if(state.voiceLearn.length>=7){
      const a=state.voiceLearn;const avg=i=>a.reduce((s,x)=>s+x[i],0)/a.length;
      state.voiceBaseline=[avg(0),avg(1),avg(2),avg(3),avg(4),avg(5),avg(6)];
      state.voiceLearn=[];$('speaker-text').textContent='Profile active';
    }
    return;
  }
  const base=state.voiceBaseline, baselineRms=base[0]||.02, baselineRel=base[1]||.01, baselineZcr=base[3]||.10, baselinePitch=base[4]||0, baseCentroid=base[5]||0, baseSpread=base[6]||0;
  const energyRatio=Math.abs(Math.log((rel+.002)/(baselineRel+.002))),zcrDelta=Math.abs(zcr-baselineZcr),pitchDelta=baselinePitch&&pitch?Math.abs(Math.log(pitch/baselinePitch)):0;
  const centroidDelta=baseCentroid?Math.min(1,Math.abs(centroid-baseCentroid)/Math.max(8,baseCentroid*.55)):0;
  const spreadDelta=baseSpread?Math.min(1,Math.abs(spread-baseSpread)/Math.max(10,baseSpread*.6)):0;
  const dist=Math.sqrt(.12*Math.min(1,energyRatio)**2+.38*Math.min(.5,zcrDelta)**2+.95*Math.min(1,pitchDelta)**2+.65*centroidDelta**2+.25*spreadDelta**2);
  const pitchUseful=!baselinePitch||(pitch>=75&&pitch<=350);
  const mismatch=dist>.34&&rms>Math.max(.006,baselineRms*.45)&&pitchUseful;
  if(mismatch)state.speakerOutlierFrames=(state.speakerOutlierFrames||0)+1;else state.speakerOutlierFrames=Math.max(0,(state.speakerOutlierFrames||0)-1.2);
  if((state.speakerOutlierFrames||0)>=5){
    state.speakerOutlierFrames=0;state.speakerCooldown=Date.now()+12000;
    sendEvent('speaker_change',{confidence:Number(Math.min(1,dist/.85).toFixed(2)),sustained_ms:800,pitch_delta:Number(pitchDelta.toFixed(2))});
    $('speaker-text').textContent='Consistency check';setTimeout(()=>{if(state.session&&!state.terminating)$('speaker-text').textContent='Profile active'},2200);
  }
}
function applyInterviewMode(){
  const voice=state.mode==='voice';
  const controls=$('conversation-controls');
  const vb=$('voice-input-btn');
  const st=$('voice-input-status');
  const answer=$('answer');
  if(controls)controls.classList.toggle('hidden',!voice);
  if(vb){vb.classList.toggle('hidden',!voice);vb.disabled=false;}
  if(answer)answer.placeholder=voice?'Type your answer or use the microphone to speak…':'Write your answer in your own words…';
  if(st)st.textContent=voice?'You can type, speak, or use both. Click Start speaking to dictate.':'';
  if(!voice && state.conversationListening)stopConversationRecognition();
}
document.querySelectorAll('.mode[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.mode[data-mode]').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');state.mode=btn.dataset.mode;applyInterviewMode();
}));
state.mode='text';applyInterviewMode();
$('voice-input-btn')?.addEventListener('click',()=>{if(state.conversationListening)stopConversationRecognition();else startConversationRecognition()});

$('start-btn').addEventListener('click',async()=>{$('setup-error').textContent='';const resumeFile=$('resume').files?.[0];if(!resumeFile){$('setup-error').textContent='Please upload your resume before starting. NEBULA personalizes the interview from your resume.';return}if(!$('consent').checked){$('setup-error').textContent='Please confirm the interview environment and integrity requirements before starting.';return}$('start-btn').disabled=true;$('start-btn').innerHTML='Opening readiness check… <span class="spin">◌</span>';setup.classList.add('hidden');readiness.classList.remove('hidden');$('readiness-error').textContent='';const ready=await mediaSetup();if(ready)startPassiveVoiceMeter();if(!ready){readiness.classList.add('hidden');setup.classList.remove('hidden');$('setup-error').textContent='Camera and microphone access are required. Allow both permissions and try again.';state.stream=null;return}await startEnvironmentScan();state.voiceBaseline=null;$('check-voice-text').textContent='Complete voice calibration';setCheck('voice',false,'Calibration required');$('readiness-calibrate').disabled=false;$('readiness-calibrate').textContent='Start voice calibration';updateEnvironmentGate()});
async function calibrateVoice(){
  if(!state.analyser||state.voiceCalibrating)return;
  try{await state.audioCtx?.resume()}catch(e){}
  state.voiceCalibrating=true;
  const btn=$('readiness-calibrate');
  btn.disabled=true;
  btn.textContent='Listening…';
  $('check-voice-text').textContent='Listening for your voice…';
  $('voice-live-label').textContent='NEBULA is listening';
  $('voice-live-sub').textContent='First stay quiet for a moment, then read the sentence naturally.';
  $('voice-time-label').textContent='Preparing microphone…';
  $('voice-recognition-label').textContent='Noise floor calibration';
  $('voice-meter-fill').style.width='0%';
  state.calibrationTranscript='';
  state.calibrationSpeechDetected=false;

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null;
  if(SR){
    try{
      recognition=new SR();
      state.calibrationRecognition=recognition;
      recognition.continuous=true;
      recognition.interimResults=true;
      recognition.lang='en-IN';
      recognition.onresult=e=>{
        let transcript='';
        for(let i=e.resultIndex;i<e.results.length;i++) transcript+=e.results[i][0].transcript+' ';
        state.calibrationTranscript=(state.calibrationTranscript+' '+transcript).trim();
        const words=(state.calibrationTranscript.match(/\S+/g)||[]).length;
        if(words>=1){
          state.calibrationSpeechDetected=true;
          $('voice-recognition-label').textContent=`Speech recognized · ${Math.min(words,30)} words`;
          $('voice-live-sub').textContent='NEBULA can hear your speech. Keep reading naturally…';
        }
      };
      recognition.onerror=()=>{$('voice-recognition-label').textContent='Using microphone signal';};
      recognition.start();
    }catch(e){recognition=null;state.calibrationRecognition=null;}
  }

  const data=new Uint8Array(state.analyser.frequencyBinCount);
  const rmsOf=()=>{
    state.analyser.getByteTimeDomainData(data);
    let mean=0; for(const x of data) mean+=x; mean/=data.length;
    let e=0; for(const x of data){const v=x-mean;e+=v*v;}
    return Math.sqrt(e/data.length)/128;
  };
  const started=Date.now();
  const noiseSamples=[];
  // First 1.5s: learn the room/microphone noise floor. Quiet should therefore look quiet.
  const noiseEnd=started+1800;
  while(Date.now()<noiseEnd&&state.analyser){
    const r=rmsOf(); noiseSamples.push(r);
    $('voice-time-label').textContent='Listening to room noise… stay quiet';
    $('voice-meter-fill').style.width='0%';
    const bars=document.querySelectorAll('#voice-visualizer i');
    bars.forEach(b=>{b.style.height='5%';b.style.opacity='.12'});
    await new Promise(r=>setTimeout(r,70));
  }
  const sorted=[...noiseSamples].sort((a,b)=>a-b);
  const noise=sorted.length?sorted[Math.floor(sorted.length*.75)]:.01;
  state.ambientNoise=noise;
  // V10: normal speech from laptop webcams can be much quieter than coughs.
  // Keep the threshold adaptive, but cap it so a noisy room does not make
  // ordinary speech impossible to capture. A small secondary relative-energy
  // gate helps soft voices while the persistence/total-frame checks prevent
  // random room noise from immediately passing calibration.
  const speechThreshold=Math.max(.006,Math.min(.022,noise*1.22));
  const speechFloor=Math.max(.0045,Math.min(.012,noise*1.05));
  $('voice-live-sub').textContent='Now read the sentence naturally. The meter reacts only to speech above the room-noise floor.';
  $('voice-time-label').textContent='Calibration · up to 12 seconds';
  $('voice-recognition-label').textContent='Waiting for speech';

  const samples=[], voiced=[]; state.calibrationFeatureSums={centroid:0,spread:0,count:0};
  const speechStart=Date.now(), maxDuration=12000, minDuration=4500;
  let stableFrames=0;
  while(Date.now()-speechStart<maxDuration&&state.analyser){
    const rms=rmsOf();
    let mean=0; for(const x of data) mean+=x; mean/=data.length;
    let crossings=0; for(let j=1;j<data.length;j++){const a=data[j-1]-mean,b=data[j]-mean;if((a<0&&b>=0)||(a>=0&&b<0))crossings++;}
    const zcr=crossings/data.length;
    const relative=Math.max(0,rms-noise);
    const isSpeech=(rms>speechThreshold)||(rms>speechFloor && relative>.0045);
    const liveLevel=Math.max(0,Math.min(1,(rms-speechFloor)/Math.max(.018,speechThreshold-speechFloor)));
    samples.push([rms,relative]);
    if(isSpeech){const pitch=estimatePitch(data,state.audioCtx?.sampleRate||48000);voiced.push([rms,relative,zcr,pitch]);const sf=spectralFeature();state.calibrationFeatureSums=state.calibrationFeatureSums||{centroid:0,spread:0,count:0};state.calibrationFeatureSums.centroid+=sf.centroid;state.calibrationFeatureSums.spread+=sf.spread;state.calibrationFeatureSums.count++;stableFrames++;}else stableFrames=Math.max(0,stableFrames-1);

    const bars=document.querySelectorAll('#voice-visualizer i');
    if(bars.length){
      state.analyser.getByteFrequencyData(data);
      const step=Math.max(1,Math.floor(data.length/bars.length));
      bars.forEach((bar,i)=>{
        const idx=Math.min(data.length-1,i*step);
        const raw=data[idx]/255;
        const v=isSpeech?Math.max(6,Math.min(100,Math.round((raw*.35+liveLevel*.65)*100))):6;
        bar.style.height=`${v}%`;
        bar.style.opacity=String(isSpeech ? .45+v/140 : .18);
      });
    }
    const elapsed=Date.now()-speechStart;
    const pct=isSpeech?Math.max(8,Math.min(100,Math.round(liveLevel*100))):0;
    $('voice-meter-fill').style.width=pct+'%';
    $('voice-time-label').textContent=`Calibration · ${Math.ceil(Math.max(0,maxDuration-elapsed)/1000)}s remaining`;
    if(isSpeech){
      $('voice-live-label').textContent='NEBULA is hearing your voice';
      $('voice-recognition-label').textContent=state.calibrationSpeechDetected?'Speech recognized':'Voice signal detected';
    } else if(stableFrames===0 && !state.calibrationSpeechDetected){
      $('voice-live-label').textContent='NEBULA is listening';
    }
    if(elapsed>=minDuration && voiced.length>=18){
      $('voice-live-label').textContent='Voice profile captured';
      $('voice-live-sub').textContent='NEBULA has enough stable speech. Finishing calibration…';
      await new Promise(r=>setTimeout(r,500));
      break;
    }
    await new Promise(r=>setTimeout(r,80));
  }
  try{if(recognition)recognition.stop()}catch(e){}
  state.calibrationRecognition=null;
  state.voiceCalibrating=false;

  const usable=voiced.length>=14;
  if(usable){
    const rmsAvg=voiced.reduce((a,b)=>a+b[0],0)/voiced.length;
    const relAvg=voiced.reduce((a,b)=>a+b[1],0)/voiced.length;
    const zcrAvg=voiced.reduce((a,b)=>a+b[2],0)/voiced.length;
    const pitchValues=voiced.map(v=>v[3]).filter(v=>v>=75&&v<=350);
    const pitchAvg=pitchValues.length?pitchValues.reduce((a,b)=>a+b,0)/pitchValues.length:0;
    // Session profile uses energy + zero-crossing + pitch; this remains a heuristic, not identity verification.
    const sf=state.calibrationFeatureSums||{centroid:0,spread:0,count:0}; const cAvg=sf.count?sf.centroid/sf.count:0; const sAvg=sf.count?sf.spread/sf.count:0; state.voiceBaseline=[rmsAvg,relAvg,noise,zcrAvg,pitchAvg,cAvg,sAvg];
    setCheck('voice',true,'Session voice profile ready');
    $('check-voice-text').textContent='Voice profile captured for this session';
    $('voice-live-label').textContent='Voice verified ✓';
    $('voice-live-sub').textContent='NEBULA has established your session voice profile.';
    $('voice-recognition-label').textContent='Speech recognized';
    $('voice-time-label').textContent='Calibration complete';
    $('voice-meter-fill').style.width='100%';
    btn.textContent='Recalibrate voice';
    btn.disabled=false;
    $('begin-interview').innerHTML=state.session?'Return to interview <span>↗</span>':'Begin interview <span>↗</span>';
    updateEnvironmentGate();
  }else{
    setCheck('voice',false,'No stable speech signal detected');
    $('check-voice-text').textContent='Please speak clearly and try again';
    $('voice-live-label').textContent='NEBULA could not capture enough speech';
    $('voice-live-sub').textContent='Stay quiet during the noise check, then read the calibration sentence clearly.';
    $('voice-recognition-label').textContent='No stable speech detected';
    $('voice-time-label').textContent='Calibration incomplete';
    btn.disabled=false;
    btn.textContent='Try voice calibration again';
  }
}
$('readiness-calibrate')?.addEventListener('click',calibrateVoice);

function stopConversationRecognition(){
  state.conversationListening=false;
  state.conversationToken=(state.conversationToken||0)+1;
  const r=state.recognition;
  state.recognition=null;
  try{r?.abort?.();}catch(e){}
  try{r?.stop?.();}catch(e){}
  const b=$('voice-input-btn');
  if(b){b.textContent='🎙 Start speaking';b.classList.remove('active');b.disabled=false}
  const st=$('voice-input-status');
  if(st)st.textContent='Conversation mode is ready when you are.';
}

function startConversationRecognition(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const st=$('voice-input-status');
  const b=$('voice-input-btn');
  const answer=$('answer');
  if(!SR){
    if(st)st.textContent='Speech-to-text is not available in this browser. Use Google Chrome or Microsoft Edge.';
    if(b){b.disabled=false;b.textContent='🎙 Start speaking';}
    return false;
  }

  stopConversationRecognition();
  const token=(state.conversationToken||0)+1;
  state.conversationToken=token;
  state.conversationListening=true;
  let finalPrefix=answer?.value?.trim()||'';
  let restartTimer=null;
  let gotResult=false;
  let attempts=0;

  const setStatus=(msg)=>{if(state.conversationListening&&state.conversationToken===token&&st)st.textContent=msg};
  const setButton=(label,active)=>{if(b&&state.conversationToken===token){b.textContent=label;b.classList.toggle('active',!!active);b.disabled=false}};

  // Use short, user-initiated recognition sessions. This is more reliable than
  // one long continuous session across Chrome/Edge/Chromium variants.
  const launch=()=>{
    if(!state.conversationListening||state.conversationToken!==token||state.terminating||state.mode!=='voice')return;
    let r;
    try{
      r=new SR();
      state.recognition=r;
      r.continuous=false;
      r.interimResults=true;
      r.maxAlternatives=1;
      // en-US is supported more consistently across Chromium speech services;
      // the browser still transcribes normal Indian English accents well.
      r.lang='en-US';
      r.onstart=()=>{setButton('⏹ Stop speaking',true);setStatus('Listening… speak now. Your words will appear here.')};
      r.onaudiostart=()=>setStatus('Microphone active…');
      r.onspeechstart=()=>setStatus('Hearing you…');
      r.onresult=(e)=>{
        let interim=''; let finals='';
        for(let i=e.resultIndex;i<e.results.length;i++){
          const text=(e.results[i][0]?.transcript||'').trim();
          if(!text)continue;
          if(e.results[i].isFinal) finals+=' '+text; else interim+=' '+text;
        }
        if(finals){
          gotResult=true;
          finalPrefix=(finalPrefix+' '+finals).replace(/\s+/g,' ').trim();
          if(answer){answer.value=finalPrefix;answer.dispatchEvent(new Event('input',{bubbles:true}));}
          setStatus('Captured ✓ Keep speaking. Click Stop speaking when finished.');
        }else if(interim.trim()){
          setStatus('Hearing: '+interim.trim());
        }
      };
      r.onerror=(e)=>{
        if(state.conversationToken!==token||!state.conversationListening)return;
        const err=e?.error||'unknown';
        if(err==='not-allowed'||err==='service-not-allowed'){
          state.conversationListening=false;
          setButton('🎙 Start speaking',false);
          setStatus('Speech permission was denied. Allow microphone/speech access, then click Start speaking again.');
          return;
        }
        if(err==='audio-capture')setStatus('Microphone is busy. Close other apps using the mic and try again.');
        else if(err==='network')setStatus('Browser speech service is unavailable. Check internet or use Chrome/Edge.');
        else if(err==='no-speech')setStatus('No speech detected — try speaking a little closer to the microphone.');
        else if(err!=='aborted')setStatus('Speech recognition error — retrying…');
      };
      r.onend=()=>{
        if(state.recognition===r)state.recognition=null;
        if(!state.conversationListening||state.conversationToken!==token||state.terminating||state.mode!=='voice')return;
        // Don't leave the user with a dead button after Chrome ends a session.
        clearTimeout(restartTimer);
        attempts++;
        restartTimer=setTimeout(()=>{
          if(state.conversationListening&&state.conversationToken===token){
            setStatus(gotResult?'Listening again… keep speaking.':'Listening… speak now.');
            launch();
          }
        }, gotResult?120:450);
      };
      r.start();
    }catch(e){
      if(state.conversationToken!==token||!state.conversationListening)return false;
      clearTimeout(restartTimer);
      setStatus('Could not start browser speech recognition. Click Start speaking again or use Chrome/Edge.');
      state.conversationListening=false;
      setButton('🎙 Start speaking',false);
      return false;
    }
    return true;
  };
  return launch();
}

$('readiness-back').addEventListener('click',()=>{if(state.stream)state.stream.getTracks().forEach(t=>t.stop());if(state.audioCtx)state.audioCtx.close();state.stream=null;state.analyser=null;readiness.classList.add('hidden');setup.classList.remove('hidden');$('start-btn').disabled=false;$('start-btn').innerHTML='Start NEBULA interview <span>↗</span>'});
$('begin-interview').addEventListener('click',async()=>{if(!state.stream)return;if(state.environmentIssues?.phone||state.environmentIssues?.people){updateEnvironmentGate();return;}try{await state.audioCtx?.resume()}catch(e){}const btn=$('begin-interview');btn.disabled=true;btn.innerHTML='Initializing NEBULA… <span class="spin">◌</span>';$('readiness-error').textContent='';try{if(state.session){$('transition-overlay').classList.remove('hidden');$('transition-title').textContent='Environment verified.';$('transition-subtitle').textContent='NEBULA is returning to your adaptive interview…';await new Promise(r=>setTimeout(r,1800));$('transition-overlay').classList.add('hidden');readiness.classList.add('hidden');interview.classList.remove('hidden');$('begin-interview').disabled=false;btn.innerHTML='Return to interview <span>↗</span>';return;}const form=new FormData();form.append('role',$('role').value);form.append('mode',state.mode);const f=$('resume').files[0];if(f)form.append('resume_file',f);const r=await fetch('/api/start',{method:'POST',body:form}),d=await r.json();if(!d.ok)throw Error();state.session=d.session_id;state.profile=d.profile;state.question=d.question;state.questionNumber=1;startAudioMonitor();$('transition-overlay').classList.remove('hidden');$('transition-title').textContent='Environment verified.';$('transition-subtitle').textContent='NEBULA is preparing your adaptive interview…';await new Promise(r=>setTimeout(r,1800));$('transition-overlay').classList.add('hidden');readiness.classList.add('hidden');interview.classList.remove('hidden');$('camera').srcObject=state.stream;$('camera-placeholder').classList.add('hidden');$('cam-text').textContent='Active';$('mic-text').textContent='Active';$('speaker-text').textContent='Passive monitor active';renderQuestion();}catch(e){$('readiness-error').textContent='NEBULA could not initialize the assessment. Please try again.';btn.disabled=false;btn.innerHTML='Begin interview <span>↗</span>'}});

function renderQuestion(){const q=state.question;if(!q)return;stopConversationRecognition();$('category').textContent=(q.category||'Adaptive Question').toUpperCase();$('question').textContent=q.question||'NEBULA is preparing your next question…';$('question-why').textContent='Adaptive reasoning: '+(q.why||'NEBULA selected this from your profile.');$('question-number').textContent=`QUESTION ${state.questionNumber}`;$('answer').value='';$('word-count').textContent='0 words';$('typing-state').textContent='Ready';state.questionShownAt=Date.now();state.pasteChars=0;state.tabSwitches=0;state.audioAnomaly=false;$('response-message').classList.add('hidden');$('submit-btn').disabled=false;$('submit-btn').innerHTML='Submit response <span>↗</span>'}
$('submit-btn').addEventListener('click',async()=>{if(state.terminating)return;const ans=$('answer').value.trim();$('submit-btn').disabled=true;$('submit-btn').innerHTML='NEBULA is analyzing… <span class="spin">◌</span>';const meta={elapsed_ms:Date.now()-state.questionShownAt,paste_chars:state.pasteChars,tab_switches:state.tabSwitches,audio_anomaly:state.audioAnomaly,camera_lost:!state.stream||state.stream.getVideoTracks().some(t=>t.readyState==='ended'),speaker_change:false};try{const r=await fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:state.session,answer:ans,integrity:meta})}),d=await r.json();if(!d.ok)throw Error();handleIntegrityResult(d);if(d.terminated||d.finished&&d.report){if(d.report)showReport(d.report);return}if(d.skipped){$('response-message').textContent=d.message;$('response-message').classList.remove('hidden');state.question=d.question;state.questionNumber=d.question_number||state.questionNumber+1;setTimeout(renderQuestion,650);return}if(d.finished){showReport(d.report);return}state.question=d.question;state.questionNumber=d.question_number||state.questionNumber+1;renderQuestion()}catch(e){$('response-message').textContent='Something went wrong. Please try submitting again.';$('response-message').classList.remove('hidden')}finally{if(!state.terminating){$('submit-btn').disabled=false;$('submit-btn').innerHTML='Submit response <span>↗</span>'}}});
$('end-btn').addEventListener('click',async()=>{if(!state.session)return;if(!confirm('End this interview now? Current valid responses will be included in the report.'))return;$('end-btn').disabled=true;try{const r=await fetch('/api/end',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:state.session})}),d=await r.json();if(d.ok)showReport(d.report)}catch(e){$('end-btn').disabled=false}});
function showReport(r){if(!r)return;state.terminating=true;stopEnvironmentScan();if(state.stream)state.stream.getTracks().forEach(t=>t.stop());if(state.audioCtx)state.audioCtx.close();if(state.recognition)try{state.recognition.stop()}catch(e){}interview.classList.add('hidden');dashboard.classList.add('hidden');report.classList.remove('hidden');const invalid=!!r.invalidated;$('overall-score').textContent=invalid?'INVALIDATED':(r.overall??'—');$('overall-unit').textContent=invalid?'':'/100';$('overall-score').classList.toggle('invalidated-score',invalid);$('invalid-banner').classList.toggle('hidden',!invalid);$('report-integrity').textContent=`Integrity Status: ${r.integrity.status}${r.integrity.alerts?` · ${r.integrity.alerts} warning(s)`:''}`;$('question-scores').innerHTML=r.question_scores.length?r.question_scores.map(x=>`<div class="score-row"><span>Q${x.number} · ${x.category}</span><b>${x.score}</b></div>`).join(''):(invalid?'<div class="empty-report">Performance scores were invalidated for this attempt.</div>':'<div class="empty-report">No evaluable responses were recorded.</div>');$('competencies').innerHTML=Object.entries(r.competencies).map(([k,v])=>`<div class="bar-row"><span>${k}</span><div><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('')||'<div class="empty-report">No competency scores available.</div>';$('evidence-map').innerHTML=(r.evidence||[]).map(x=>`<div class="evidence-row"><b>${x.claim}</b><span class="evidence-status">${x.status}</span><small>${x.detail}</small></div>`).join('')||'<div class="empty-report">No evidence map available.</div>';$('why-list').innerHTML=r.question_scores.map(x=>`<div class="why-row"><b>Q${x.number}</b><span>${x.why}</span></div>`).join('')||'<div class="empty-report">Unavailable for an invalidated attempt.</div>';$('strengths').innerHTML=(r.strengths||[]).map(x=>`<li>${x}</li>`).join('');$('gaps').innerHTML=(r.gaps||[]).map(x=>`<li>${x}</li>`).join('');$('recommendations').innerHTML=(r.recommendations||[]).map(x=>`<li>${x}</li>`).join('');$('replay').innerHTML=(r.replay||[]).map((x,i)=>`<div class="replay-row"><span>${i+1}</span><div><b>${x.type==='answer'?(x.followup?'Adaptive follow-up':'Answer evaluated'):'Response skipped'}</b><small>${x.question}</small>${x.score?`<em>${x.score}/100</em>`:''}</div></div>`).join('')||'<div class="empty-report">No replay events.</div>';$('integrity-timeline').innerHTML=(r.integrity?.timeline||[]).map(x=>`<div class="timeline-row"><span>${new Date(x.t*1000).toLocaleTimeString()}</span><b>${x.event.replaceAll('_',' ')}</b></div>`).join('')||'<div class="empty-report">No integrity events recorded.</div>'}
$('restart-btn').addEventListener('click',()=>location.reload());
$('dashboard-back').addEventListener('click',()=>{dashboard.classList.add('hidden');setup.classList.remove('hidden')});
