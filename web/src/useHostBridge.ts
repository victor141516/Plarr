import { onScopeDispose, type Ref } from "vue";
import { envelope, eventId, type PlarrEventType } from "./protocol";
import { useEventListener } from "./useEventListener";

export interface HostBridgeOptions {
  video: Readonly<Ref<HTMLVideoElement | null>>;
  current: Readonly<Ref<number>>;
  duration: Readonly<Ref<number>>;
  trusted: Readonly<Ref<boolean>>;
  parentOrigin: string;
  mediaPath: string;
  heartbeatMilliseconds?: number;
}

export function useHostBridge(options: HostBridgeOptions) {
  const sessionId = eventId();
  let heartbeat: number | undefined;

  function send(
    type: PlarrEventType,
    extra: Record<string, unknown> = {},
  ): void {
    if (!options.trusted.value) return;
    window.parent.postMessage(
      envelope(type, sessionId, options.mediaPath, options.video.value, {
        positionSeconds: options.current.value,
        durationSeconds: options.duration.value,
        ...extra,
      }),
      options.parentOrigin,
    );
  }

  function stopHeartbeat(): void {
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    heartbeat = undefined;
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeat = window.setInterval(() => {
      const video = options.video.value;
      if (video && !video.paused && !video.ended) send("heartbeat");
    }, options.heartbeatMilliseconds ?? 5000);
  }

  function close(): void {
    send("closed");
    window.close();
  }

  useEventListener(document, "visibilitychange", () => {
    if (document.hidden) send("page-hidden");
  });
  // A document unload is not necessarily an explicit player close: it also
  // happens during reloads. Preserve the route so the host can restore the
  // player from `play=1`, while still reporting the latest playback position.
  useEventListener(window, "beforeunload", () => send("page-hidden"));
  onScopeDispose(stopHeartbeat);

  return { sessionId, send, startHeartbeat, stopHeartbeat, close };
}
