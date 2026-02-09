import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import {
  Whisper,
  WhisperFullParams,
  WhisperSamplingStrategy,
} from "@napi-rs/whisper";
import type { SpeechProvider } from "./config.js";
import { resolveModelPath } from "./whisper-model.js";

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

// ── Local (Whisper) client ───────────────────────────────────────────

let whisperInstance: Whisper | null = null;
let whisperInitPromise: Promise<Whisper> | null = null;

/**
 * Get or initialize the Whisper instance.
 * On first call, resolves the model path (which may trigger an auto-download)
 * and loads the model. Subsequent calls return the cached instance.
 */
async function getWhisperInstance(): Promise<Whisper> {
  if (whisperInstance) return whisperInstance;
  if (whisperInitPromise) return whisperInitPromise;

  whisperInitPromise = (async () => {
    const modelPath = await resolveModelPath();
    console.log("[STT:local] Loading Whisper model from", modelPath, "...");
    whisperInstance = new Whisper(modelPath);
    console.log("[STT:local] Whisper model loaded");
    return whisperInstance;
  })();

  return whisperInitPromise;
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

// ── Local STT (Whisper) ──────────────────────────────────────────────

/**
 * Transcribe raw 16kHz mono Float32 PCM samples using Whisper.
 */
async function transcribeLocal(samples: Float32Array): Promise<string> {
  const whisper = await getWhisperInstance();

  const params = new WhisperFullParams(WhisperSamplingStrategy.Greedy);
  params.language = "auto";
  params.printProgress = false;
  params.printRealtime = false;
  params.printTimestamps = false;
  params.singleSegment = false;
  params.noTimestamps = true;

  return whisper.full(params, samples);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Transcribe audio data to text using the configured speech provider.
 *
 * For "local" provider, `audioData` should be an ArrayBuffer containing
 * 16kHz mono Float32 PCM (sent from renderer in PCM recording mode).
 *
 * For cloud providers, `audioData` should be an ArrayBuffer containing
 * WebM/Opus audio (from MediaRecorder).
 */
export async function transcribe(
  audioData: ArrayBuffer,
  provider: SpeechProvider = "local",
): Promise<string> {
  let text: string;

  switch (provider) {
    case "local": {
      const samples = new Float32Array(audioData);
      text = await transcribeLocal(samples);
      break;
    }
    case "openai":
      text = await transcribeOpenAI(Buffer.from(audioData));
      break;
    case "gemini":
    default:
      text = await transcribeGemini(Buffer.from(audioData));
      break;
  }

  console.log(`[STT:${provider}] Transcribed: "${text}"`);
  return text;
}
