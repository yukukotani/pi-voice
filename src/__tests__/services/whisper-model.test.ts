import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// We need to mock homedir and fetch for this module
const testHome = join(
  tmpdir(),
  `pi-voice-whisper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

mock.module("node:os", () => ({
  homedir: () => testHome,
}));

// Mock fetch for download tests
const originalFetch = globalThis.fetch;

const { resolveModelPath } = await import("../../services/whisper-model.js");

describe("whisper-model", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    mkdirSync(testHome, { recursive: true });
    savedEnv = {
      WHISPER_MODEL_PATH: process.env.WHISPER_MODEL_PATH,
      WHISPER_MODEL: process.env.WHISPER_MODEL,
    };
    delete process.env.WHISPER_MODEL_PATH;
    delete process.env.WHISPER_MODEL;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    globalThis.fetch = originalFetch;
    try {
      rmSync(testHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("uses WHISPER_MODEL_PATH when set and file exists", async () => {
    const fakeModelPath = join(testHome, "custom-model.bin");
    writeFileSync(fakeModelPath, "fake model data");
    process.env.WHISPER_MODEL_PATH = fakeModelPath;

    const result = await resolveModelPath();
    expect(result).toBe(fakeModelPath);
  });

  test("throws when WHISPER_MODEL_PATH is set but file does not exist", async () => {
    process.env.WHISPER_MODEL_PATH = "/nonexistent/model.bin";

    await expect(resolveModelPath()).rejects.toThrow("does not exist");
  });

  test("returns cached path when model already downloaded", async () => {
    const cacheDir = join(testHome, ".pi-agent", "whisper");
    mkdirSync(cacheDir, { recursive: true });
    const modelFile = join(cacheDir, "ggml-medium-q5_0.bin");
    writeFileSync(modelFile, "cached model");

    const result = await resolveModelPath();
    expect(result).toBe(modelFile);
  });

  test("respects WHISPER_MODEL env var for model name", async () => {
    process.env.WHISPER_MODEL = "base";
    const cacheDir = join(testHome, ".pi-agent", "whisper");
    mkdirSync(cacheDir, { recursive: true });
    const modelFile = join(cacheDir, "ggml-base.bin");
    writeFileSync(modelFile, "base model");

    const result = await resolveModelPath();
    expect(result).toBe(modelFile);
  });

  test("attempts download when model is not cached", async () => {
    // Mock fetch to simulate a download
    const fakeBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });

    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "4" }),
      body: fakeBody,
    })) as any;

    // Suppress stderr output from progress
    const origWrite = process.stderr.write;
    process.stderr.write = (() => true) as any;

    try {
      const result = await resolveModelPath();
      expect(result).toContain("ggml-medium-q5_0.bin");
      expect(existsSync(result)).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("throws on HTTP error during download", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      body: null,
    })) as any;

    // Suppress stderr
    const origWrite = process.stderr.write;
    process.stderr.write = (() => true) as any;

    try {
      await expect(resolveModelPath()).rejects.toThrow("HTTP 404");
    } finally {
      process.stderr.write = origWrite;
    }
  });
});
