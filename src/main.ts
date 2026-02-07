import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FnHook } from "./services/fn-hook.js";
import { transcribe } from "./services/stt.js";
import {
  synthesizeStream,
  TTS_SAMPLE_RATE,
  TTS_CHANNELS,
  TTS_BITS_PER_SAMPLE,
} from "./services/tts.js";
import * as piSession from "./services/pi-session.js";
import { IPC, type AppState } from "./shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let fnHook: FnHook | null = null;
let currentState: AppState = "idle";

function setState(state: AppState, message?: string) {
  currentState = state;
  console.log(`[Main] State: ${state}${message ? ` - ${message}` : ""}`);
  mainWindow?.webContents.send(IPC.STATE_CHANGED, state);
  if (message) {
    mainWindow?.webContents.send(IPC.STATUS_MESSAGE, message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    resizable: true,
    alwaysOnTop: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupIpcHandlers() {
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
            for await (const pcmChunk of synthesizeStream(segment)) {
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

function setupFnHook() {
  fnHook = new FnHook({
    onFnDown: () => {
      if (currentState !== "idle") {
        console.log(
          `[Main] Fn pressed but state is ${currentState}, ignoring`
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
  });

  try {
    fnHook.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Main] FnHook error:", msg);
    setState("error", msg);
  }
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();
  setupFnHook();
});

app.on("window-all-closed", () => {
  fnHook?.stop();
  piSession.dispose();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  fnHook?.stop();
  piSession.dispose();
});
