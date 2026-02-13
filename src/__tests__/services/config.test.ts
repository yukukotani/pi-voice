import { describe, test, expect, beforeEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Mock logger to prevent file I/O during tests
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

import {
  parseKeyBinding,
  formatKeyDisplay,
  loadConfig,
  ConfigError,
} from "../../services/config.js";

describe("parseKeyBinding", () => {
  test("parses simple key", () => {
    const result = parseKeyBinding("t");
    expect(result.keycode).toBeGreaterThan(0);
    expect(result.ctrl).toBe(false);
    expect(result.shift).toBe(false);
    expect(result.alt).toBe(false);
    expect(result.meta).toBe(false);
  });

  test("parses ctrl+t", () => {
    const result = parseKeyBinding("ctrl+t");
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(false);
    expect(result.alt).toBe(false);
    expect(result.meta).toBe(false);
  });

  test("parses meta+shift+i (default binding)", () => {
    const result = parseKeyBinding("meta+shift+i");
    expect(result.meta).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.ctrl).toBe(false);
    expect(result.alt).toBe(false);
  });

  test("parses cmd as meta alias", () => {
    const result = parseKeyBinding("cmd+t");
    expect(result.meta).toBe(true);
  });

  test("parses command as meta alias", () => {
    const result = parseKeyBinding("command+t");
    expect(result.meta).toBe(true);
  });

  test("parses control as ctrl alias", () => {
    const result = parseKeyBinding("control+a");
    expect(result.ctrl).toBe(true);
  });

  test("parses opt/option as alt aliases", () => {
    expect(parseKeyBinding("opt+a").alt).toBe(true);
    expect(parseKeyBinding("option+a").alt).toBe(true);
  });

  test("parses function keys", () => {
    const f1 = parseKeyBinding("f1");
    expect(f1.keycode).toBeGreaterThan(0);
    const f12 = parseKeyBinding("f12");
    expect(f12.keycode).toBeGreaterThan(0);
    expect(f1.keycode).not.toBe(f12.keycode);
  });

  test("parses number keys", () => {
    const result = parseKeyBinding("ctrl+1");
    expect(result.ctrl).toBe(true);
    expect(result.keycode).toBeGreaterThan(0);
  });

  test("parses special keys", () => {
    expect(parseKeyBinding("space").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("enter").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("escape").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("tab").keycode).toBeGreaterThan(0);
  });

  test("parses arrow keys", () => {
    expect(parseKeyBinding("up").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("arrowup").keycode).toBeGreaterThan(0);
    // arrowup and up should map to same keycode
    expect(parseKeyBinding("up").keycode).toBe(parseKeyBinding("arrowup").keycode);
  });

  test("is case insensitive", () => {
    const lower = parseKeyBinding("ctrl+t");
    const upper = parseKeyBinding("Ctrl+T");
    expect(lower.keycode).toBe(upper.keycode);
    expect(lower.ctrl).toBe(upper.ctrl);
  });

  test("trims whitespace in parts", () => {
    const result = parseKeyBinding(" ctrl + t ");
    expect(result.ctrl).toBe(true);
  });

  test("throws on empty string", () => {
    expect(() => parseKeyBinding("")).toThrow("Invalid key binding");
  });

  test("throws on modifier-only binding", () => {
    expect(() => parseKeyBinding("ctrl")).toThrow("No main key specified");
  });

  test("throws on multiple main keys", () => {
    expect(() => parseKeyBinding("a+b")).toThrow("Multiple main keys");
  });

  test("throws on unknown key", () => {
    expect(() => parseKeyBinding("ctrl+unknownkey")).toThrow('Unknown key "unknownkey"');
  });

  test("throws on empty parts (double plus)", () => {
    expect(() => parseKeyBinding("ctrl++t")).toThrow("Invalid key binding");
  });

  test("all modifier combos at once", () => {
    const result = parseKeyBinding("ctrl+shift+alt+meta+t");
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.alt).toBe(true);
    expect(result.meta).toBe(true);
  });
});

describe("formatKeyDisplay", () => {
  test("formats simple key on macOS", () => {
    const binding = parseKeyBinding("t");
    const display = formatKeyDisplay(binding);
    expect(display).toContain("T");
  });

  test("formats meta+shift+i binding", () => {
    const binding = parseKeyBinding("meta+shift+i");
    const display = formatKeyDisplay(binding);
    // On macOS it uses unicode symbols; on other platforms text labels
    expect(display.length).toBeGreaterThan(0);
    expect(display).toContain("I");
  });

  test("includes all modifiers in output", () => {
    const binding = parseKeyBinding("ctrl+shift+alt+meta+a");
    const display = formatKeyDisplay(binding);
    expect(display).toContain("A");
    // Should have at least 4 modifiers + key
    expect(display.length).toBeGreaterThan(4);
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pi-voice-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  test("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("local");
    expect(config.key.meta).toBe(true);
    expect(config.key.shift).toBe(true);
    expect(config.keyDisplay.length).toBeGreaterThan(0);
  });

  test("loads valid config file", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "pi-voice.json"),
      JSON.stringify({ key: "ctrl+t", provider: "gemini" }),
    );

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("gemini");
    expect(config.key.ctrl).toBe(true);
  });

  test("uses defaults for missing fields", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "pi-voice.json"), JSON.stringify({}));

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("local");
    expect(config.key.meta).toBe(true);
    expect(config.key.shift).toBe(true);
  });

  test("accepts all valid providers", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });

    for (const provider of ["local", "gemini", "openai", "elevenlabs"] as const) {
      writeFileSync(
        join(piDir, "pi-voice.json"),
        JSON.stringify({ provider }),
      );
      const config = loadConfig(tmpDir);
      expect(config.provider).toBe(provider);
    }
  });

  test("throws ConfigError on invalid JSON syntax", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "pi-voice.json"), "not json {{{");

    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
    try {
      loadConfig(tmpDir);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).details).toContain("Invalid JSON");
    }
  });

  test("throws ConfigError on invalid provider", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "pi-voice.json"),
      JSON.stringify({ provider: "invalid-provider" }),
    );

    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
  });

  test("throws ConfigError on invalid key binding", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "pi-voice.json"),
      JSON.stringify({ key: "unknownkey" }),
    );

    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
  });

  test("ConfigError includes configPath and details", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const configPath = join(piDir, "pi-voice.json");
    writeFileSync(configPath, "bad json");

    try {
      loadConfig(tmpDir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.configPath).toBe(configPath);
      expect(ce.details).toBeDefined();
      expect(ce.name).toBe("ConfigError");
    }
  });
});
