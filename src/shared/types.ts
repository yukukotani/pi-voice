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
  PLAY_AUDIO_STREAM_START: "play-audio-stream-start",
  PLAY_AUDIO_STREAM_CHUNK: "play-audio-stream-chunk",
  PLAY_AUDIO_STREAM_END: "play-audio-stream-end",
  STATE_CHANGED: "state-changed",
  STATUS_MESSAGE: "status-message",

  // renderer -> main
  RECORDING_DATA: "recording-data",
  RECORDING_ERROR: "recording-error",
  PLAYBACK_DONE: "playback-done",
} as const;

/** Audio stream metadata sent at the start of a streaming TTS session */
export interface AudioStreamMeta {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/** Exposed API in renderer via contextBridge */
export interface PiVoiceAPI {
  onStartRecording: (callback: () => void) => void;
  onStopRecording: (callback: () => void) => void;
  onPlayAudioStreamStart: (callback: (meta: AudioStreamMeta) => void) => void;
  onPlayAudioStreamChunk: (callback: (pcmData: ArrayBuffer) => void) => void;
  onPlayAudioStreamEnd: (callback: () => void) => void;
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
