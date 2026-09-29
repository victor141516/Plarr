import { describe, expect, it } from "vitest";
import { clockOffsetFromPong, roomCorrection, roomPositionAt, watchPartyToggleAction } from "./watchPartyClock";
import type { PartyState } from "./useWatchParty";

const state: PartyState = {
  type: "state",
  position: 20,
  playing: true,
  intent: true,
  rate: 1.5,
  participants: 2,
  buffering: 0,
  revision: 1,
  serverTime: 10_000,
};

describe("watch party clock", () => {
  it("compensates for transport delay without relying on matching device clocks", () => {
    const sample = clockOffsetFromPong(1_000, 1_200, 10_100);
    expect(sample).toEqual({ offset: 9_000, roundTrip: 200 });
    expect(roomPositionAt(state, 1_400, sample.offset)).toBeCloseTo(20.6);
    expect(roomPositionAt({ ...state, playing: false }, 1_400, sample.offset)).toBe(20);
  });

  it("holds a moderately advanced viewer and seeks a lagging or paused viewer", () => {
    expect(roomCorrection(20.4, 20, true)).toEqual({ type: "hold", milliseconds: 400 });
    expect(roomCorrection(19.6, 20, true)).toEqual({ type: "seek", position: 20 });
    expect(roomCorrection(21, 20, true)).toEqual({ type: "seek", position: 20 });
    expect(roomCorrection(20.1, 20, true)).toEqual({ type: "none" });
    expect(roomCorrection(20.3, 20, false)).toEqual({ type: "seek", position: 20 });
  });

  it("treats Play during startup buffering as a browser gesture, not a room pause", () => {
    expect(watchPartyToggleAction(true, true, false)).toBe("unlock");
    expect(watchPartyToggleAction(true, true, true)).toBe("unlock");
    expect(watchPartyToggleAction(true, false, false)).toBe("play");
    expect(watchPartyToggleAction(false, true, true)).toBe("pause");
  });
});
