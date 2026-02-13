import { describe, test, expect, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:net";

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Each test uses its own socket path to avoid bind conflicts
let testCounter = 0;
function makeTestDir(): string {
  testCounter++;
  const dir = join(
    tmpdir(),
    `pi-voice-ipc-${Date.now()}-${testCounter}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Mock runtime-state with a per-call unique socket path
let currentTestSocketPath = "";
mock.module("../../services/runtime-state.js", () => ({
  getSocketPath: () => currentTestSocketPath,
  saveRuntimeState: () => {},
  readRuntimeState: () => null,
  removeRuntimeState: () => {},
}));

const {
  startDaemonServer,
  stopDaemonServer,
  sendCommand,
} = await import("../../services/daemon-ipc.js");

const cleanupDirs: string[] = [];

afterEach(() => {
  stopDaemonServer();
  for (const dir of cleanupDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  cleanupDirs.length = 0;
});

describe("daemon-ipc", () => {
  test("startDaemonServer returns socket path", () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    currentTestSocketPath = join(dir, "daemon.sock");

    const handler = () => ({ ok: true });
    const socketPath = startDaemonServer(handler);
    expect(socketPath).toContain("daemon.sock");
  });

  test("sendCommand receives response from handler", async () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    currentTestSocketPath = join(dir, "daemon.sock");

    const handler = (cmd: string) => {
      if (cmd === "status") {
        return { ok: true, state: "idle", pid: 123 };
      }
      return { ok: false, error: "unknown" };
    };

    const socketPath = startDaemonServer(handler);

    // Wait for the server to be ready
    await new Promise((r) => setTimeout(r, 100));

    const res = await sendCommand("status", socketPath);
    expect(res.ok).toBe(true);
    expect(res.state).toBe("idle");
    expect(res.pid).toBe(123);
  });

  test("sendCommand receives error response for unknown command", async () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    currentTestSocketPath = join(dir, "daemon.sock");

    const handler = (cmd: string) => {
      return { ok: false, error: `Unknown: ${cmd}` };
    };

    const socketPath = startDaemonServer(handler);
    await new Promise((r) => setTimeout(r, 100));

    const res = await sendCommand("stop", socketPath);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Unknown: stop");
  });

  test("sendCommand rejects when server is not running", async () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    const fakePath = join(dir, "nonexistent.sock");

    await expect(sendCommand("status", fakePath)).rejects.toThrow();
  });

  test("stopDaemonServer cleans up socket file", async () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    currentTestSocketPath = join(dir, "daemon.sock");

    const handler = () => ({ ok: true });
    const socketPath = startDaemonServer(handler);
    await new Promise((r) => setTimeout(r, 100));

    stopDaemonServer();

    // Socket file should be removed
    expect(existsSync(socketPath)).toBe(false);
  });

  test("startDaemonServer handles stale socket file", () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    const sockPath = join(dir, "daemon.sock");
    currentTestSocketPath = sockPath;

    // Create stale socket file
    writeFileSync(sockPath, "stale");

    const handler = () => ({ ok: true });
    const resultPath = startDaemonServer(handler);
    expect(resultPath).toBe(sockPath);
  });

  test("handler errors are returned as error responses", async () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    currentTestSocketPath = join(dir, "daemon.sock");

    const handler = () => {
      throw new Error("handler failed");
    };

    const socketPath = startDaemonServer(handler);
    await new Promise((r) => setTimeout(r, 100));

    const res = await sendCommand("status", socketPath);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("handler failed");
  });

  test("async handler is supported", async () => {
    const dir = makeTestDir();
    cleanupDirs.push(dir);
    currentTestSocketPath = join(dir, "daemon.sock");

    const handler = async (cmd: string) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true, command: cmd };
    };

    const socketPath = startDaemonServer(handler);
    await new Promise((r) => setTimeout(r, 100));

    const res = await sendCommand("status", socketPath);
    expect(res.ok).toBe(true);
    expect(res.command).toBe("status");
  });
});
