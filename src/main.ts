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
import {
  saveRuntimeState,
  readRuntimeState,
  removeRuntimeState,
} from "./services/runtime-state.js";

// ── CLI command parsing ─────────────────────────────────────────────
type Command = "start" | "status" | "stop" | "show";

function parseCommand(): { command: Command; cwd: string } {
  // In packaged app:  argv = [electron, main.js, ...userArgs]
  // In dev mode:       argv = [electron, main.js, ...userArgs]
  // Electron may inject extra flags; scan for known commands.
  const args = process.argv.slice(1).filter((a) => !a.startsWith("--"));
  // The last non-flag argument that matches a known command wins.
  const known = new Set<Command>(["start", "status", "stop", "show"]);
  let command: Command = "start"; // default
  for (const arg of args) {
    if (known.has(arg as Command)) {
      command = arg as Command;
    }
  }

  // `cwd` is passed via additionalData from the second instance,
  // but for the primary instance we read the real cwd here.
  return { command, cwd: process.cwd() };
}

const { command: initialCommand, cwd: initialCwd } = parseCommand();

// ── status: quick exit without starting Electron fully ──────────────
if (initialCommand === "status") {
  // We need app.getPath("userData") which requires app to be ready,
  // but readRuntimeState uses it. We handle this after ready.
  app.whenReady().then(() => {
    const state = readRuntimeState();
    if (state) {
      console.log(`running: ${state.cwd} (pid: ${state.pid}, since: ${state.startedAt})`);
    } else {
      console.log("not running");
    }
    app.exit(0);
  });
  // Prevent any further setup
} else {
  // ── For start / stop / show we use single-instance lock ─────────
  setupApp();
}

function setupApp() {
  // additionalData lets the second-instance handler know what the
  // caller wants without parsing argv again.
  const additionalData = { command: initialCommand, cwd: initialCwd };
  const gotLock = app.requestSingleInstanceLock(additionalData);

  if (!gotLock) {
    // Another instance is already running.
    if (initialCommand === "start") {
      console.error("pi-voice is already running. Use 'pi-voice status' to check.");
      app.exit(1);
    }
    // For stop / show the request is forwarded via additionalData to
    // the primary instance's second-instance handler, then we exit.
    app.exit(0);
    return;
  }

  // We ARE the primary instance.
  if (initialCommand === "stop" || initialCommand === "show") {
    // No existing instance to talk to – nothing to do.
    if (initialCommand === "stop") {
      console.log("pi-voice is not running.");
    } else {
      console.log("pi-voice is not running. Use 'pi-voice start' first.");
    }
    app.exit(1);
    return;
  }

  // ── command === "start" from here on ─────────────────────────────
  let mainWindow: BrowserWindow | null = null;
  let fnHook: FnHook | null = null;
  let currentState: AppState = "idle";
  let forceQuit = false;

  // Tell pi-session to use the caller's cwd
  piSession.setSessionCwd(initialCwd);

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

    // Hide on close instead of destroying – keeps app running in background
    mainWindow.on("close", (e) => {
      if (!forceQuit) {
        e.preventDefault();
        mainWindow?.hide();
      }
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  function showWindow() {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
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
    session.defaultSession.webRequest.onHeadersReceived(
      (details, callback) => {
        const csp = isDev
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; media-src blob:"
          : "default-src 'self'; style-src 'self' 'unsafe-inline'; media-src blob:";
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [csp],
          },
        });
      }
    );
  }

  function gracefulShutdown() {
    fnHook?.stop();
    piSession.dispose();
    removeRuntimeState();
  }

  // ── Handle requests from second instances (stop / show) ───────────
  app.on(
    "second-instance",
    (_event, _argv, _workingDirectory, additionalData) => {
      const data = additionalData as { command: Command; cwd: string } | undefined;
      if (!data) return;

      switch (data.command) {
        case "show":
          showWindow();
          break;
        case "stop":
          gracefulShutdown();
          forceQuit = true;
          app.quit();
          break;
        case "start":
          // Primary already running; second instance will exit with error
          break;
      }
    }
  );

  // ── App lifecycle ─────────────────────────────────────────────────
  app.whenReady().then(() => {
    setupCsp();
    createWindow();
    setupIpcHandlers();
    setupFnHook();
    saveRuntimeState(initialCwd);
    console.log(`[Main] pi-voice started (cwd: ${initialCwd})`);
  });

  // On macOS, don't quit when all windows are closed – stay in background
  app.on("window-all-closed", () => {
    // Do nothing – keep running
  });

  app.on("activate", () => {
    // Re-show window when dock icon is clicked
    showWindow();
  });

  app.on("before-quit", () => {
    forceQuit = true;
    gracefulShutdown();
  });
}
