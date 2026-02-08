import { contextBridge, ipcRenderer } from "electron";
import { IPC, type PiVoiceAPI, type AudioStreamMeta } from "./shared/types.js";

const api: PiVoiceAPI = {
  onStartRecording: (callback) => {
    ipcRenderer.on(IPC.START_RECORDING, () => callback());
  },
  onStopRecording: (callback) => {
    ipcRenderer.on(IPC.STOP_RECORDING, () => callback());
  },
  onPlayAudioStreamStart: (callback) => {
    ipcRenderer.on(
      IPC.PLAY_AUDIO_STREAM_START,
      (_event, meta: AudioStreamMeta) => callback(meta)
    );
  },
  onPlayAudioStreamChunk: (callback) => {
    ipcRenderer.on(
      IPC.PLAY_AUDIO_STREAM_CHUNK,
      (_event, pcmData: ArrayBuffer) => callback(pcmData)
    );
  },
  onPlayAudioStreamEnd: (callback) => {
    ipcRenderer.on(IPC.PLAY_AUDIO_STREAM_END, () => callback());
  },
  sendRecordingData: (data) => {
    ipcRenderer.send(IPC.RECORDING_DATA, data);
  },
  sendRecordingError: (error) => {
    ipcRenderer.send(IPC.RECORDING_ERROR, error);
  },
  sendPlaybackDone: () => {
    ipcRenderer.send(IPC.PLAYBACK_DONE);
  },
};

contextBridge.exposeInMainWorld("piVoice", api);
