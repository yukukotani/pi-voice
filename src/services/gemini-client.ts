import { GoogleGenAI } from "@google/genai";
import logger from "./logger.js";

/**
 * Shared Gemini client singleton.
 *
 * Authentication priority:
 *   1. Vertex AI  – when `GOOGLE_CLOUD_PROJECT` is set (uses ADC / service-account).
 *   2. Gemini API – when `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set.
 *
 * To force the Gemini API even when Vertex env vars are present, set
 * `GOOGLE_GENAI_USE_VERTEXAI=false`.
 */

let geminiClient: GoogleGenAI | null = null;

/**
 * Reset the cached client (for testing only).
 */
export function _resetGeminiClient(): void {
  geminiClient = null;
}

export function getGeminiClient(): GoogleGenAI {
  if (geminiClient) return geminiClient;

  const forceVertexOff = process.env.GOOGLE_GENAI_USE_VERTEXAI === "false";
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (project && !forceVertexOff) {
    // Vertex AI mode
    logger.info({ project, location }, "Initializing Gemini client (Vertex AI)");
    geminiClient = new GoogleGenAI({ vertexai: true, project, location });
  } else if (apiKey) {
    // Gemini API key mode
    logger.info("Initializing Gemini client (API key)");
    geminiClient = new GoogleGenAI({ apiKey });
  } else {
    throw new Error(
      "Gemini provider requires either GOOGLE_CLOUD_PROJECT (for Vertex AI) " +
        "or GEMINI_API_KEY / GOOGLE_API_KEY (for Gemini API).",
    );
  }

  return geminiClient;
}
