/**
 * Audio worker running in a hidden BrowserWindow.
 * Handles microphone recording (MediaRecorder) and PCM streaming playback (Web Audio API).
 * No UI rendering – all visual elements have been removed.
 */

/// <reference path="../shared/types.ts" />

import toggleOnUrl from "../assets/toggle_on.wav?url";
import toggleOffUrl from "../assets/toggle_off.wav?url";

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioContext: AudioContext | null = null;

function playSoundEffect(url: string) {
  const ctx = audioContext ?? new AudioContext();
  if (!audioContext) audioContext = ctx;

  fetch(url)
    .then((res) => res.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      const gain = ctx.createGain();
      gain.gain.value = 2.0;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    })
    .catch((err) => {
      console.error("Failed to play sound effect:", err);
    });
}

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
