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

/**
 * Convert text to speech using Gemini 2.5 Flash TTS on Vertex AI.
 * Returns WAV audio as a Buffer (24kHz, 16-bit PCM, mono).
 */
export async function synthesize(text: string): Promise<Buffer> {
  const client = getClient();

  const response = await client.models.generateContent({
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

  // Response contains audio as inline base64 data
  const candidate = response.candidates?.[0];
  const audioPart = candidate?.content?.parts?.find(
    (p: any) => p.inlineData?.mimeType?.startsWith("audio/")
  );

  if (!audioPart?.inlineData?.data) {
    throw new Error("No audio data in TTS response");
  }

  // Gemini TTS returns raw PCM (24kHz, 16-bit, mono) as base64
  const pcmBuffer = Buffer.from(audioPart.inlineData.data, "base64");

  // Wrap in WAV header for easy playback
  const wavBuffer = wrapPcmInWav(pcmBuffer, 24000, 1, 16);

  console.log(
    `[TTS] Generated ${wavBuffer.length} bytes of WAV audio for "${text.substring(0, 50)}..."`
  );
  return wavBuffer;
}

/** Create a WAV file from raw PCM data */
function wrapPcmInWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);

  return buffer;
}
