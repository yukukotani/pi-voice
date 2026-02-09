/**
 * Audio engine using node-web-audio-api.
 * Handles microphone recording (PCM → WAV), streaming PCM playback, and sound effects.
 * Runs entirely in the main process — no Electron / BrowserWindow needed.
 */

// node-web-audio-api exports `mediaDevices` at runtime but the .d.ts doesn't
// declare it, so we use a require-based import for the native module.
import { createRequire } from "node:module";
import { join } from "node:path";
const _require = createRequire(import.meta.url);
const nativeAudio = _require("node-web-audio-api");

const {
  AudioContext: NativeAudioContext,
  mediaDevices,
} = nativeAudio as {
  AudioContext: typeof AudioContext;
  mediaDevices: { getUserMedia(constraints: { audio: boolean }): Promise<MediaStream> };
};

// ── Constants ────────────────────────────────────────────────────────

/** Recording sample rate (matches the native AudioContext default). */
const RECORD_SAMPLE_RATE = 44100;
const RECORD_CHANNELS = 1;

// ── Shared AudioContext ──────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new NativeAudioContext() as unknown as AudioContext;
  }
  return audioCtx;
}

// ── Sound effects ────────────────────────────────────────────────────

// Resolve asset paths – works from both source and built output
function resolveAssetPath(filename: string): string {
  // Walk up from this file to find src/assets
  // From source: src/services/audio-engine.ts  → src/assets/
  // From built:  out/main/index.js             → ../../src/assets/
  const candidates = [
    join(import.meta.dirname, "..", "assets", filename),
    join(import.meta.dirname, "..", "..", "src", "assets", filename),
  ];
  return candidates[0]!; // Prefer first; Bun.file will error if not found
}

let sfxBufferCache: Map<string, AudioBuffer> = new Map();

async function loadSfxBuffer(filename: string): Promise<AudioBuffer> {
  const cached = sfxBufferCache.get(filename);
  if (cached) return cached;

  const path = resolveAssetPath(filename);
  const file = Bun.file(path);
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getAudioContext();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  sfxBufferCache.set(filename, decoded);
  return decoded;
}

export async function playSoundEffect(filename: string): Promise<void> {
  try {
    const ctx = getAudioContext();
    const buffer = await loadSfxBuffer(filename);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = 2.0;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch (err) {
    console.error("[AudioEngine] Failed to play sound effect:", err);
  }
}

// ── Recording ────────────────────────────────────────────────────────

let micStream: MediaStream | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let recordedChunks: Float32Array[] = [];
let isRecording = false;

/**
 * Start capturing microphone audio.
 * Captured PCM samples are accumulated internally.
 */
export async function startRecording(): Promise<void> {
  if (isRecording) return;

  const ctx = getAudioContext();
  micStream = await mediaDevices.getUserMedia({ audio: true });
  micSource = ctx.createMediaStreamSource(micStream);

  // ScriptProcessorNode to collect PCM samples (deprecated but well-supported
  // in node-web-audio-api and simpler than AudioWorklet for this use case)
  const bufferSize = 4096;
  scriptProcessor = ctx.createScriptProcessor(bufferSize, 1, 1);

  recordedChunks = [];
  isRecording = true;

  scriptProcessor.addEventListener("audioprocess", (e: Event) => {
    if (!isRecording) return;
    const event = e as AudioProcessingEvent;
    const input = event.inputBuffer.getChannelData(0);
    // Copy data – getChannelData returns a view that may be reused
    recordedChunks.push(new Float32Array(input));
  });

  micSource.connect(scriptProcessor);
  // Must connect to destination for audioprocess to fire
  scriptProcessor.connect(ctx.destination);
}

/**
 * Stop recording and return the captured audio as a WAV buffer.
 * Returns null if no meaningful audio was captured.
 */
export function stopRecording(): Buffer | null {
  isRecording = false;

  // Disconnect mic
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  if (recordedChunks.length === 0) return null;

  // Merge all chunks into a single Float32Array
  const totalSamples = recordedChunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of recordedChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  recordedChunks = [];

  // Encode as WAV (16-bit PCM)
  return encodeWav(merged, RECORD_SAMPLE_RATE, RECORD_CHANNELS);
}

// ── WAV encoding ─────────────────────────────────────────────────────

function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
): Buffer {
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const headerLength = 44;
  const buffer = Buffer.alloc(headerLength + dataLength);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);

  // fmt sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // sub-chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(channels * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  // Convert float32 [-1, 1] → int16
  let pos = headerLength;
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i]!;
    s = Math.max(-1, Math.min(1, s));
    const int16 = s < 0 ? s * 32768 : s * 32767;
    buffer.writeInt16LE(Math.round(int16), pos);
    pos += 2;
  }

  return buffer;
}

// ── Streaming PCM playback (TTS) ─────────────────────────────────────

let streamNextPlayTime = 0;
let streamActiveSources = 0;
let streamEnded = false;
let playbackDoneCallback: (() => void) | null = null;

/**
 * Begin a new streaming playback session.
 */
export function streamPlaybackStart(onDone: () => void): void {
  streamNextPlayTime = 0;
  streamActiveSources = 0;
  streamEnded = false;
  playbackDoneCallback = onDone;
  // Ensure AudioContext is alive
  getAudioContext();
}

/**
 * Feed a chunk of raw PCM data (16-bit signed LE, 24 kHz, mono) into the
 * playback queue.
 */
export function streamPlaybackChunk(
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): void {
  const ctx = getAudioContext();
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = pcmData.length / bytesPerSample / channels;

  if (sampleCount <= 0) return;

  const audioBuffer = ctx.createBuffer(channels, sampleCount, sampleRate);
  const view = new DataView(
    pcmData.buffer,
    pcmData.byteOffset,
    pcmData.byteLength,
  );

  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < sampleCount; i++) {
      const byteOffset = (i * channels + ch) * bytesPerSample;
      const int16 = view.getInt16(byteOffset, true);
      channelData[i] = int16 / 32768;
    }
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);

  const now = ctx.currentTime;
  if (streamNextPlayTime < now) {
    streamNextPlayTime = now;
  }

  source.start(streamNextPlayTime);
  streamNextPlayTime += audioBuffer.duration;

  streamActiveSources++;
  source.onended = () => {
    streamActiveSources--;
    if (streamEnded && streamActiveSources <= 0) {
      playbackDoneCallback?.();
      playbackDoneCallback = null;
    }
  };
}

/**
 * Signal that no more chunks will be sent. The onDone callback from
 * streamPlaybackStart will fire once all queued audio finishes playing.
 */
export function streamPlaybackEnd(): void {
  streamEnded = true;
  if (streamActiveSources <= 0) {
    playbackDoneCallback?.();
    playbackDoneCallback = null;
  }
}

/**
 * Close the shared AudioContext (call on shutdown).
 */
export function dispose(): void {
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  sfxBufferCache.clear();
}
