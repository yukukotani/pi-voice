import { describe, test, expect } from "bun:test";
import { IPC } from "../../shared/types.js";

describe("IPC constants", () => {
  test("contains all expected channel names", () => {
    expect(IPC.START_RECORDING).toBe("start-recording");
    expect(IPC.STOP_RECORDING).toBe("stop-recording");
    expect(IPC.PLAY_AUDIO_STREAM_START).toBe("play-audio-stream-start");
    expect(IPC.PLAY_AUDIO_STREAM_CHUNK).toBe("play-audio-stream-chunk");
    expect(IPC.PLAY_AUDIO_STREAM_END).toBe("play-audio-stream-end");
    expect(IPC.RECORDING_DATA).toBe("recording-data");
    expect(IPC.RECORDING_ERROR).toBe("recording-error");
    expect(IPC.PLAYBACK_DONE).toBe("playback-done");
  });

  test("all values are unique strings", () => {
    const values = Object.values(IPC);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe("string");
    }
  });
});
