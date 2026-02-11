import OpenAI from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { spawn } from "node:child_process";
import type { SpeechProvider } from "./config.js";
import { getGeminiClient } from "./gemini-client.js";
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

// ── Audio parameters ─────────────────────────────────────────────────

/** Default audio parameters (shared across providers – both output 24kHz 16-bit mono PCM) */
export const TTS_SAMPLE_RATE = 24000;
export const TTS_CHANNELS = 1;
export const TTS_BITS_PER_SAMPLE = 16;

/** Chunk size for splitting PCM response (~100ms of audio) */
const PCM_CHUNK_SIZE = TTS_SAMPLE_RATE * (TTS_BITS_PER_SAMPLE / 8) * TTS_CHANNELS * 0.1; // 4800 bytes

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

  logger.info(
    { provider: "gemini", totalBytes, text: text.substring(0, 50) },
    "Streamed PCM audio",
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
    const end = Math.min(offset + PCM_CHUNK_SIZE, fullBuffer.length);
    const chunk = fullBuffer.subarray(offset, end);
    totalBytes += chunk.length;
    yield chunk;
    offset = end;
  }

  logger.info(
    { provider: "openai", totalBytes, text: text.substring(0, 50) },
    "Streamed PCM audio",
  );
}

// ── ElevenLabs TTS ───────────────────────────────────────────────────

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

const DEFAULT_ELEVENLABS_VOICE_ID = "CwhRBWXzGAHq8TQ4Fs17";

async function* synthesizeStreamElevenLabs(
  text: string,
): AsyncGenerator<Buffer, void, undefined> {
  const client = getElevenLabsClient();
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";

  // SDK returns a ReadableStream; outputFormat pcm_24000 gives raw 24kHz 16-bit signed LE mono PCM
  const audio = await client.textToSpeech.convert(voiceId, {
    text,
    modelId,
    outputFormat: "pcm_24000",
  });

  // Collect the stream into a Buffer, then split into fixed-size chunks
  const chunks: Uint8Array[] = [];
  const reader = audio.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const fullBuffer = Buffer.concat(chunks);

  let totalBytes = 0;
  let offset = 0;

  while (offset < fullBuffer.length) {
    const end = Math.min(offset + PCM_CHUNK_SIZE, fullBuffer.length);
    const chunk = fullBuffer.subarray(offset, end);
    totalBytes += chunk.length;
    yield chunk;
    offset = end;
  }

  logger.info(
    { provider: "elevenlabs", totalBytes, text: text.substring(0, 50) },
    "Streamed PCM audio",
  );
}

// ── Local TTS (macOS say command) ────────────────────────────────────

/**
 * Speak text using the macOS `say` command, playing directly through the
 * system audio output. Returns a promise that resolves when speech finishes.
 */
export function speakLocal(text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (process.platform !== "darwin") {
      reject(new Error("Local TTS (say command) is only supported on macOS"));
      return;
    }

    const voice = process.env.SAY_VOICE;
    const args: string[] = [];
    if (voice) {
      args.push("-v", voice);
    }
    args.push(text);

    const child = spawn("say", args, { stdio: "ignore" });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn say command: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        logger.info(
          { provider: "local", text: text.substring(0, 50) },
          "Spoke text",
        );
        resolve();
      } else {
        reject(new Error(`say command exited with code ${code}`));
      }
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Convert text to speech using the configured provider (streaming).
 * Yields raw PCM chunks (24kHz, 16-bit, mono) as Buffers.
 *
 * NOTE: For the "local" provider, use `speakLocal()` instead – the `say`
 * command plays audio directly through the system speaker, so PCM streaming
 * is not applicable.
 */
export async function* synthesizeStream(
  text: string,
  provider: SpeechProvider = "local",
): AsyncGenerator<Buffer, void, undefined> {
  switch (provider) {
    case "local":
      // say plays directly – yield nothing; callers should use speakLocal()
      throw new Error(
        "Local TTS does not support PCM streaming. Use speakLocal() instead.",
      );
    case "openai":
      yield* synthesizeStreamOpenAI(text);
      break;
    case "elevenlabs":
      yield* synthesizeStreamElevenLabs(text);
      break;
    case "gemini":
    default:
      yield* synthesizeStreamGemini(text);
      break;
  }
}
