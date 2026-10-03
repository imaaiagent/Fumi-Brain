# FUMI AI Brain v2 Async

This is the first real ESP32 -> server -> LLM -> ESP32 loop.

## Architecture

ESP32-S3
  -> HTTPS POST /brain
  -> FUMI AI Brain (Node/Express)
  -> OpenAI Responses API
  -> structured-ish JSON decision
  -> ESP32 expression + message

OpenAI API keys stay on the server, not in the ESP32 firmware.

## 1. Deploy the server

This is designed for Railway or another Node host.

Environment variables:

OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5

Start command:

npm start

After deployment, test:

GET /
POST /brain

## 2. Configure the firmware

Open `LVGL_Arduino_fumi_ai_brain_v1.ino`.

Change:

const char *FUMI_WIFI_SSID = "YOUR_WIFI_NAME";
const char *FUMI_WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *FUMI_BRAIN_URL = "https://YOUR-RAILWAY-APP.up.railway.app/brain";

Do NOT put your OpenAI API key in the ESP32 firmware.

## 3. What it does

On boot:
- connects to Wi-Fi
- asks the brain for an initial decision

Every 60 seconds:
- sends FUMI's current state

After tap:
- sends `tap`

After feed:
- sends `feed`

After mini-game:
- sends `game_finished`

The server returns:
- action
- expression
- message

FUMI applies the expression and displays a small speech bubble.

## Prototype note

The ESP32 uses `WiFiClientSecure.setInsecure()` for the first prototype so HTTPS setup stays simple. This skips certificate verification and should be replaced with proper CA verification before a public/production deployment.

Memory is currently held in server RAM. Restarting the Railway service clears it. Move memory to SQLite/Postgres later.


## Why v2 is async

The ESP32 does not block the LVGL UI while waiting for the brain. Network work runs in a FreeRTOS task and the response is applied back on the LVGL side. This keeps animations/touch responsive during an AI request.
