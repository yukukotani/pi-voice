import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { FnHook } from "./services/fn-hook.js";
import { loadConfig, ConfigError, type SpeechProvider } from "./services/config.js";
import { transcribe } from "./services/stt.js";
import {
  synthesizeStream,
  speakLocal,
  TTS_SAMPLE_RATE,
  TTS_CHANNELS,
  TTS_BITS_PER_SAMPLE,
} from "./services/tts.js";
import * as piSession from "./services/pi-session.js";
import { IPC, type AppState, type RecordingFormat } from "./shared/types.js";
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
import { resolveModelPath } from "./services/whisper-model.js";
import logger from "./services/logger.js";

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
  logger.info({ state, message }, "State changed");
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

    // Skip very short recordings (likely accidental taps)
    if (data.byteLength < 1000) {
      logger.info("Recording too short, ignoring");
      setState("idle", "Recording too short");
      return;
    }

    try {
      // Step 1: Transcribe
      setState("transcribing", "Transcribing...");
      const text = await transcribe(data, provider);

      if (!text) {
        setState("idle", "No speech detected");
        return;
      }

      // Step 2: Send to pi – start TTS as each text segment completes
      setState("thinking", `Sent: "${text}"`);

      if (provider === "local") {
        // Local TTS: say command plays directly through system audio
        let speakStarted = false;
        let ttsChain = Promise.resolve();

        await piSession.prompt(text, {
          onTextEnd: (segment) => {
            if (!speakStarted) {
              speakStarted = true;
              setState("speaking", "Speaking...");
            }
            ttsChain = ttsChain.then(() => speakLocal(segment));
          },
        });

        await ttsChain;

        if (!speakStarted) {
          setState("idle", "No response from pi");
        } else {
          setState("idle");
        }
      } else {
        // Cloud providers: stream PCM through Electron renderer
        let streamStarted = false;
        let ttsChain = Promise.resolve();

        await piSession.prompt(text, {
          onTextEnd: (segment) => {
            if (!streamStarted) {
              streamStarted = true;
              setState("speaking", "Generating speech...");
              mainWindow?.webContents.send(IPC.PLAY_AUDIO_STREAM_START, {
                sampleRate: TTS_SAMPLE_RATE,
                channels: TTS_CHANNELS,
                bitsPerSample: TTS_BITS_PER_SAMPLE,
              });
            }

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

        await ttsChain;

        if (streamStarted) {
          mainWindow?.webContents.send(IPC.PLAY_AUDIO_STREAM_END);
        } else {
          setState("idle", "No response from pi");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "Pipeline error");
      setState("error", msg);
      // Return to idle after a brief error display
      setTimeout(() => {
        if (currentState === "error") setState("idle");
      }, 3000);
    }
  });

  ipcMain.on(IPC.RECORDING_ERROR, (_event, error: string) => {
    logger.error({ err: error }, "Recording error");
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
  const recordingFormat: RecordingFormat = config.provider === "local" ? "pcm" : "webm";

  fnHook = new FnHook(
    {
      onFnDown: () => {
        if (currentState !== "idle") {
          logger.info(
            { key: config.keyDisplay, state: currentState },
            "Key pressed but not idle, ignoring",
          );
          return;
        }
        setState("recording", "Recording...");
        mainWindow?.webContents.send(IPC.START_RECORDING, recordingFormat);
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
    logger.error({ err: msg }, "FnHook error");
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
  logger.info("Shutting down...");
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
  logger.warn("Another instance is already running. Exiting.");
  app.quit();
}

// ── App lifecycle ───────────────────────────────────────────────────
app.whenReady().then(async () => {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(workingCwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error({ err: err.message }, "Config error");
    } else {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to load config");
    }
    app.quit();
    return;
  }

  // For local provider, ensure Whisper model is available (downloads if needed)
  if (config.provider === "local") {
    try {
      await resolveModelPath();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "Failed to prepare Whisper model");
      app.quit();
      return;
    }
  }

  createWindow();
  setupIpcHandlers(config.provider);
  setupFnHook(config);

  // Start daemon IPC server
  startDaemonServer(handleDaemonCommand);

  saveRuntimeState(workingCwd);
  logger.info({ cwd: workingCwd }, "pi-voice daemon started");
});

// Don't quit when all windows are closed – stay in background
app.on("window-all-closed", () => {
  // Do nothing – keep daemon running
});

app.on("before-quit", () => {
  gracefulShutdown();
});
