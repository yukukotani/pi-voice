import { app } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

export interface RuntimeState {
  pid: number;
  cwd: string;
  startedAt: string; // ISO 8601
}

/**
 * Returns the path to the runtime state file.
 * Uses Electron's userData directory so it's consistent across invocations.
 */
function stateFilePath(): string {
  return join(app.getPath("userData"), "runtime-state.json");
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
  const state: RuntimeState = {
    pid: process.pid,
    cwd,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(stateFilePath(), JSON.stringify(state, null, 2));
}

/**
 * Read runtime state from disk. Returns null if not running
 * (missing file, stale PID, etc.).
 */
export function readRuntimeState(): RuntimeState | null {
  const path = stateFilePath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    const state: RuntimeState = JSON.parse(raw);

    // Validate PID is still alive
    if (!isProcessAlive(state.pid)) {
      // Stale file – clean up
      removeRuntimeState();
      return null;
    }

    return state;
  } catch {
    // Corrupt file – clean up
    removeRuntimeState();
    return null;
  }
}

/**
 * Remove runtime state file (called on graceful shutdown).
 */
export function removeRuntimeState(): void {
  const path = stateFilePath();
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Ignore – best effort
  }
}
