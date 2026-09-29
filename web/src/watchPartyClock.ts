import type { PartyState } from "./useWatchParty";

export function clockOffsetFromPong(
  sentAt: number,
  receivedAt: number,
  serverTime: number,
): { offset: number; roundTrip: number } {
  const roundTrip = Math.max(0, receivedAt - sentAt);
  return { offset: serverTime - (sentAt + receivedAt) / 2, roundTrip };
}

export function roomPositionAt(
  state: PartyState,
  localNow: number,
  serverClockOffset?: number,
): number {
  if (!state.playing || serverClockOffset === undefined) return state.position;
  const elapsed = Math.max(0, Math.min(5_000, localNow + serverClockOffset - state.serverTime));
  return state.position + (elapsed / 1_000) * state.rate;
}

export type RoomCorrection =
  | { type: "none" }
  | { type: "hold"; milliseconds: number }
  | { type: "seek"; position: number };

export function watchPartyToggleAction(
  paused: boolean,
  intent: boolean,
  playing: boolean,
): "unlock" | "play" | "pause" {
  if (paused && intent) return "unlock";
  return intent && playing ? "pause" : "play";
}

export function roomCorrection(
  actual: number,
  target: number,
  playing: boolean,
): RoomCorrection {
  const drift = actual - target;
  if (!playing) {
    return Math.abs(drift) >= 0.08 ? { type: "seek", position: target } : { type: "none" };
  }
  if (Math.abs(drift) < 0.25) return { type: "none" };
  if (drift > 0 && drift < 0.85) {
    return { type: "hold", milliseconds: Math.round(drift * 1_000) };
  }
  return { type: "seek", position: target };
}
