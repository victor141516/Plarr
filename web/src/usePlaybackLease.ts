import { onScopeDispose, watch, type Ref } from "vue";
import { useEventListener } from "./useEventListener";

export interface PlaybackLeaseOptions {
  sessionId: string;
  active: Readonly<Ref<boolean>>;
  heartbeatMilliseconds?: number;
}

export function usePlaybackLease(options: PlaybackLeaseOptions) {
  const session = encodeURIComponent(options.sessionId);
  const heartbeatURL = `/api/v1/playback/sessions/${session}/heartbeat`;
  const closeURL = `/api/v1/playback/sessions/${session}/close`;
  let heartbeat: number | undefined;
  let closed = false;
  let blocked = false;

  function touch(): void {
    if (closed || blocked || !options.active.value) return;
    void fetch(heartbeatURL, {
      method: "POST",
      keepalive: true,
    }).catch(() => undefined);
  }

  function stop(): void {
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    heartbeat = undefined;
  }

  function start(): void {
    stop();
    if (closed || blocked || !options.active.value) return;
    touch();
    heartbeat = window.setInterval(
      touch,
      options.heartbeatMilliseconds ?? 5000,
    );
  }

  function close(): void {
    if (closed) return;
    closed = true;
    stop();
    if (navigator.sendBeacon?.(closeURL, "")) return;
    void fetch(closeURL, { method: "POST", keepalive: true }).catch(
      () => undefined,
    );
  }

  function cancelActiveJobs(): void {
    blocked = true;
    stop();
    void fetch(closeURL, { method: "POST", keepalive: true }).catch(
      () => undefined,
    );
  }

  function resumeActiveJobs(): void {
    if (closed) return;
    blocked = false;
    if (options.active.value) start();
  }

  watch(
    options.active,
    (active) => {
      if (active && !blocked) start();
      else stop();
    },
    { immediate: true },
  );
  useEventListener(window, "pagehide", close);
  onScopeDispose(close);

  return { touch, close, cancelActiveJobs, resumeActiveJobs };
}
