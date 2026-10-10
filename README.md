# FUMI Brain — Voice-ready backend

This keeps the existing `POST /brain` endpoint and adds `POST /voice`.

## Railway variables
- `OPENAI_API_KEY`: required; keep it on Railway only.
- `OPENAI_MODEL`: optional; defaults to `gpt-5`.
- `OPENAI_TRANSCRIPTION_MODEL`: optional; defaults to `gpt-4o-mini-transcribe`.

Start command: `npm start`

## Endpoints
- `GET /` — health/status and endpoint list.
- `GET /health` — health check.
- `POST /brain` — existing FUMI state/behavior endpoint (JSON).
- `POST /voice` — receives raw WAV request body, transcribes English, generates a natural FUMI reply, returns JSON `{ ok, transcript, reply, action, expression }`.

## Audio contract for `/voice`
Send `Content-Type: audio/wav`; body must be a valid RIFF/WAVE, mono, 16-bit PCM WAV at 16 kHz. Max request size is 1 MB. The ESP32 firmware still needs to build this WAV from its I2S samples and POST it to `/voice`.

## Deploy
Replace the existing backend files with `fumi-brain/server.mjs` and `fumi-brain/package.json`, then redeploy on Railway. Do not add the OpenAI key to firmware or commit it to GitHub.
