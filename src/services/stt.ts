import OpenAI, { toFile } from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  Whisper,
  WhisperFullParams,
  WhisperSamplingStrategy,
} from "@napi-rs/whisper";
import type { SpeechProvider } from "./config.js";
import { getGeminiClient } from "./gemini-client.js";
import { resolveModelPath } from "./whisper-model.js";
import logger from "./logger.js";

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
    logger.info({ modelPath }, "Loading Whisper model");
    whisperInstance = new Whisper(modelPath);
    logger.info("Whisper model loaded");
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

// ── ElevenLabs STT ───────────────────────────────────────────────────

let elevenlabsClient: ElevenLabsClient | null = null;

function getElevenLabsClient(): ElevenLabsClient {
  if (elevenlabsClient) return elevenlabsClient;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }
  elevenlabsClient = new ElevenLabsClient({ apiKey });
  return elevenlabsClient;
}

async function transcribeElevenLabs(audioBuffer: Buffer): Promise<string> {
  const client = getElevenLabsClient();

  const result = await client.speechToText.convert({
    file: {
      data: audioBuffer,
      filename: "recording.webm",
      contentType: "audio/webm",
    },
    modelId: "scribe_v2",
  });

  // Response is a union type; SpeechToTextChunkResponseModel has .text
  if ("text" in result) {
    return (result.text ?? "").trim();
  }
  // MultichannelSpeechToTextResponseModel has .transcripts
  if ("transcripts" in result && result.transcripts?.[0]) {
    return (result.transcripts[0].text ?? "").trim();
  }
  return "";
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
    case "elevenlabs":
      text = await transcribeElevenLabs(Buffer.from(audioData));
      break;
    case "gemini":
    default:
      text = await transcribeGemini(Buffer.from(audioData));
      break;
  }

  logger.info({ provider, text }, "Transcribed");
  return text;
}
