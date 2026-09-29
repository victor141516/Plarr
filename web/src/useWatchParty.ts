import { onBeforeUnmount, shallowRef } from "vue";
import { clockOffsetFromPong, roomPositionAt } from "./watchPartyClock";

export type PartyState = {
  type: "state";
  position: number;
  playing: boolean;
  intent: boolean;
  rate: number;
  participants: number;
  buffering: number;
  revision: number;
  serverTime: number;
  observedSkew?: number;
  action?: string;
};
type PartyEvent = { type: string; position?: number; rate?: number; clientTime?: number };

export function useWatchParty(
  roomId: string,
  playbackToken: string,
  onState: (state: PartyState, first: boolean) => void,
) {
  const connected = shallowRef(false);
  const participants = shallowRef(0);
  const buffering = shallowRef(0);
  const error = shallowRef("");
  let socket: WebSocket | undefined;
  let closed = false;
  let reconnectTimer: number | undefined;
  let firstState = true;
  let everConnected = false;
  let clockOffset: number | undefined;
  let bestRoundTrip = Infinity;
  let calibratedAt = 0;
  let pingTimer: number | undefined;

  function command(event: PartyEvent) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }
  function open(): Promise<PartyState> {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = new URL(`/api/v1/watch-parties/${encodeURIComponent(roomId)}/connect`, location.origin);
      url.protocol = protocol;
      if (playbackToken) url.searchParams.set("playback_token", playbackToken);
      const ws = new WebSocket(url);
      socket = ws;
      const timeout = window.setTimeout(() => {
        ws.close();
        reject(new Error("Watch party connection timed out."));
      }, 10_000);
      let received = false;
      ws.onopen = () => {
        const ping = () => command({ type: "ping", clientTime: performance.now() });
        ping();
        pingTimer = window.setInterval(ping, 5_000);
      };
      ws.onmessage = (message) => {
        let packet: PartyState | { type: "pong"; clientTime: number; serverTime: number };
        try { packet = JSON.parse(message.data) as typeof packet; } catch { return; }
        if (packet.type === "pong" && Number.isFinite(packet.clientTime)) {
          const now = performance.now();
          const sample = clockOffsetFromPong(packet.clientTime, now, packet.serverTime);
          if (now - calibratedAt > 30_000 || sample.roundTrip <= bestRoundTrip * 1.5) {
            clockOffset = sample.offset;
            bestRoundTrip = now - calibratedAt > 30_000
              ? sample.roundTrip
              : Math.min(bestRoundTrip, sample.roundTrip);
            calibratedAt = now;
          }
          return;
        }
        if (packet.type !== "state") return;
        const state = packet;
        connected.value = true;
        everConnected = true;
        participants.value = state.participants;
        buffering.value = state.buffering;
        error.value = "";
        const first = firstState;
        firstState = false;
        onState({ ...state, position: roomPositionAt(state, performance.now(), clockOffset) }, first);
        if (!received) {
          received = true;
          window.clearTimeout(timeout);
          resolve(state);
        }
      };
      ws.onclose = () => {
        if (pingTimer !== undefined) window.clearInterval(pingTimer);
        pingTimer = undefined;
        connected.value = false;
        if (!received) { window.clearTimeout(timeout); reject(new Error("Watch party is unavailable.")); }
        if (!closed && everConnected) {
          error.value = "Reconnecting to watch party…";
          reconnectTimer = window.setTimeout(() => { void open().catch(() => undefined); }, 1500);
        }
      };
      ws.onerror = () => { if (!received) { window.clearTimeout(timeout); reject(new Error("Watch party connection failed.")); } };
    });
  }
  onBeforeUnmount(() => {
    closed = true;
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    if (pingTimer !== undefined) clearInterval(pingTimer);
    socket?.close();
  });
  return { connect: open, command, connected, participants, buffering, error };
}
