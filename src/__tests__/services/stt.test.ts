import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Mock gemini-client
const mockGenerateContent = mock(async () => ({
  text: "gemini transcription",
}));
mock.module("../../services/gemini-client.js", () => ({
  getGeminiClient: () => ({
    models: {
      generateContent: mockGenerateContent,
    },
  }),
  _resetGeminiClient: () => {},
}));

// Mock OpenAI
const mockOpenAITranscription = mock(async () => ({
  text: "openai transcription",
}));
mock.module("openai", () => {
  return {
    default: class OpenAI {
      audio = {
        transcriptions: {
          create: mockOpenAITranscription,
        },
      };
    },
    toFile: mock(async (buf: any, name: string) => ({ name, data: buf })),
  };
});

// Mock ElevenLabs
const mockElevenLabsSTT = mock(async () => ({
  text: "elevenlabs transcription",
}));
mock.module("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: class {
    speechToText = {
      convert: mockElevenLabsSTT,
    };
  },
}));

// Mock Whisper
const mockWhisperFull = mock(async () => "whisper transcription");
mock.module("@napi-rs/whisper", () => ({
  Whisper: class {
    full = mockWhisperFull;
  },
  WhisperFullParams: class {
    language = "auto";
    printProgress = false;
    printRealtime = false;
    printTimestamps = false;
    singleSegment = false;
    noTimestamps = true;
  },
  WhisperSamplingStrategy: { Greedy: 0 },
}));

// Mock whisper-model
mock.module("../../services/whisper-model.js", () => ({
  resolveModelPath: async () => "/fake/model.bin",
}));

const { transcribe } = await import("../../services/stt.js");

describe("transcribe", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    mockGenerateContent.mockClear();
    mockOpenAITranscription.mockClear();
    mockElevenLabsSTT.mockClear();
    mockWhisperFull.mockClear();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test("transcribes with gemini provider", async () => {
    const data = new ArrayBuffer(100);
    const result = await transcribe(data, "gemini");
    expect(result).toBe("gemini transcription");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test("transcribes with openai provider", async () => {
    const data = new ArrayBuffer(100);
    const result = await transcribe(data, "openai");
    expect(result).toBe("openai transcription");
    expect(mockOpenAITranscription).toHaveBeenCalledTimes(1);
  });

  test("transcribes with elevenlabs provider", async () => {
    const data = new ArrayBuffer(100);
    const result = await transcribe(data, "elevenlabs");
    expect(result).toBe("elevenlabs transcription");
    expect(mockElevenLabsSTT).toHaveBeenCalledTimes(1);
  });

  test("transcribes with local provider", async () => {
    // local expects Float32Array PCM data
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    const result = await transcribe(samples.buffer as ArrayBuffer, "local");
    expect(result).toBe("whisper transcription");
    expect(mockWhisperFull).toHaveBeenCalledTimes(1);
  });

  test("defaults to local provider when not specified", async () => {
    const samples = new Float32Array([0.1, 0.2]);
    // The function signature defaults to "local"
    const result = await transcribe(samples.buffer as ArrayBuffer);
    expect(result).toBe("whisper transcription");
  });

  test("gemini provider sends base64 audio data", async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    await transcribe(data, "gemini");

    const calls = mockGenerateContent.mock.calls as any[];
    const content = calls[0]![0].contents[0].parts;
    // Should have inlineData and text parts
    expect(content.length).toBe(2);
    expect(content[0].inlineData.mimeType).toBe("audio/webm");
    expect(typeof content[0].inlineData.data).toBe("string"); // base64
  });

  test("returns empty string from gemini when text is null", async () => {
    mockGenerateContent.mockImplementation(async () => ({
      text: null as any,
    }));

    const data = new ArrayBuffer(10);
    const result = await transcribe(data, "gemini");
    expect(result).toBe("");

    // Restore
    mockGenerateContent.mockImplementation(async () => ({
      text: "gemini transcription",
    }));
  });

  test("trims whitespace from transcription", async () => {
    mockGenerateContent.mockImplementation(async () => ({
      text: "  hello world  ",
    }));

    const data = new ArrayBuffer(10);
    const result = await transcribe(data, "gemini");
    expect(result).toBe("hello world");

    // Restore
    mockGenerateContent.mockImplementation(async () => ({
      text: "gemini transcription",
    }));
  });
});
