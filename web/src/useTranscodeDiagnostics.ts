import { onScopeDispose, shallowRef, watch, type Ref } from "vue";
import type {
  PlaybackTranscodeAttempt,
  PlaybackTranscodeDiagnostics,
  TranscodeAttemptStatus,
} from "./playerTypes";
import { isPlaybackAuthorizationFailure, playbackURL } from "./playbackURL";

type DiagnosticFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface TranscodeDiagnosticsOptions {
  sessionId: string;
  active: Readonly<Ref<boolean>>;
  pollMilliseconds?: number;
  fetcher?: DiagnosticFetcher;
  playbackToken?: string;
  onAuthorizationExpired?: () => void;
}

const statuses = new Set<TranscodeAttemptStatus>([
  "running",
  "active",
  "failed",
  "succeeded",
  "skipped",
  "canceled",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseAttempt(value: unknown): PlaybackTranscodeAttempt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const name = text(item.name);
  const status = text(item.status) as TranscodeAttemptStatus;
  if (!name || !statuses.has(status)) return undefined;
  return { name, status, error: text(item.error) || undefined };
}

function parseDiagnostics(value: unknown): PlaybackTranscodeDiagnostics {
  const item =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const color = item.color === "hdr" || item.color === "sdr" ? item.color : undefined;
  const height = Number(item.height);
  return {
    rendition: text(item.rendition) || undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
    color,
    sourceHDR: item.sourceHDR === true,
    attempts: Array.isArray(item.attempts)
      ? item.attempts
          .map(parseAttempt)
          .filter((attempt): attempt is PlaybackTranscodeAttempt => !!attempt)
      : [],
    selected: text(item.selected) || undefined,
  };
}

export function useTranscodeDiagnostics(options: TranscodeDiagnosticsOptions) {
  const diagnostics = shallowRef<PlaybackTranscodeDiagnostics | null>(null);
  const error = shallowRef("");
  const endpoint = playbackURL(
    `/api/v1/playback/sessions/${encodeURIComponent(options.sessionId)}/diagnostics`,
    options.playbackToken,
  );
  let timer: number | undefined;
  let controller: AbortController | undefined;

  function stop(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }

  async function refresh(): Promise<void> {
    if (!options.active.value || controller) return;
    const request = new AbortController();
    controller = request;
    try {
      const fetcher = options.fetcher ?? fetch;
      const response = await fetcher(endpoint, { signal: request.signal });
      if (!response.ok) {
        if (isPlaybackAuthorizationFailure(response.status)) {
          options.onAuthorizationExpired?.();
        }
        throw new Error(`HTTP ${response.status}`);
      }
      diagnostics.value = parseDiagnostics(await response.json());
      error.value = "";
    } catch (reason) {
      if (!request.signal.aborted) {
        error.value = reason instanceof Error ? reason.message : "Request failed";
      }
    } finally {
      if (controller === request) controller = undefined;
    }
  }

  function start(): void {
    stop();
    void refresh();
    timer = window.setInterval(
      () => void refresh(),
      options.pollMilliseconds ?? 1000,
    );
  }

  watch(options.active, (active) => (active ? start() : stop()), {
    immediate: true,
  });
  onScopeDispose(stop);

  return { diagnostics, error, refresh };
}
