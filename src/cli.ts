#!/usr/bin/env bun
/**
 * Lightweight CLI for pi-voice.
 * Runs without Electron – only `start` spawns the Electron daemon.
 */

import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  readRuntimeState,
  removeRuntimeState,
} from "./services/runtime-state.js";

type Command = "start" | "status" | "stop" | "show";

function usage(): never {
  console.log(`Usage: pi-voice <command>

Commands:
  start   Start pi-voice in the current directory (default)
  status  Show whether pi-voice is running and where
  stop    Stop the running instance
  show    Bring the window to front`);
  process.exit(0);
}

function parseCommand(): Command {
  const arg = process.argv[2];
  if (!arg || arg === "start") return "start";
  if (arg === "status") return "status";
  if (arg === "stop") return "stop";
  if (arg === "show") return "show";
  if (arg === "--help" || arg === "-h") usage();
  console.error(`Unknown command: ${arg}`);
  usage();
}

// ── status ──────────────────────────────────────────────────────────
function cmdStatus(): void {
  const state = readRuntimeState();
  if (state) {
    console.log(
      `running: ${state.cwd} (pid: ${state.pid}, since: ${state.startedAt})`
    );
  } else {
    console.log("not running");
  }
}

// ── stop ────────────────────────────────────────────────────────────
function cmdStop(): void {
  const state = readRuntimeState();
  if (!state) {
    console.log("pi-voice is not running.");
    process.exit(1);
  }
  try {
    process.kill(state.pid, "SIGTERM");
    console.log(`Stopping pi-voice (pid: ${state.pid})...`);
  } catch {
    // Process already gone – clean up stale state
    removeRuntimeState();
    console.log("pi-voice is not running (stale state cleaned up).");
    process.exit(1);
  }
}

// ── show ────────────────────────────────────────────────────────────
function cmdShow(): void {
  const state = readRuntimeState();
  if (!state) {
    console.error("pi-voice is not running. Use 'pi-voice start' first.");
    process.exit(1);
  }
  try {
    process.kill(state.pid, "SIGUSR1");
    console.log("Showing pi-voice window...");
  } catch {
    removeRuntimeState();
    console.error("pi-voice is not running (stale state cleaned up).");
    process.exit(1);
  }
}

// ── start ───────────────────────────────────────────────────────────
function cmdStart(): void {
  const state = readRuntimeState();
  if (state) {
    console.error(
      `pi-voice is already running in ${state.cwd} (pid: ${state.pid}).`
    );
    process.exit(1);
  }

  const cwd = process.cwd();

  // Resolve electron binary
  // 1. Try local node_modules (dev)
  // 2. Fall back to require.resolve (installed)
  const projectRoot = resolve(import.meta.dirname, "..");
  const localElectron = join(
    projectRoot,
    "node_modules",
    ".bin",
    "electron"
  );
  let electronBin: string;
  if (existsSync(localElectron)) {
    electronBin = localElectron;
  } else {
    console.error("Could not find electron binary.");
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

  // Spawn Electron as a detached background process
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

  console.log(`pi-voice started (pid: ${child.pid}, cwd: ${cwd})`);
}

// ── main ────────────────────────────────────────────────────────────
const command = parseCommand();
switch (command) {
  case "start":
    cmdStart();
    break;
  case "status":
    cmdStatus();
    break;
  case "stop":
    cmdStop();
    break;
  case "show":
    cmdShow();
    break;
}
