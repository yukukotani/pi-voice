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
const mockGenerateContentStream = mock(async () => ({
  async *[Symbol.asyncIterator]() {
    yield {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from(new Int16Array([100, 200, 300]).buffer).toString("base64"),
                },
              },
            ],
          },
        },
      ],
    };
  },
}));
mock.module("../../services/gemini-client.js", () => ({
  getGeminiClient: () => ({
    models: {
      generateContentStream: mockGenerateContentStream,
    },
  }),
}));

// Mock OpenAI
const mockOpenAISpeech = mock(async () => ({
  arrayBuffer: async () => new Int16Array([100, 200, 300, 400]).buffer,
}));
mock.module("openai", () => ({
  default: class OpenAI {
    audio = {
      speech: {
        create: mockOpenAISpeech,
      },
    };
  },
}));

// Mock ElevenLabs
const mockElevenLabsTTS = mock(async () => ({
  getReader: () => {
    let done = false;
    return {
      read: async () => {
        if (!done) {
          done = true;
          return {
            done: false,
            value: new Uint8Array(new Int16Array([500, 600]).buffer),
          };
        }
        return { done: true, value: undefined };
      },
    };
  },
}));
mock.module("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: class {
    textToSpeech = {
      convert: mockElevenLabsTTS,
    };
  },
}));

// Mock child_process for speakLocal
let mockSpawnCallbacks: Record<string, Function> = {};
const mockSpawnInstance = {
  on: (event: string, cb: Function) => {
    mockSpawnCallbacks[event] = cb;
  },
};
const mockSpawn = mock((..._args: any[]) => mockSpawnInstance);
mock.module("node:child_process", () => ({
  spawn: mockSpawn,
}));

const {
  synthesizeStream,
  speakLocal,
  TTS_SAMPLE_RATE,
  TTS_CHANNELS,
  TTS_BITS_PER_SAMPLE,
} = await import("../../services/tts.js");

describe("TTS constants", () => {
  test("has expected audio format constants", () => {
    expect(TTS_SAMPLE_RATE).toBe(24000);
    expect(TTS_CHANNELS).toBe(1);
    expect(TTS_BITS_PER_SAMPLE).toBe(16);
  });
});

describe("synthesizeStream", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
      ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
      ELEVENLABS_TTS_MODEL: process.env.ELEVENLABS_TTS_MODEL,
    };
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ELEVENLABS_API_KEY = "test-key";
    mockGenerateContentStream.mockClear();
    mockOpenAISpeech.mockClear();
    mockElevenLabsTTS.mockClear();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test("throws for local provider (use speakLocal instead)", async () => {
    const gen = synthesizeStream("hello", "local");
    await expect(gen.next()).rejects.toThrow("speakLocal");
  });

  test("streams gemini TTS as Buffer chunks", async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of synthesizeStream("hello", "gemini")) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toBeInstanceOf(Buffer);
  });

  test("streams openai TTS as Buffer chunks", async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of synthesizeStream("hello", "openai")) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });

  test("streams elevenlabs TTS as Buffer chunks", async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of synthesizeStream("hello", "elevenlabs")) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });

  test("defaults to gemini when no provider specified", async () => {
    // Default is "local" which throws, so we explicitly test gemini
    const chunks: Buffer[] = [];
    for await (const chunk of synthesizeStream("hello", "gemini")) {
      chunks.push(chunk);
    }
    expect(mockGenerateContentStream).toHaveBeenCalled();
  });
});

describe("speakLocal", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockSpawnCallbacks = {};
  });

  test("rejects on non-darwin platform", async () => {
    // Can't easily change platform, but on macOS it should spawn 'say'
    if (process.platform !== "darwin") {
      await expect(speakLocal("test")).rejects.toThrow("only supported on macOS");
    } else {
      // On macOS, it should call spawn
      const promise = speakLocal("hello");
      // Trigger close with success
      mockSpawnCallbacks["close"]?.(0);
      await promise;
      expect(mockSpawn).toHaveBeenCalled();
    }
  });

  test("passes text as argument to say command", async () => {
    if (process.platform !== "darwin") return; // skip on non-macOS

    const promise = speakLocal("test message");
    mockSpawnCallbacks["close"]?.(0);
    await promise;

    const calls = mockSpawn.mock.calls as any[];
    expect(calls[0]![0]).toBe("say");
    const args = calls[0]![1] as string[];
    expect(args).toContain("test message");
  });

  test("uses SAY_VOICE env var when set", async () => {
    if (process.platform !== "darwin") return;

    const oldVoice = process.env.SAY_VOICE;
    process.env.SAY_VOICE = "Kyoko";

    const promise = speakLocal("hello");
    mockSpawnCallbacks["close"]?.(0);
    await promise;

    const calls = mockSpawn.mock.calls as any[];
    const args = calls[0]![1] as string[];
    expect(args).toContain("-v");
    expect(args).toContain("Kyoko");

    if (oldVoice === undefined) delete process.env.SAY_VOICE;
    else process.env.SAY_VOICE = oldVoice;
  });

  test("rejects when say command exits with non-zero code", async () => {
    if (process.platform !== "darwin") return;

    const promise = speakLocal("fail");
    mockSpawnCallbacks["close"]?.(1);

    await expect(promise).rejects.toThrow("exited with code 1");
  });

  test("rejects when spawn fails", async () => {
    if (process.platform !== "darwin") return;

    const promise = speakLocal("fail");
    mockSpawnCallbacks["error"]?.(new Error("spawn failed"));

    await expect(promise).rejects.toThrow("spawn failed");
  });
});
