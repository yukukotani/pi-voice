/// <reference path="../shared/types.ts" />

import toggleOnUrl from "../assets/toggle_on.wav?url";
import toggleOffUrl from "../assets/toggle_off.wav?url";

const indicator = document.getElementById("indicator")!;
const icon = document.getElementById("icon")!;
const stateLabel = document.getElementById("stateLabel")!;
const statusMessage = document.getElementById("statusMessage")!;

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioContext: AudioContext | null = null;

function playSoundEffect(url: string) {
  const audio = new Audio(url);
  audio.play().catch((err) => {
    console.error("Failed to play sound effect:", err);
  });
}

const stateConfig: Record<
  string,
  { icon: string; label: string; defaultMessage: string }
> = {
  idle: { icon: "\u23F8", label: "IDLE", defaultMessage: "Hold Fn to speak" },
  recording: {
    icon: "\u{1F534}",
    label: "RECORDING",
    defaultMessage: "Listening...",
  },
  transcribing: {
    icon: "\u{1F504}",
    label: "TRANSCRIBING",
    defaultMessage: "Converting speech to text...",
  },
  thinking: {
    icon: "\u{1F9E0}",
    label: "THINKING",
    defaultMessage: "pi is thinking...",
  },
  speaking: {
    icon: "\u{1F50A}",
    label: "SPEAKING",
    defaultMessage: "Playing response...",
  },
  error: { icon: "\u26A0", label: "ERROR", defaultMessage: "An error occurred" },
};

// State updates from main
window.piVoice.onStateChanged((state) => {
  // Remove all state classes
  document.body.className = "";
  document.body.classList.add(`state-${state}`);

  const config = stateConfig[state];
  if (config) {
    icon.textContent = config.icon;
    stateLabel.textContent = config.label;
    statusMessage.textContent = config.defaultMessage;
  }
});

window.piVoice.onStatusMessage((message) => {
  statusMessage.textContent = message;
});

// Recording control from main
window.piVoice.onStartRecording(async () => {
  playSoundEffect(toggleOnUrl);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());

      if (audioChunks.length === 0) {
        window.piVoice.sendRecordingError("No audio data captured");
        return;
      }

      const blob = new Blob(audioChunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      window.piVoice.sendRecordingData(arrayBuffer);
    };

    mediaRecorder.start(100); // Collect data every 100ms
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.piVoice.sendRecordingError(`Microphone access failed: ${msg}`);
  }
});

window.piVoice.onStopRecording(() => {
  playSoundEffect(toggleOffUrl);
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
});

// ── Streaming PCM playback ──────────────────────────────────────────
let streamSampleRate = 24000;
let streamChannels = 1;
let streamBitsPerSample = 16;
let streamNextPlayTime = 0;
let streamActiveSources = 0;
let streamEnded = false;

function stopStreamPlayback() {
  // Cancel all scheduled sources is not easily possible with Web Audio,
  // but resetting the context effectively stops everything.
  streamActiveSources = 0;
  streamEnded = false;
  streamNextPlayTime = 0;
}

window.piVoice.onPlayAudioStreamStart((meta) => {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    // Reset streaming state
    stopStreamPlayback();
    streamSampleRate = meta.sampleRate;
    streamChannels = meta.channels;
    streamBitsPerSample = meta.bitsPerSample;
    streamNextPlayTime = 0;
    streamEnded = false;
  } catch (err) {
    console.error("Stream start error:", err);
  }
});

window.piVoice.onPlayAudioStreamChunk((pcmData) => {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    const raw = pcmData instanceof ArrayBuffer ? pcmData : new Uint8Array(pcmData as any).buffer;
    const bytesPerSample = streamBitsPerSample / 8;
    const sampleCount = raw.byteLength / bytesPerSample / streamChannels;

    if (sampleCount <= 0) return;

    // Create an AudioBuffer from raw PCM (16-bit signed LE)
    const audioBuffer = audioContext.createBuffer(
      streamChannels,
      sampleCount,
      streamSampleRate
    );

    const view = new DataView(raw);
    for (let ch = 0; ch < streamChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < sampleCount; i++) {
        const byteOffset = (i * streamChannels + ch) * bytesPerSample;
        const int16 = view.getInt16(byteOffset, true); // little-endian
        channelData[i] = int16 / 32768;
      }
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    // Schedule playback at the end of the current queue
    const now = audioContext.currentTime;
    if (streamNextPlayTime < now) {
      streamNextPlayTime = now;
    }

    source.start(streamNextPlayTime);
    streamNextPlayTime += audioBuffer.duration;

    streamActiveSources++;
    source.onended = () => {
      streamActiveSources--;
      if (streamEnded && streamActiveSources <= 0) {
        window.piVoice.sendPlaybackDone();
      }
    };
  } catch (err) {
    console.error("Stream chunk playback error:", err);
  }
});

window.piVoice.onPlayAudioStreamEnd(() => {
  streamEnded = true;
  // If all sources already finished (or no chunks received), signal done now
  if (streamActiveSources <= 0) {
    window.piVoice.sendPlaybackDone();
  }
});
