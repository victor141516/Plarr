import { onBeforeUnmount, shallowRef } from "vue";

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
};
type PartyEvent = { type: string; position?: number; rate?: number };

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
      ws.onmessage = (message) => {
        let state: PartyState;
        try { state = JSON.parse(message.data) as PartyState; } catch { return; }
        if (state.type !== "state") return;
        connected.value = true;
        everConnected = true;
        participants.value = state.participants;
        buffering.value = state.buffering;
        error.value = "";
        const first = firstState;
        firstState = false;
        onState(state, first);
        if (!received) {
          received = true;
          window.clearTimeout(timeout);
          resolve(state);
        }
      };
      ws.onclose = () => {
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
    socket?.close();
  });
  return { connect: open, command, connected, participants, buffering, error };
}
