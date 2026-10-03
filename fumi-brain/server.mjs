import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "32kb" }));

const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-5";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set.");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Short-lived memory for the prototype.
// Replace with SQLite/Postgres later for durable memory.
const memories = new Map();

const allowedActions = [
  "idle",
  "talk",
  "play",
  "ask_food",
  "sleep"
];

const allowedExpressions = [
  "normal",
  "happy",
  "surprised",
  "sleepy",
  "hungry",
  "very_hungry",
  "sleep",
  "sad"
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function cleanMessage(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/"/g, "")
    .trim()
    .slice(0, 90);
}

function buildPrompt(state, memory) {
  const day = Math.floor((Number(state.age_seconds) || 0) / 86400) + 1;

  return `
You are FUMI, a tiny digital creature living inside an ESP32 board.
You are playful, curious, affectionate, and concise.
You are NOT a generic chatbot. You are deciding what FUMI should do next.

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

Choose exactly one safe action:
idle, talk, play, ask_food, sleep

Choose exactly one expression:
normal, happy, surprised, sleepy, hungry, very_hungry, sleep, sad

Rules:
- If hunger is above 80, strongly prefer ask_food and hungry/very_hungry.
- If energy is 20 or lower, prefer sleep/sleepy.
- If happiness is below 30, prefer sad.
- If the event is feed, tap, or game_finished, react to that event.
- Never invent hardware actions.
- message must be a tiny FUMI-style line, maximum 90 characters.
- Do not use quotation marks in message.
- Return ONLY valid JSON.

JSON shape:
{
  "action": "idle",
  "expression": "normal",
  "message": "..."
}
`;
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    name: "FUMI AI Brain",
    status: "online"
  });
});

app.post("/brain", async (req, res) => {
  try {
    const state = req.body || {};
    const deviceId = String(state.device_id || "fumi-main");

    const previous = memories.get(deviceId) || [];
    const prompt = buildPrompt(state, previous);

    const response = await client.responses.create({
      model,
      input: prompt
    });

    let text = response.output_text || "";
    text = text.trim();

    // Strip accidental markdown fences.
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "");
    text = text.replace(/\s*```$/i, "").trim();

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = {
        action: "talk",
        expression: "normal",
        message: "hmm... give me a second"
      };
    }

    if (!allowedActions.includes(result.action)) {
      result.action = "idle";
    }

    if (!allowedExpressions.includes(result.expression)) {
      result.expression = "normal";
    }

    result.message = cleanMessage(result.message);

    if (!result.message) {
      result.message = "hey...";
    }

    const nextMemory = [
      ...previous,
      `${state.event || "heartbeat"} -> ${result.action}/${result.expression}: ${result.message}`
    ].slice(-12);

    memories.set(deviceId, nextMemory);

    res.json({
      ok: true,
      action: result.action,
      expression: result.expression,
      message: result.message
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      action: "idle",
      expression: "normal",
      message: "my brain is sleepy..."
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`FUMI AI Brain listening on ${port}`);
});
