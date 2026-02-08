/**
 * Lightweight CLI for pi-voice.
 * Runs without Electron – only `start` spawns the Electron daemon.
 * All other commands talk to the running daemon via Unix socket.
 */

import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  readRuntimeState,
  removeRuntimeState,
} from "./services/runtime-state.js";
import { sendCommand } from "./services/daemon-ipc.js";

type Command = "start" | "status" | "stop";

function usage(): never {
  console.log(`Usage: pi-voice <command>

Commands:
  start   Start the pi-voice daemon in the background (default)
  status  Show daemon status (state, PID, uptime)
  stop    Stop the running daemon`);
  process.exit(0);
}

function parseCommand(): Command {
  const arg = process.argv[2];
  if (!arg || arg === "start") return "start";
  if (arg === "status") return "status";
  if (arg === "stop") return "stop";
  if (arg === "--help" || arg === "-h") usage();
  console.error(`Unknown command: ${arg}`);
  usage();
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Walk up from `dir` to find the nearest directory containing package.json. */
function findPackageRoot(dir: string): string {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      // Reached filesystem root without finding package.json
      console.error("Could not find package root (no package.json found).");
      process.exit(1);
    }
    current = parent;
  }
}

/** Check if the daemon appears to be running (PID file + process alive). */
function isDaemonRunning(): boolean {
  return readRuntimeState() !== null;
}

// ── status ──────────────────────────────────────────────────────────
async function cmdStatus(): Promise<void> {
  const state = readRuntimeState();
  if (!state) {
    console.log("not running");
    return;
  }

  try {
    const res = await sendCommand("status");
    if (res.ok) {
      const uptime = typeof res.uptime === "number" ? Math.floor(res.uptime as number) : "?";
      console.log(
        `running: ${res.cwd} (pid: ${res.pid}, state: ${res.state}, uptime: ${uptime}s)`
      );
    } else {
      console.log(
        `running: ${state.cwd} (pid: ${state.pid}, since: ${state.startedAt})`
      );
      console.log(`  (daemon responded with error: ${res.error})`);
    }
  } catch {
    // Socket not reachable but PID file exists – stale state
    removeRuntimeState();
    console.log("not running (stale state cleaned up)");
  }
}

// ── stop ────────────────────────────────────────────────────────────
async function cmdStop(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log("pi-voice daemon is not running.");
    process.exit(1);
  }

  try {
    const res = await sendCommand("stop");
    if (res.ok) {
      console.log("Stopping pi-voice daemon...");
    } else {
      console.error(`Failed to stop daemon: ${res.error}`);
      process.exit(1);
    }
  } catch {
    // Socket not reachable – try SIGTERM as fallback
    const state = readRuntimeState();
    if (state) {
      try {
        process.kill(state.pid, "SIGTERM");
        console.log(`Stopping pi-voice daemon (pid: ${state.pid})...`);
      } catch {
        removeRuntimeState();
        console.log("pi-voice daemon is not running (stale state cleaned up).");
        process.exit(1);
      }
    }
  }
}

// ── start ───────────────────────────────────────────────────────────
async function cmdStart(): Promise<void> {
  if (isDaemonRunning()) {
    const state = readRuntimeState()!;
    console.error(
      `pi-voice daemon is already running in ${state.cwd} (pid: ${state.pid}).`
    );
    process.exit(1);
  }

  const cwd = process.cwd();

  // Resolve package root by walking up from current file to find package.json.
  // Works both from source (src/cli.ts) and built output (out/cli/cli.js).
  const projectRoot = findPackageRoot(import.meta.dirname);
  let electronBin: string;
  try {
    // The electron package's main export is a string path to the binary
    const _require = createRequire(import.meta.url);
    electronBin = _require("electron") as unknown as string;
  } catch {
    console.error("Could not find electron binary. Is 'electron' installed?");
    process.exit(1);
  }

  // Resolve main entry (built output)
  const mainEntry = join(projectRoot, "out", "main", "index.js");
  if (!existsSync(mainEntry)) {
    console.error(
      "Electron main entry not found. Run 'bun run build' first."
    );
    process.exit(1);
  }

  // Spawn Electron daemon as a detached background process
  const child = spawn(electronBin, [mainEntry], {
    cwd,
    env: {
      ...process.env,
      PI_VOICE_CWD: cwd,
    },
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(`pi-voice daemon started (pid: ${child.pid}, cwd: ${cwd})`);
}

// ── main ────────────────────────────────────────────────────────────
const command = parseCommand();
switch (command) {
  case "start":
    await cmdStart();
    break;
  case "status":
    await cmdStatus();
    break;
  case "stop":
    await cmdStop();
    break;
}
