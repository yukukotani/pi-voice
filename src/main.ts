/**
 * pi-voice daemon main process.
 * Runs as a plain Bun/Node process (no Electron).
 * Audio I/O is handled by node-web-audio-api via audio-engine.ts.
 */

import { FnHook } from "./services/fn-hook.js";
import { loadConfig } from "./services/config.js";
import { transcribe } from "./services/stt.js";
import {
  synthesizeStream,
  TTS_SAMPLE_RATE,
  TTS_CHANNELS,
  TTS_BITS_PER_SAMPLE,
} from "./services/tts.js";
import * as piSession from "./services/pi-session.js";
import type { AppState } from "./shared/types.js";
import {
  saveRuntimeState,
  removeRuntimeState,
} from "./services/runtime-state.js";
import {
  startDaemonServer,
  stopDaemonServer,
  type DaemonCommand,
  type DaemonResponse,
} from "./services/daemon-ipc.js";
import {
  playSoundEffect,
  startRecording,
  stopRecording,
  streamPlaybackStart,
  streamPlaybackChunk,
  streamPlaybackEnd,
  dispose as disposeAudioEngine,
} from "./services/audio-engine.js";

// ── Resolve working directory ───────────────────────────────────────
// CLI passes the caller's cwd via PI_VOICE_CWD env variable.
const workingCwd = process.env["PI_VOICE_CWD"] || process.cwd();

let fnHook: FnHook | null = null;
let currentState: AppState = "idle";

// Tell pi-session to use the caller's cwd
piSession.setSessionCwd(workingCwd);

function setState(state: AppState, message?: string) {
  currentState = state;
  console.log(`[Main] State: ${state}${message ? ` - ${message}` : ""}`);
}

// ── Voice pipeline ──────────────────────────────────────────────────

async function handleRecordingDone() {
  if (currentState !== "recording") return;

  const audioBuffer = stopRecording();

  // Skip very short recordings (likely accidental taps)
  if (!audioBuffer || audioBuffer.length < 1000) {
    console.log("[Main] Recording too short, ignoring");
    setState("idle", "Recording too short");
    return;
  }

  try {
    // Step 1: Transcribe
    setState("transcribing", "Transcribing...");
    const text = await transcribe(audioBuffer);

    if (!text) {
      setState("idle", "No speech detected");
      return;
    }

    // Step 2: Send to pi – start TTS as each text segment completes
    setState("thinking", `Sent: "${text}"`);

    let streamStarted = false;
    // Chain of TTS promises to guarantee playback order
    let ttsChain = Promise.resolve();

    await piSession.prompt(text, {
      onTextEnd: (segment) => {
        // Switch to speaking state & start stream on first segment
        if (!streamStarted) {
          streamStarted = true;
          setState("speaking", "Generating speech...");
          streamPlaybackStart(() => {
            // Called when all audio finishes playing
            if (currentState === "speaking") {
              setState("idle");
            }
          });
        }

        // Queue TTS for this segment (runs serially via chain)
        ttsChain = ttsChain.then(async () => {
          for await (const pcmChunk of synthesizeStream(segment)) {
            streamPlaybackChunk(
              pcmChunk,
              TTS_SAMPLE_RATE,
              TTS_CHANNELS,
              TTS_BITS_PER_SAMPLE,
            );
          }
        });
      },
    });

    // Wait for all queued TTS segments to finish
    await ttsChain;

    if (streamStarted) {
      streamPlaybackEnd();
    } else {
      setState("idle", "No response from pi");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Main] Pipeline error:", msg);
    setState("error", msg);
    // Return to idle after a brief error display
    setTimeout(() => {
      if (currentState === "error") setState("idle");
    }, 3000);
  }
}

// ── FnHook setup ────────────────────────────────────────────────────

function setupFnHook() {
  const config = loadConfig(workingCwd);

  fnHook = new FnHook(
    {
      onFnDown: () => {
        if (currentState !== "idle") {
          console.log(
            `[Main] ${config.keyDisplay} pressed but state is ${currentState}, ignoring`,
          );
          return;
        }
        setState("recording", "Recording...");
        playSoundEffect("toggle_on.wav");
        startRecording().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[Main] Microphone error:", msg);
          setState("error", msg);
          setTimeout(() => {
            if (currentState === "error") setState("idle");
          }, 3000);
        });
      },
      onFnUp: () => {
        if (currentState !== "recording") return;
        playSoundEffect("toggle_off.wav");
        handleRecordingDone();
      },
    },
    config.key,
    config.keyDisplay,
  );

  try {
    fnHook.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Main] FnHook error:", msg);
    setState("error", msg);
  }
}

// ── Daemon IPC command handler ──────────────────────────────────────

function handleDaemonCommand(command: DaemonCommand): DaemonResponse {
  switch (command) {
    case "status":
      return {
        ok: true,
        state: currentState,
        cwd: workingCwd,
        pid: process.pid,
        uptime: process.uptime(),
      };

    case "stop":
      // Schedule quit after responding
      setImmediate(() => {
        gracefulShutdown();
        process.exit(0);
      });
      return { ok: true };

    default:
      return { ok: false, error: `Unknown command: ${command}` };
  }
}

// ── Graceful shutdown ───────────────────────────────────────────────

function gracefulShutdown() {
  console.log("[Main] Shutting down...");
  fnHook?.stop();
  piSession.dispose();
  disposeAudioEngine();
  stopDaemonServer();
  removeRuntimeState();
}

// ── Signal handlers ─────────────────────────────────────────────────
process.on("SIGTERM", () => {
  gracefulShutdown();
  process.exit(0);
});

process.on("SIGINT", () => {
  gracefulShutdown();
  process.exit(0);
});

// ── Start ───────────────────────────────────────────────────────────

setupFnHook();

// Start daemon IPC server
startDaemonServer(handleDaemonCommand);

saveRuntimeState(workingCwd);
console.log(`[Main] pi-voice daemon started (cwd: ${workingCwd})`);
