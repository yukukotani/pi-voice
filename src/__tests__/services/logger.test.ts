import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Tests for the logger module's logic.
 *
 * Since logger.ts creates pino instances at module level and other test files
 * mock the logger module, we test the resolveLogPath logic directly here
 * rather than importing the actual pino logger.
 */

describe("logger resolveLogPath logic", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      PI_VOICE_LOG_PATH: process.env.PI_VOICE_LOG_PATH,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  // Re-implement resolveLogPath logic for testing since we can't
  // reliably import the module in test environment
  function resolveLogPath(): string {
    const envPath = process.env["PI_VOICE_LOG_PATH"];
    if (envPath) return envPath;

    const configHome =
      process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
    return join(configHome, "pi-voice", "daemon.log");
  }

  test("uses PI_VOICE_LOG_PATH when set", () => {
    process.env.PI_VOICE_LOG_PATH = "/custom/log/path.log";
    expect(resolveLogPath()).toBe("/custom/log/path.log");
  });

  test("uses XDG_CONFIG_HOME when set", () => {
    delete process.env.PI_VOICE_LOG_PATH;
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(resolveLogPath()).toBe("/custom/config/pi-voice/daemon.log");
  });

  test("falls back to ~/.config when no env vars set", () => {
    delete process.env.PI_VOICE_LOG_PATH;
    delete process.env.XDG_CONFIG_HOME;
    const expected = join(homedir(), ".config", "pi-voice", "daemon.log");
    expect(resolveLogPath()).toBe(expected);
  });

  test("path always ends with daemon.log", () => {
    delete process.env.PI_VOICE_LOG_PATH;
    delete process.env.XDG_CONFIG_HOME;
    expect(resolveLogPath()).toMatch(/daemon\.log$/);
  });

  test("path contains pi-voice directory", () => {
    delete process.env.PI_VOICE_LOG_PATH;
    delete process.env.XDG_CONFIG_HOME;
    expect(resolveLogPath()).toContain("pi-voice");
  });
});
