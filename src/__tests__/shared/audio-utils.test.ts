import { describe, test, expect } from "bun:test";
import { downsample } from "../../shared/audio-utils.js";

describe("downsample", () => {
  test("returns same buffer when sample rates match", () => {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const result = downsample(input, 48000, 48000);
    expect(result).toBe(input); // same reference
  });

  test("downsamples 48kHz to 16kHz (3:1 ratio)", () => {
    // 6 samples at 48kHz -> 2 samples at 16kHz
    const input = new Float32Array([0.0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    const result = downsample(input, 48000, 16000);
    expect(result.length).toBe(2);
    // Values are linearly interpolated
    expect(result[0]).toBeCloseTo(0.0, 5);
    expect(result[1]).toBeCloseTo(0.3, 5);
  });

  test("upsamples 16kHz to 48kHz (1:3 ratio)", () => {
    const input = new Float32Array([0.0, 1.0]);
    const result = downsample(input, 16000, 48000);
    expect(result.length).toBe(6);
    // Should interpolate between 0.0 and 1.0
    expect(result[0]).toBeCloseTo(0.0, 5);
    expect(result[result.length - 1]!).toBeCloseTo(1.0, 1);
  });

  test("handles empty buffer", () => {
    const input = new Float32Array([]);
    const result = downsample(input, 48000, 16000);
    expect(result.length).toBe(0);
  });

  test("handles single sample", () => {
    const input = new Float32Array([0.5]);
    const result = downsample(input, 48000, 16000);
    // 1 sample at 48kHz -> 0 or 1 sample at 16kHz depending on rounding
    expect(result.length).toBeLessThanOrEqual(1);
  });

  test("preserves signal characteristics roughly", () => {
    // Create a simple ramp of 300 samples at 48kHz
    const input = new Float32Array(300);
    for (let i = 0; i < 300; i++) {
      input[i] = i / 300;
    }
    const result = downsample(input, 48000, 16000);
    // Output should be 100 samples
    expect(result.length).toBe(100);
    // First sample should be ~0, last should be close to 1
    expect(result[0]).toBeCloseTo(0, 2);
    expect(result[99]!).toBeCloseTo(0.99, 1);
  });
});
