import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { FnHook } from "./services/fn-hook.js";
import { loadConfig, type SpeechProvider } from "./services/config.js";
import { transcribe } from "./services/stt.js";
import {
  synthesizeStream,
  TTS_SAMPLE_RATE,
  TTS_CHANNELS,
  TTS_BITS_PER_SAMPLE,
} from "./services/tts.js";
import * as piSession from "./services/pi-session.js";
import { IPC, type AppState } from "./shared/types.js";
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

// ── Resolve working directory ───────────────────────────────────────
// CLI passes the caller's cwd via PI_VOICE_CWD env variable.
const workingCwd = process.env["PI_VOICE_CWD"] || process.cwd();

let mainWindow: BrowserWindow | null = null;
let fnHook: FnHook | null = null;
let currentState: AppState = "idle";

// Tell pi-session to use the caller's cwd
piSession.setSessionCwd(workingCwd);

function setState(state: AppState, message?: string) {
  currentState = state;
  console.log(`[Main] State: ${state}${message ? ` - ${message}` : ""}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    // Hidden audio worker – never shown to user
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: fileURLToPath(
        new URL("../preload/index.cjs", import.meta.url)
      ),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(
      fileURLToPath(
        new URL("../renderer/index.html", import.meta.url)
      )
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupIpcHandlers(provider: SpeechProvider) {
  // Receive recording data from renderer
  ipcMain.on(IPC.RECORDING_DATA, async (_event, data: ArrayBuffer) => {
    if (currentState !== "recording") return;

    const audioBuffer = Buffer.from(data);

    // Skip very short recordings (likely accidental taps)
    if (audioBuffer.length < 1000) {
      console.log("[Main] Recording too short, ignoring");
      setState("idle", "Recording too short");
      return;
    }

    try {
      // Step 1: Transcribe
      setState("transcribing", "Transcribing...");
      const text = await transcribe(audioBuffer, provider);

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
          // Switch to speaking state & send stream-start on first segment
          if (!streamStarted) {
            streamStarted = true;
            setState("speaking", "Generating speech...");
            mainWindow?.webContents.send(IPC.PLAY_AUDIO_STREAM_START, {
              sampleRate: TTS_SAMPLE_RATE,
              channels: TTS_CHANNELS,
              bitsPerSample: TTS_BITS_PER_SAMPLE,
            });
          }

          // Queue TTS for this segment (runs serially via chain)
          ttsChain = ttsChain.then(async () => {
            for await (const pcmChunk of synthesizeStream(segment, provider)) {
              mainWindow?.webContents.send(
                IPC.PLAY_AUDIO_STREAM_CHUNK,
                pcmChunk.buffer.slice(
                  pcmChunk.byteOffset,
                  pcmChunk.byteOffset + pcmChunk.byteLength
                )
              );
            }
          });
        },
      });

      // Wait for all queued TTS segments to finish
      await ttsChain;

      if (streamStarted) {
        mainWindow?.webContents.send(IPC.PLAY_AUDIO_STREAM_END);
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
  });

  ipcMain.on(IPC.RECORDING_ERROR, (_event, error: string) => {
    console.error("[Main] Recording error:", error);
    setState("error", error);
    setTimeout(() => {
      if (currentState === "error") setState("idle");
    }, 3000);
  });

  ipcMain.on(IPC.PLAYBACK_DONE, () => {
    if (currentState === "speaking") {
      setState("idle");
    }
  });
}

function setupFnHook(config: ReturnType<typeof loadConfig>) {
  fnHook = new FnHook(
    {
      onFnDown: () => {
        if (currentState !== "idle") {
          console.log(
            `[Main] ${config.keyDisplay} pressed but state is ${currentState}, ignoring`
          );
          return;
        }
        setState("recording", "Recording...");
        mainWindow?.webContents.send(IPC.START_RECORDING);
      },
      onFnUp: () => {
        if (currentState !== "recording") return;
        mainWindow?.webContents.send(IPC.STOP_RECORDING);
        // State will transition when recording data arrives via IPC
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
        app.quit();
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
  stopDaemonServer();
  removeRuntimeState();
}

// ── Signal handlers (legacy – kept for direct kill signals) ─────────
process.on("SIGTERM", () => {
  gracefulShutdown();
  app.quit();
});

// ── Single instance lock ────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("[Main] Another instance is already running. Exiting.");
  app.quit();
}

// ── App lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
  const config = loadConfig(workingCwd);

  createWindow();
  setupIpcHandlers(config.provider);
  setupFnHook(config);

  // Start daemon IPC server
  startDaemonServer(handleDaemonCommand);

  saveRuntimeState(workingCwd);
  console.log(`[Main] pi-voice daemon started (cwd: ${workingCwd})`);
});

// Don't quit when all windows are closed – stay in background
app.on("window-all-closed", () => {
  // Do nothing – keep daemon running
});

app.on("before-quit", () => {
  gracefulShutdown();
});
