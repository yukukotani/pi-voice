import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock @google/genai
const mockGoogleGenAI = mock((_opts?: any) => ({ models: {} }));
mock.module("@google/genai", () => ({
  GoogleGenAI: mockGoogleGenAI,
}));

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

const { getGeminiClient, _resetGeminiClient } = await import(
  "../../services/gemini-client.js"
);

describe("gemini-client", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    _resetGeminiClient();
    mockGoogleGenAI.mockClear();
    savedEnv = {
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
      GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      GOOGLE_GENAI_USE_VERTEXAI: process.env.GOOGLE_GENAI_USE_VERTEXAI,
    };
    // Clear all relevant env vars
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  test("creates Vertex AI client when GOOGLE_CLOUD_PROJECT is set", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-east1";

    const client = getGeminiClient();
    expect(client).toBeDefined();
    expect(mockGoogleGenAI).toHaveBeenCalledTimes(1);
    const calls = mockGoogleGenAI.mock.calls as any[];
    expect(calls[0]![0]).toEqual({
      vertexai: true,
      project: "my-project",
      location: "us-east1",
    });
  });

  test("defaults to us-central1 when location not set", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";

    getGeminiClient();
    const calls = mockGoogleGenAI.mock.calls as any[];
    expect(calls[0]![0]).toEqual({
      vertexai: true,
      project: "my-project",
      location: "us-central1",
    });
  });

  test("creates API key client when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "test-key";

    getGeminiClient();
    expect(mockGoogleGenAI).toHaveBeenCalledTimes(1);
    const calls = mockGoogleGenAI.mock.calls as any[];
    expect(calls[0]![0]).toEqual({
      apiKey: "test-key",
    });
  });

  test("creates API key client when GOOGLE_API_KEY is set", () => {
    process.env.GOOGLE_API_KEY = "google-key";

    getGeminiClient();
    const calls = mockGoogleGenAI.mock.calls as any[];
    expect(calls[0]![0]).toEqual({
      apiKey: "google-key",
    });
  });

  test("prefers GEMINI_API_KEY over GOOGLE_API_KEY", () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.GOOGLE_API_KEY = "google-key";

    getGeminiClient();
    const calls = mockGoogleGenAI.mock.calls as any[];
    expect(calls[0]![0]).toEqual({
      apiKey: "gemini-key",
    });
  });

  test("forces API key mode with GOOGLE_GENAI_USE_VERTEXAI=false", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "false";

    getGeminiClient();
    const calls = mockGoogleGenAI.mock.calls as any[];
    expect(calls[0]![0]).toEqual({
      apiKey: "test-key",
    });
  });

  test("throws when no credentials are set", () => {
    expect(() => getGeminiClient()).toThrow(
      /GOOGLE_CLOUD_PROJECT.*GEMINI_API_KEY/,
    );
  });

  test("returns cached client on subsequent calls", () => {
    process.env.GEMINI_API_KEY = "test-key";

    const client1 = getGeminiClient();
    const client2 = getGeminiClient();
    expect(client1).toBe(client2);
    expect(mockGoogleGenAI).toHaveBeenCalledTimes(1);
  });

  test("_resetGeminiClient clears the cache", () => {
    process.env.GEMINI_API_KEY = "test-key";

    getGeminiClient();
    _resetGeminiClient();
    getGeminiClient();
    expect(mockGoogleGenAI).toHaveBeenCalledTimes(2);
  });
});
