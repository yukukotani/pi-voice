import { app, BrowserWindow, ipcMain, session } from "electron";
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

function setupCsp() {
  const isDev = !app.isPackaged && !!process.env["ELECTRON_RENDERER_URL"];
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; media-src blob:"
      : "default-src 'self'; style-src 'self' 'unsafe-inline'; media-src blob:";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

// App lifecycle
app.whenReady().then(() => {
  setupCsp();
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
