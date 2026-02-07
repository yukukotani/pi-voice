import { contextBridge, ipcRenderer } from "electron";
import { IPC, type PiVoiceAPI } from "./shared/types.js";

const api: PiVoiceAPI = {
  onStartRecording: (callback) => {
    ipcRenderer.on(IPC.START_RECORDING, () => callback());
  },
  onStopRecording: (callback) => {
    ipcRenderer.on(IPC.STOP_RECORDING, () => callback());
  },
  onPlayAudio: (callback) => {
    ipcRenderer.on(IPC.PLAY_AUDIO, (_event, audioData: ArrayBuffer) => {
      callback(audioData);
    });
  },
  onStateChanged: (callback) => {
    ipcRenderer.on(IPC.STATE_CHANGED, (_event, state) => callback(state));
  },
  onStatusMessage: (callback) => {
    ipcRenderer.on(IPC.STATUS_MESSAGE, (_event, message) => callback(message));
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
