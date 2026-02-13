/**
 * Pure audio utility functions (no DOM / Web Audio dependency).
 * Extracted from renderer.ts so they can be unit-tested.
 */

/**
 * Downsample Float32 PCM from sourceSampleRate to targetSampleRate using
 * simple linear interpolation. Good enough for speech.
 */
export function downsample(
  buffer: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate === targetSampleRate) return buffer;
  const ratio = sourceSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, buffer.length - 1);
    const frac = srcIndex - lo;
    result[i] = buffer[lo]! * (1 - frac) + buffer[hi]! * frac;
  }
  return result;
}
