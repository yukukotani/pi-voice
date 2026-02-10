/**
 * Centralized pino logger for the pi-voice daemon.
 *
 * Outputs to both the console (stdout) and a log file simultaneously
 * using pino.multistream.
 *
 * Log file location (in order of precedence):
 *   1. PI_VOICE_LOG_PATH environment variable
 *   2. $XDG_CONFIG_HOME/pi-voice/daemon.log  (if XDG_CONFIG_HOME is set)
 *   3. ~/.config/pi-voice/daemon.log          (default)
 */

import { join } from "node:path";
import { homedir } from "node:os";
import pino from "pino";

function resolveLogPath(): string {
  const envPath = process.env["PI_VOICE_LOG_PATH"];
  if (envPath) return envPath;

  const configHome =
    process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
  return join(configHome, "pi-voice", "daemon.log");
}

const logPath = resolveLogPath();

const logger = pino(
  {
    level: "debug",
  },
  pino.multistream([
    // Console output (human-readable via stdout)
    { level: "debug", stream: process.stdout },
    // File output (JSON, auto-creates parent directories)
    {
      level: "debug",
      stream: pino.destination({ dest: logPath, mkdir: true, sync: false }),
    },
  ]),
);

export default logger;

/**
 * Return the resolved log file path (useful for status/diagnostics).
 */
export function getLogPath(): string {
  return logPath;
}
