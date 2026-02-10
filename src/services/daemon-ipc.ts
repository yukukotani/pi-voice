/**
 * Unix socket–based IPC for daemon control.
 *
 * The daemon (Electron main process) runs a server on a Unix domain socket.
 * The CLI connects as a client, sends a JSON command, and receives a JSON response.
 *
 * Protocol (newline-delimited JSON):
 *   → { "command": "status" | "stop" }
 *   ← { "ok": true, ...payload } | { "ok": false, "error": "..." }
 */

import { createServer, createConnection, type Server } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { getSocketPath } from "./runtime-state.js";
import logger from "./logger.js";

// ── Types ────────────────────────────────────────────────────────────

export type DaemonCommand = "status" | "stop";

export interface DaemonRequest {
  command: DaemonCommand;
}

export interface DaemonResponse {
  ok: boolean;
  [key: string]: unknown;
}

export type CommandHandler = (
  command: DaemonCommand
) => DaemonResponse | Promise<DaemonResponse>;

// ── Server (daemon side) ─────────────────────────────────────────────

let server: Server | null = null;

/**
 * Start the daemon IPC server on a Unix domain socket.
 * Returns the socket path being listened on.
 */
export function startDaemonServer(handler: CommandHandler): string {
  const socketPath = getSocketPath();

  // Clean up stale socket file
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }

  server = createServer((conn) => {
    let buffer = "";

    conn.on("data", async (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const req: DaemonRequest = JSON.parse(line);
          const res = await handler(req.command);
          conn.write(JSON.stringify(res) + "\n");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          conn.write(JSON.stringify({ ok: false, error: msg }) + "\n");
        }
      }
    });

    conn.on("error", () => {
      // client disconnected – ignore
    });
  });

  server.listen(socketPath);
  logger.info({ socketPath }, "DaemonIPC listening");
  return socketPath;
}

/**
 * Stop the daemon IPC server and remove the socket file.
 */
export function stopDaemonServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  const socketPath = getSocketPath();
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }
  logger.info("DaemonIPC server stopped");
}

// ── Client (CLI side) ────────────────────────────────────────────────

/**
 * Send a command to the running daemon and return the response.
 * Throws if the daemon is not reachable.
 */
export function sendCommand(
  command: DaemonCommand,
  socketPath?: string
): Promise<DaemonResponse> {
  const target = socketPath ?? getSocketPath();

  return new Promise((resolve, reject) => {
    const conn = createConnection(target);
    let buffer = "";
    const timeout = setTimeout(() => {
      conn.destroy();
      reject(new Error("Daemon did not respond within 5 seconds"));
    }, 5000);

    conn.on("connect", () => {
      conn.write(JSON.stringify({ command } satisfies DaemonRequest) + "\n");
    });

    conn.on("data", (data) => {
      buffer += data.toString();
      const idx = buffer.indexOf("\n");
      if (idx !== -1) {
        clearTimeout(timeout);
        const line = buffer.slice(0, idx);
        conn.end();
        try {
          resolve(JSON.parse(line) as DaemonResponse);
        } catch {
          reject(new Error(`Invalid response from daemon: ${line}`));
        }
      }
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
