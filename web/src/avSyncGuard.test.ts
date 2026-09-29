import { describe, expect, it } from "vitest";
import { AVSyncGuard, AVSyncRecoveryLimiter } from "./avSyncGuard";

describe("AVSyncGuard", () => {
  it("ignores the normal loading lead between adaptive lanes", () => {
    const guard = new AVSyncGuard();
    expect(guard.observe({ lane: "audio", sequence: 622, start: 1244 })).toBeUndefined();
    expect(guard.observe({ lane: "audio", sequence: 623, start: 1246 })).toBeUndefined();
    expect(guard.observe({ lane: "main", sequence: 622, start: 1244.02 })).toBeUndefined();
    expect(guard.observe({ lane: "main", sequence: 623, start: 1246.01 })).toBeUndefined();
  });

  it("ignores a transient loading lead between unmatched lanes", () => {
    const guard = new AVSyncGuard();
    guard.observe({ lane: "audio", sequence: 622, start: 1244 });
    expect(guard.observe({ lane: "main", sequence: 696, start: 1392 })).toBeUndefined();
    expect(guard.observe({ lane: "main", sequence: 697, start: 1394 })).toBeUndefined();
    expect(guard.observe({ lane: "main", sequence: 698, start: 1396 })).toBeUndefined();
  });

  it("accepts a stable PTS offset between matching lanes", () => {
    const guard = new AVSyncGuard();
    for (let sequence = 10; sequence < 16; sequence++) {
      guard.observe({ lane: "audio", sequence, start: sequence * 2 });
      expect(
        guard.observe({
          lane: "main",
          sequence,
          start: sequence * 2 + 0.4,
        }),
      ).toBeUndefined();
    }
  });

  it("does not treat unequal audio and video segment lengths as A/V drift", () => {
    const guard = new AVSyncGuard();
    const videoStarts = [679.553, 681.555, 684.349, 686.351, 688.353];
    const audioStarts = [679.533, 681.544, 683.549, 685.533, 687.538];
    const videoDurations = [2.002, 2.794, 2.002, 2.002, 2.002];
    const audioDurations = [2.011, 2.005, 1.984, 2.005, 2.005];
    for (let index = 0; index < videoStarts.length; index++) {
      const sequence = 340 + index;
      guard.observe({
        lane: "audio",
        sequence,
        start: audioStarts[index]!,
        duration: audioDurations[index]!,
      });
      expect(guard.observe({
        lane: "main",
        sequence,
        start: videoStarts[index]!,
        duration: videoDurations[index]!,
      })).toBeUndefined();
    }
  });

  it("still detects sustained PTS drift after unequal segment lengths", () => {
    const guard = new AVSyncGuard();
    const samples = [
      { sequence: 10, video: 20, audio: 20, videoDuration: 2.8, audioDuration: 2 },
      { sequence: 11, video: 22.8, audio: 22, videoDuration: 2, audioDuration: 2 },
      { sequence: 12, video: 26.2, audio: 24, videoDuration: 2, audioDuration: 2 },
      { sequence: 13, video: 28.2, audio: 26, videoDuration: 2, audioDuration: 2 },
      { sequence: 14, video: 30.2, audio: 28, videoDuration: 2, audioDuration: 2 },
    ];
    const results = samples.map((s) => {
      guard.observe({ lane: "audio", sequence: s.sequence, start: s.audio, duration: s.audioDuration });
      return guard.observe({ lane: "main", sequence: s.sequence, start: s.video, duration: s.videoDuration });
    });
    expect(results.slice(0, 4)).toEqual([undefined, undefined, undefined, undefined]);
    expect(results[4]?.sequenceDelta).toBe(0);
    expect(results[4]?.ptsDelta).toBeCloseTo(1.4);
  });

  it("detects a persistent change from the established PTS offset once", () => {
    const guard = new AVSyncGuard();
    guard.observe({ lane: "audio", sequence: 10, start: 20 });
    guard.observe({ lane: "main", sequence: 10, start: 20.4 });

    for (const sequence of [11, 12]) {
      guard.observe({ lane: "audio", sequence, start: sequence * 2 });
      expect(
        guard.observe({ lane: "main", sequence, start: sequence * 2 + 1.4 }),
      ).toBeUndefined();
    }
    guard.observe({ lane: "audio", sequence: 13, start: 26 });
    expect(
      guard.observe({ lane: "main", sequence: 13, start: 27.4 }),
    ).toEqual({ sequenceDelta: 0, ptsDelta: 1 });
    expect(
      guard.observe({ lane: "main", sequence: 14, start: 29.4 }),
    ).toBeUndefined();
  });

  it("does not count a repeated fragment more than once", () => {
    const guard = new AVSyncGuard();
    guard.observe({ lane: "audio", sequence: 10, start: 20 });
    guard.observe({ lane: "main", sequence: 10, start: 20.4 });
    guard.observe({ lane: "audio", sequence: 11, start: 22 });
    expect(guard.observe({ lane: "main", sequence: 11, start: 23.4 })).toBeUndefined();
    expect(guard.observe({ lane: "main", sequence: 11, start: 23.4 })).toBeUndefined();
    expect(guard.observe({ lane: "main", sequence: 11, start: 23.4 })).toBeUndefined();
  });
});

describe("AVSyncRecoveryLimiter", () => {
  it("prevents consecutive playback generations from forming a reload loop", () => {
    const limiter = new AVSyncRecoveryLimiter(30_000);
    expect(limiter.request(1_000)).toBe(true);
    expect(limiter.request(2_000)).toBe(false);
    expect(limiter.request(30_999)).toBe(false);
    expect(limiter.request(31_000)).toBe(true);
  });
});
