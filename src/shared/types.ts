/** Application state machine */
export type AppState =
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

/** IPC channel names */
export const IPC = {
  // main -> renderer
  START_RECORDING: "start-recording",
  STOP_RECORDING: "stop-recording",
  PLAY_AUDIO: "play-audio",
  STATE_CHANGED: "state-changed",
  STATUS_MESSAGE: "status-message",

  // renderer -> main
  RECORDING_DATA: "recording-data",
  RECORDING_ERROR: "recording-error",
  PLAYBACK_DONE: "playback-done",
} as const;

/** Exposed API in renderer via contextBridge */
export interface PiVoiceAPI {
  onStartRecording: (callback: () => void) => void;
  onStopRecording: (callback: () => void) => void;
  onPlayAudio: (callback: (audioData: ArrayBuffer) => void) => void;
  onStateChanged: (callback: (state: AppState) => void) => void;
  onStatusMessage: (callback: (message: string) => void) => void;
  sendRecordingData: (data: ArrayBuffer) => void;
  sendRecordingError: (error: string) => void;
  sendPlaybackDone: () => void;
}

declare global {
  interface Window {
    piVoice: PiVoiceAPI;
  }
}
