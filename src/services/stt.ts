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
 * Transcribe audio data (WebM/Opus from MediaRecorder) to text
 * using Gemini 2.5 Flash on Vertex AI.
 */
export async function transcribe(audioBuffer: Buffer): Promise<string> {
  const client = getClient();
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

  const text = response.text?.trim() ?? "";
  console.log(`[STT] Transcribed: "${text}"`);
  return text;
}
