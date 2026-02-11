import { join } from "node:path";
import { readFileSync } from "node:fs";
import { UiohookKey } from "uiohook-napi";
import { z } from "zod";
import logger from "./logger.js";

// ── Types ────────────────────────────────────────────────────────────

export interface KeyBinding {
  /** Main key code (UiohookKey value) */
  keycode: number;
  /** Modifier flags */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** Supported speech provider */
export type SpeechProvider = "local" | "gemini" | "openai" | "elevenlabs";

export interface PiVoiceConfig {
  /** Key binding for push-to-talk (e.g. "ctrl+t", "meta+shift+i") */
  key: KeyBinding;
  /** Original key string for display (e.g. "meta+shift+i") */
  keyDisplay: string;
  /** Speech provider for STT & TTS (default: "gemini") */
  provider: SpeechProvider;
}

// ── Key name → UiohookKey mapping ────────────────────────────────────

const KEY_MAP: Record<string, number> = {
  // Letters
  a: UiohookKey.A,
  b: UiohookKey.B,
  c: UiohookKey.C,
  d: UiohookKey.D,
  e: UiohookKey.E,
  f: UiohookKey.F,
  g: UiohookKey.G,
  h: UiohookKey.H,
  i: UiohookKey.I,
  j: UiohookKey.J,
  k: UiohookKey.K,
  l: UiohookKey.L,
  m: UiohookKey.M,
  n: UiohookKey.N,
  o: UiohookKey.O,
  p: UiohookKey.P,
  q: UiohookKey.Q,
  r: UiohookKey.R,
  s: UiohookKey.S,
  t: UiohookKey.T,
  u: UiohookKey.U,
  v: UiohookKey.V,
  w: UiohookKey.W,
  x: UiohookKey.X,
  y: UiohookKey.Y,
  z: UiohookKey.Z,

  // Numbers
  "0": UiohookKey[0],
  "1": UiohookKey[1],
  "2": UiohookKey[2],
  "3": UiohookKey[3],
  "4": UiohookKey[4],
  "5": UiohookKey[5],
  "6": UiohookKey[6],
  "7": UiohookKey[7],
  "8": UiohookKey[8],
  "9": UiohookKey[9],

  // Function keys
  f1: UiohookKey.F1,
  f2: UiohookKey.F2,
  f3: UiohookKey.F3,
  f4: UiohookKey.F4,
  f5: UiohookKey.F5,
  f6: UiohookKey.F6,
  f7: UiohookKey.F7,
  f8: UiohookKey.F8,
  f9: UiohookKey.F9,
  f10: UiohookKey.F10,
  f11: UiohookKey.F11,
  f12: UiohookKey.F12,

  // Special keys
  space: UiohookKey.Space,
  enter: UiohookKey.Enter,
  return: UiohookKey.Enter,
  escape: UiohookKey.Escape,
  esc: UiohookKey.Escape,
  tab: UiohookKey.Tab,
  backspace: UiohookKey.Backspace,
  delete: UiohookKey.Delete,
  insert: UiohookKey.Insert,
  home: UiohookKey.Home,
  end: UiohookKey.End,
  pageup: UiohookKey.PageUp,
  pagedown: UiohookKey.PageDown,

  // Arrow keys
  up: UiohookKey.ArrowUp,
  down: UiohookKey.ArrowDown,
  left: UiohookKey.ArrowLeft,
  right: UiohookKey.ArrowRight,
  arrowup: UiohookKey.ArrowUp,
  arrowdown: UiohookKey.ArrowDown,
  arrowleft: UiohookKey.ArrowLeft,
  arrowright: UiohookKey.ArrowRight,

  // Punctuation
  semicolon: UiohookKey.Semicolon,
  equal: UiohookKey.Equal,
  comma: UiohookKey.Comma,
  minus: UiohookKey.Minus,
  period: UiohookKey.Period,
  slash: UiohookKey.Slash,
  backquote: UiohookKey.Backquote,
  bracketleft: UiohookKey.BracketLeft,
  backslash: UiohookKey.Backslash,
  bracketright: UiohookKey.BracketRight,
  quote: UiohookKey.Quote,
};

/** Modifier names recognized in key strings */
const MODIFIER_NAMES = new Set(["ctrl", "control", "shift", "alt", "opt", "option", "meta", "cmd", "command", "super", "win"]);

/**
 * Parse a key binding string like "ctrl+t" or "meta+shift+i" into a KeyBinding.
 * Throws if the string is invalid.
 */
export function parseKeyBinding(keyStr: string): KeyBinding {
  const parts = keyStr.toLowerCase().split("+").map((s) => s.trim());
  if (parts.length === 0 || parts.some((p) => p === "")) {
    throw new Error(`Invalid key binding: "${keyStr}"`);
  }

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let mainKey: string | undefined;

  for (const part of parts) {
    if (part === "ctrl" || part === "control") {
      ctrl = true;
    } else if (part === "shift") {
      shift = true;
    } else if (part === "alt" || part === "opt" || part === "option") {
      alt = true;
    } else if (part === "meta" || part === "cmd" || part === "command" || part === "super" || part === "win") {
      meta = true;
    } else {
      if (mainKey !== undefined) {
        throw new Error(`Multiple main keys in key binding: "${keyStr}"`);
      }
      mainKey = part;
    }
  }

  if (mainKey === undefined) {
    throw new Error(`No main key specified in key binding: "${keyStr}"`);
  }

  const keycode = KEY_MAP[mainKey];
  if (keycode === undefined) {
    throw new Error(`Unknown key "${mainKey}" in key binding: "${keyStr}"`);
  }

  return { keycode, ctrl, shift, alt, meta };
}

/**
 * Format a KeyBinding into a human-readable display string.
 * Uses macOS symbols when on macOS, otherwise text labels.
 */
export function formatKeyDisplay(binding: KeyBinding): string {
  const isMac = process.platform === "darwin";
  const parts: string[] = [];

  if (binding.ctrl) parts.push(isMac ? "\u2303" : "Ctrl");
  if (binding.alt) parts.push(isMac ? "\u2325" : "Alt");
  if (binding.shift) parts.push(isMac ? "\u21E7" : "Shift");
  if (binding.meta) parts.push(isMac ? "\u2318" : "Win");

  // Reverse lookup main key name
  const keyName = Object.entries(KEY_MAP).find(([, v]) => v === binding.keycode)?.[0]?.toUpperCase() ?? "?";
  parts.push(keyName);

  return parts.join(isMac ? "" : "+");
}

// ── Default config ───────────────────────────────────────────────────

const DEFAULT_KEY_STRING = "meta+shift+i";
const DEFAULT_PROVIDER: SpeechProvider = "local";

function defaultConfig(): PiVoiceConfig {
  const binding = parseKeyBinding(DEFAULT_KEY_STRING);
  return {
    key: binding,
    keyDisplay: formatKeyDisplay(binding),
    provider: DEFAULT_PROVIDER,
  };
}

// ── Zod schema for pi-voice.json ─────────────────────────────────────

const configFileSchema = z.object({
  key: z
    .string()
    .refine(
      (v) => {
        try {
          parseKeyBinding(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid key binding" },
    )
    .optional()
    .default(DEFAULT_KEY_STRING),
  provider: z.enum(["local", "gemini", "openai", "elevenlabs"]).optional().default(DEFAULT_PROVIDER),
});

// ── Config loader ────────────────────────────────────────────────────

/**
 * Custom error class thrown when the config file is present but invalid.
 * Callers should catch this to show a user-friendly message and exit.
 */
export class ConfigError extends Error {
  constructor(
    public readonly configPath: string,
    public readonly details: string,
  ) {
    super(`Invalid config at ${configPath}:\n${details}`);
    this.name = "ConfigError";
  }
}

/**
 * Load config from `<cwd>/.pi/pi-voice.json`.
 * Falls back to defaults if the file doesn't exist.
 * Throws `ConfigError` if the file exists but contains invalid values.
 */
export function loadConfig(cwd: string): PiVoiceConfig {
  const configPath = join(cwd, ".pi", "pi-voice.json");

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.info({ configPath }, "No config file found, using defaults");
      return defaultConfig();
    }
    throw new ConfigError(configPath, `Failed to read file: ${(err as Error).message}`);
  }

  // Parse JSON
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ConfigError(configPath, "Invalid JSON syntax");
  }

  // Validate with zod
  const result = configFileSchema.safeParse(json);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `"${issue.path.join(".")}"` : "(root)";
        return `  - ${path}: ${issue.message}`;
      })
      .join("\n");
    throw new ConfigError(configPath, details);
  }

  const parsed = result.data;
  const binding = parseKeyBinding(parsed.key);
  const display = formatKeyDisplay(binding);

  logger.info({ key: display, provider: parsed.provider, configPath }, "Loaded config");
  return { key: binding, keyDisplay: display, provider: parsed.provider };
}
