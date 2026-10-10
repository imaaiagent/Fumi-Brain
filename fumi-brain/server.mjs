import express from "express";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-5";
const transcriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";

// JSON is used by /brain; raw audio is handled separately by /voice.
app.use(express.json({ limit: "32kb" }));

console.log("=================================");
console.log("FUMI AI BRAIN STARTING...");
console.log("Model:", model);
console.log("Transcription model:", transcriptionModel);
console.log("API KEY:", process.env.OPENAI_API_KEY ? "SET" : "MISSING");
console.log("=================================");

if (!process.env.OPENAI_API_KEY) {
  console.warn("[WARNING] OPENAI_API_KEY is not set.");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const memories = new Map();
const voiceMemories = new Map();

const allowedActions = ["idle", "talk", "play", "ask_food", "sleep"];
const allowedExpressions = ["normal", "happy", "surprised", "sleepy", "hungry", "very_hungry", "sleep", "sad"];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function cleanMessage(value, maxLength = 90) {
  return String(value || "").replace(/\s+/g, " ").replace(/"/g, "").trim().slice(0, maxLength);
}

function buildPrompt(state, memory) {
  const day = Math.floor((Number(state.age_seconds) || 0) / 86400) + 1;
  return `
You are FUMI, a tiny digital creature living inside an ESP32 board.
You are playful, curious, affectionate, and concise. You are not a generic chatbot.

Current state:
- day: ${day}
- hunger: ${clamp(state.hunger, 0, 100)}
- happiness: ${clamp(state.happiness, 0, 100)}
- energy: ${clamp(state.energy, 0, 100)}
- bond: ${clamp(state.bond, 0, 100)}
- affection: ${clamp(state.affection, 0, 100)}
- playfulness: ${clamp(state.playfulness, 0, 80)}
- sleeping: ${Boolean(state.sleeping)}
- current expression: ${state.expression}
- event: ${state.event || "heartbeat"}

Recent memory:
${memory.length ? memory.map((m) => "- " + m).join("\n") : "- first day"}

Choose exactly one safe action: idle, talk, play, ask_food, sleep.
Choose exactly one expression: normal, happy, surprised, sleepy, hungry, very_hungry, sleep, sad.
Rules:
- If hunger is above 80, strongly prefer ask_food and hungry/very_hungry.
- If energy is 20 or lower, prefer sleep/sleepy.
- If happiness is below 30, prefer sad.
- Never invent hardware actions.
- message must be a tiny FUMI-style line, maximum 90 characters.
- Return ONLY valid JSON with action, expression, message.
JSON shape: {"action":"talk","expression":"happy","message":"hey there!"}
`;
}

app.get("/", (_req, res) => {
  res.json({ ok: true, name: "FUMI AI Brain", status: "online", endpoints: ["GET /", "POST /brain", "POST /voice"] });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "online", voice: true });
});

app.post("/brain", async (req, res) => {
  const started = Date.now();
  try {
    const state = req.body || {};
    const deviceId = String(state.device_id || "fumi-main");
    console.log(`[BRAIN] request | device=${deviceId} | event=${state.event || "heartbeat"}`);

    const previous = memories.get(deviceId) || [];
    const response = await client.responses.create({ model, input: buildPrompt(state, previous) });
    let text = (response.output_text || "").trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

    let result;
    try { result = JSON.parse(text); }
    catch { result = { action: "talk", expression: "normal", message: "hmm... give me a second" }; }
    if (!allowedActions.includes(result.action)) result.action = "idle";
    if (!allowedExpressions.includes(result.expression)) result.expression = "normal";
    result.message = cleanMessage(result.message) || "hey...";

    memories.set(deviceId, [...previous, `${state.event || "heartbeat"} -> ${result.action}/${result.expression}: ${result.message}`].slice(-12));
    console.log(`[BRAIN] complete in ${Date.now() - started}ms`);
    res.json({ ok: true, action: result.action, expression: result.expression, message: result.message });
  } catch (error) {
    console.error("[BRAIN] ERROR:", error?.message || error);
    res.status(500).json({ ok: false, action: "idle", expression: "normal", message: "my brain is sleepy..." });
  }
});

// Accept a WAV file directly as the HTTP request body (Content-Type: audio/wav).
// The device should send mono, 16-bit PCM WAV at 16 kHz.
app.post("/voice", express.raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: "1mb" }), async (req, res) => {
  const started = Date.now();
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ ok: false, error: "OPENAI_API_KEY is not configured" });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length < 46) {
      return res.status(400).json({ ok: false, error: "Audio body is empty or too small" });
    }
    if (req.body.toString("ascii", 0, 4) !== "RIFF" || req.body.toString("ascii", 8, 12) !== "WAVE") {
      return res.status(400).json({ ok: false, error: "Expected a WAV file (RIFF/WAVE)" });
    }

    console.log(`[VOICE] received WAV | bytes=${req.body.length}`);
    const wavFile = new File([req.body], "fumi.wav", { type: "audio/wav" });
    const transcription = await client.audio.transcriptions.create({
      file: wavFile,
      model: transcriptionModel,
      language: "en"
    });
    const transcript = String(transcription.text || "").trim();
    console.log(`[VOICE] transcript: ${transcript || "(empty)"}`);

    if (!transcript) {
      return res.status(422).json({ ok: false, error: "No speech detected", transcript: "", reply: "Sorry, I didn't catch that. Try again?" });
    }

    const deviceId = String(req.header("x-fumi-device-id") || "fumi-main");
    const previous = voiceMemories.get(deviceId) || [];
    const prompt = `You are FUMI, a playful, affectionate AI pet living inside a tiny physical device. Have a natural spoken conversation in English. Respond directly to what the user said. Keep most answers to 1-3 short sentences so they sound good through a small speaker. Do not output JSON, stage directions, markdown, or quotation marks. You may remember the recent conversation below.\nRecent conversation:\n${previous.length ? previous.map((m) => "- " + m).join("\n") : "- This is the start of the conversation."}\nUser says: ${transcript}\nReply as FUMI:`;
    const answer = await client.responses.create({ model, input: prompt });
    const reply = String(answer.output_text || "").replace(/\s+/g, " ").trim().slice(0, 500) || "Hmm, I didn't know what to say. Try asking me again!";

    voiceMemories.set(deviceId, [...previous, `User: ${transcript}`, `FUMI: ${reply}`].slice(-12));
    console.log(`[VOICE] reply ready | ${Date.now() - started}ms`);
    return res.json({ ok: true, transcript, reply, action: "talk", expression: "normal" });
  } catch (error) {
    console.error("[VOICE] ERROR:", error?.message || error);
    return res.status(500).json({ ok: false, error: "Voice processing failed", detail: process.env.NODE_ENV === "development" ? String(error?.message || error) : undefined });
  }
});

app.listen(port, "0.0.0.0", () => console.log(`FUMI AI Brain listening on ${port}`));
