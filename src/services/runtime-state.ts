import { join } from "node:path";
import { homedir } from "node:os";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";

export interface RuntimeState {
  pid: number;
  cwd: string;
  startedAt: string; // ISO 8601
}

const STATE_DIR = join(homedir(), ".pi-voice");
const STATE_FILE = join(STATE_DIR, "runtime-state.json");

/**
 * Ensure the state directory exists.
 */
function ensureDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

/**
 * Check whether a given PID is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

/**
 * Save runtime state to disk (called on successful start).
 */
export function saveRuntimeState(cwd: string): void {
  ensureDir();
  const state: RuntimeState = {
    pid: process.pid,
    cwd,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Read runtime state from disk. Returns null if not running
 * (missing file, stale PID, etc.).
 */
export function readRuntimeState(): RuntimeState | null {
  if (!existsSync(STATE_FILE)) return null;

  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const state: RuntimeState = JSON.parse(raw);

    // Validate PID is still alive
    if (!isProcessAlive(state.pid)) {
      // Stale file - clean up
      removeRuntimeState();
      return null;
    }

    return state;
  } catch {
    // Corrupt file - clean up
    removeRuntimeState();
    return null;
  }
}

/**
 * Remove runtime state file (called on graceful shutdown).
 */
export function removeRuntimeState(): void {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch {
    // Ignore - best effort
  }
}
