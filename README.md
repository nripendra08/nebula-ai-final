# NEBULA AI — Final Hackathon Build

NEBULA is an adaptive interview platform that combines resume intelligence, adaptive follow-up questioning, silent evaluation, multimodal integrity signals, voice/speaker consistency monitoring, and an explainable candidate report.

## Included
- Resume parsing: TXT, PDF, DOCX
- Resume-aware question generation
- Adaptive follow-up chains based on previous answers
- Adaptive difficulty / evidence coverage
- Text interview mode
- Optional browser voice-response mode using SpeechRecognition when supported
- Camera + microphone monitoring from the start
- Speaker-consistency signal using a lightweight browser audio profile
- Tab/page visibility, paste, response timing, camera and audio signals
- Two-stage integrity warning flow and assessment invalidation
- Invalidated attempts do not receive a misleading performance score
- End Interview control
- Resume → evidence map
- Competency profile
- Question performance and "why NEBULA asked" explanation
- Interview replay timeline
- Integrity timeline
- Personalized improvement recommendations
- In-memory recruiter/dashboard API (`/api/dashboard`)

## Run
```bash
python -m pip install -r requirements.txt
python app.py
```
Open `http://127.0.0.1:5000`.

## Optional AI mode
The app is designed to work in demo mode without OpenAI credits. If you have an API key and want to add an LLM layer, put it in a local `.env` file and set `DEMO_MODE=false`. Never commit `.env` or the API key.

## Voice / integrity limitation
The browser-side speaker feature is a **speaker-consistency signal**, not a forensic identity system. It compares lightweight audio characteristics from the session calibration against later audio. Background noise, different microphones, room acoustics, or speech conditions can cause uncertainty. A voice signal is therefore combined with other observable integrity signals rather than being treated as proof by itself.

The product also cannot reliably identify a hidden phone or prove that a particular second person is speaking using ordinary browser APIs. The UI intentionally describes these as integrity signals, not certainty.

## Demo architecture
Resume Engine → Interview Brain → Integrity Engine → Evaluation Engine → Candidate Intelligence Report.

The session store is in memory for hackathon/demo use; restarting Flask clears active assessments.


## V9 environment scan update
- Phone detection now uses the full camera frame plus overlapping crops so partially visible/occluded phones are easier to detect.
- Lower-confidence detections are confirmed across consecutive scans before becoming a persistent warning.
- The UI reports a possible/partial phone signal rather than claiming certainty.
