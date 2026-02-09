import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import type { SpeechProvider } from "./config.js";

// ── Gemini client ────────────────────────────────────────────────────

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (geminiClient) return geminiClient;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  if (!project) {
    throw new Error("GOOGLE_CLOUD_PROJECT environment variable is required");
  }
  geminiClient = new GoogleGenAI({ vertexai: true, project, location });
  return geminiClient;
}

// ── OpenAI client ────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// ── Gemini STT ───────────────────────────────────────────────────────

async function transcribeGemini(audioBuffer: Buffer): Promise<string> {
  const client = getGeminiClient();
  const base64Audio = audioBuffer.toString("base64");

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "audio/webm",
              data: base64Audio,
            },
          },
          {
            text: "Transcribe this audio exactly as spoken. Output only the transcription, nothing else. If the audio is in Japanese, output in Japanese. If the audio is silent or empty, output an empty string.",
          },
        ],
      },
    ],
  });

  return response.text?.trim() ?? "";
}

// ── OpenAI STT ───────────────────────────────────────────────────────

async function transcribeOpenAI(audioBuffer: Buffer): Promise<string> {
  const client = getOpenAIClient();

  const file = await toFile(audioBuffer, "recording.webm");
  const transcription = await client.audio.transcriptions.create({
    model: "gpt-4o-mini-transcribe",
    file,
  });

  return transcription.text?.trim() ?? "";
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Transcribe audio data (WebM/Opus from MediaRecorder) to text
 * using the configured speech provider.
 */
export async function transcribe(
  audioBuffer: Buffer,
  provider: SpeechProvider = "gemini",
): Promise<string> {
  let text: string;

  switch (provider) {
    case "openai":
      text = await transcribeOpenAI(audioBuffer);
      break;
    case "gemini":
    default:
      text = await transcribeGemini(audioBuffer);
      break;
  }

  console.log(`[STT:${provider}] Transcribed: "${text}"`);
  return text;
}
