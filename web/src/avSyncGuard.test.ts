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
