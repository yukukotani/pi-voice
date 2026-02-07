import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (ai) return ai;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  if (!project) {
    throw new Error("GOOGLE_CLOUD_PROJECT environment variable is required");
  }
  ai = new GoogleGenAI({ vertexai: true, project, location });
  return ai;
}

/** Default audio parameters for Gemini TTS */
export const TTS_SAMPLE_RATE = 24000;
export const TTS_CHANNELS = 1;
export const TTS_BITS_PER_SAMPLE = 16;

/**
 * Convert text to speech using Gemini 2.5 Flash TTS on Vertex AI (streaming).
 * Yields raw PCM chunks (24kHz, 16-bit, mono) as Buffers.
 */
export async function* synthesizeStream(
  text: string
): AsyncGenerator<Buffer, void, undefined> {
  const client = getClient();

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
    `[TTS] Streamed ${totalBytes} bytes of PCM audio for "${text.substring(0, 50)}..."`
  );
}


