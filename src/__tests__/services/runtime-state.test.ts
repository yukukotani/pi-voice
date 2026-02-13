import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// We need to mock the module-level constants (STATE_DIR, etc.) by
// controlling homedir() since runtime-state.ts uses homedir() at module load time.
// Instead, we'll test the exported functions with their real file operations
// in a temporary directory by mocking homedir.

const testHome = join(
  tmpdir(),
  `pi-voice-rt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

mock.module("node:os", () => ({
  homedir: () => testHome,
}));

// Re-import after mock
const {
  saveRuntimeState,
  readRuntimeState,
  removeRuntimeState,
  getSocketPath,
} = await import("../../services/runtime-state.js");

describe("runtime-state", () => {
  beforeEach(() => {
    mkdirSync(testHome, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("getSocketPath", () => {
    test("returns a path under .pi-voice", () => {
      const socketPath = getSocketPath();
      expect(socketPath).toContain(".pi-voice");
      expect(socketPath).toContain("daemon.sock");
    });

    test("creates state directory if missing", () => {
      const stateDir = join(testHome, ".pi-voice");
      if (existsSync(stateDir)) {
        rmSync(stateDir, { recursive: true });
      }
      const socketPath = getSocketPath();
      expect(existsSync(join(testHome, ".pi-voice"))).toBe(true);
    });
  });

  describe("saveRuntimeState", () => {
    test("writes state file with pid, cwd, and startedAt", () => {
      saveRuntimeState("/test/cwd");

      const stateFile = join(testHome, ".pi-voice", "runtime-state.json");
      expect(existsSync(stateFile)).toBe(true);

      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      expect(state.pid).toBe(process.pid);
      expect(state.cwd).toBe("/test/cwd");
      expect(state.startedAt).toBeDefined();
      // startedAt should be a valid ISO string
      expect(new Date(state.startedAt).toISOString()).toBe(state.startedAt);
    });
  });

  describe("readRuntimeState", () => {
    test("returns null when no state file exists", () => {
      expect(readRuntimeState()).toBeNull();
    });

    test("returns state when file exists and PID is alive (current process)", () => {
      saveRuntimeState("/test/cwd");
      const state = readRuntimeState();
      expect(state).not.toBeNull();
      expect(state!.pid).toBe(process.pid);
      expect(state!.cwd).toBe("/test/cwd");
    });

    test("returns null and cleans up for stale PID", () => {
      const stateDir = join(testHome, ".pi-voice");
      mkdirSync(stateDir, { recursive: true });
      const stateFile = join(stateDir, "runtime-state.json");

      // Write state with a PID that definitely doesn't exist
      writeFileSync(
        stateFile,
        JSON.stringify({
          pid: 999999999,
          cwd: "/test/cwd",
          startedAt: new Date().toISOString(),
        }),
      );

      const state = readRuntimeState();
      expect(state).toBeNull();
      // File should be cleaned up
      expect(existsSync(stateFile)).toBe(false);
    });

    test("returns null and cleans up for corrupt JSON", () => {
      const stateDir = join(testHome, ".pi-voice");
      mkdirSync(stateDir, { recursive: true });
      const stateFile = join(stateDir, "runtime-state.json");

      writeFileSync(stateFile, "corrupt{{{");

      const state = readRuntimeState();
      expect(state).toBeNull();
    });
  });

  describe("removeRuntimeState", () => {
    test("removes state file if it exists", () => {
      saveRuntimeState("/test/cwd");
      const stateFile = join(testHome, ".pi-voice", "runtime-state.json");
      expect(existsSync(stateFile)).toBe(true);

      removeRuntimeState();
      expect(existsSync(stateFile)).toBe(false);
    });

    test("does not throw when state file does not exist", () => {
      expect(() => removeRuntimeState()).not.toThrow();
    });
  });
});
