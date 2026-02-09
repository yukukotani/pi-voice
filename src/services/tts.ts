import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
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

// ── Audio parameters ─────────────────────────────────────────────────

/** Default audio parameters (shared across providers – both output 24kHz 16-bit mono PCM) */
export const TTS_SAMPLE_RATE = 24000;
export const TTS_CHANNELS = 1;
export const TTS_BITS_PER_SAMPLE = 16;

/** Chunk size for splitting OpenAI PCM response (~100ms of audio) */
const OPENAI_PCM_CHUNK_SIZE = TTS_SAMPLE_RATE * (TTS_BITS_PER_SAMPLE / 8) * TTS_CHANNELS * 0.1; // 4800 bytes

// ── Gemini TTS ───────────────────────────────────────────────────────

async function* synthesizeStreamGemini(
  text: string,
): AsyncGenerator<Buffer, void, undefined> {
  const client = getGeminiClient();

  const response = await client.models.generateContentStream({
    model: "gemini-2.5-flash-preview-tts",
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Aoede",
          },
        },
      },
    },
  });

  let totalBytes = 0;
  // Carry over odd trailing byte for 16-bit alignment
  let leftover: Buffer | null = null;

  for await (const chunk of response) {
    const candidate = chunk.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!parts) continue;

    for (const part of parts) {
      if (!part.inlineData?.data) continue;

      let pcm = Buffer.from(part.inlineData.data, "base64");

      // Prepend leftover byte from previous chunk if any
      if (leftover) {
        pcm = Buffer.concat([leftover, pcm]);
        leftover = null;
      }

      // Ensure 16-bit (2-byte) alignment
      const bytesPerSample = TTS_BITS_PER_SAMPLE / 8;
      const remainder = pcm.length % bytesPerSample;
      if (remainder !== 0) {
        leftover = pcm.subarray(pcm.length - remainder);
        pcm = pcm.subarray(0, pcm.length - remainder);
      }

      if (pcm.length > 0) {
        totalBytes += pcm.length;
        yield pcm;
      }
    }
  }

  // Flush any remaining leftover (shouldn't happen with well-formed data)
  if (leftover && leftover.length > 0) {
    totalBytes += leftover.length;
    yield leftover;
  }

  console.log(
    `[TTS:gemini] Streamed ${totalBytes} bytes of PCM audio for "${text.substring(0, 50)}..."`,
  );
}

// ── OpenAI TTS ───────────────────────────────────────────────────────

async function* synthesizeStreamOpenAI(
  text: string,
): AsyncGenerator<Buffer, void, undefined> {
  const client = getOpenAIClient();

  const response = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
    response_format: "pcm", // raw 24kHz 16-bit signed LE mono PCM
  });

  const arrayBuffer = await response.arrayBuffer();
  const fullBuffer = Buffer.from(arrayBuffer);

  let totalBytes = 0;
  let offset = 0;

  // Split into fixed-size chunks for smooth streaming playback
  while (offset < fullBuffer.length) {
    const end = Math.min(offset + OPENAI_PCM_CHUNK_SIZE, fullBuffer.length);
    const chunk = fullBuffer.subarray(offset, end);
    totalBytes += chunk.length;
    yield chunk;
    offset = end;
  }

  console.log(
    `[TTS:openai] Streamed ${totalBytes} bytes of PCM audio for "${text.substring(0, 50)}..."`,
  );
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Convert text to speech using the configured provider (streaming).
 * Yields raw PCM chunks (24kHz, 16-bit, mono) as Buffers.
 */
export async function* synthesizeStream(
  text: string,
  provider: SpeechProvider = "gemini",
): AsyncGenerator<Buffer, void, undefined> {
  switch (provider) {
    case "openai":
      yield* synthesizeStreamOpenAI(text);
      break;
    case "gemini":
    default:
      yield* synthesizeStreamGemini(text);
      break;
  }
}
