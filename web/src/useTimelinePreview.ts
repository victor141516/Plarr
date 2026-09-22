import { onScopeDispose, shallowRef } from "vue";
import { isPlaybackAuthorizationFailure, playbackURL } from "./playbackURL";

type PreviewFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface RunningPreview {
  controller: AbortController;
  planRevision: number;
}

export interface TimelinePreviewOptions {
  base: string;
  fetcher?: PreviewFetcher;
  cacheSize?: number;
  refinementDepth?: number;
  preloadConcurrency?: number;
  playbackToken?: string;
  onAuthorizationExpired?: () => void;
}

function buildTernaryLevels(duration: number, depth: number): number[][] {
  return Array.from({ length: depth + 1 }, (_, level) => {
    const count = 3 ** level;
    return Array.from({ length: count }, (_, index) =>
      Math.max(
        0,
        Math.round((((index + 0.5) * duration) / count) * 1000) / 1000,
      ),
    );
  });
}

function buildProgressiveStages(levels: number[][]): number[][] {
  const root = levels[0]?.[0];
  if (root === undefined) return [];

  const stages: number[][] = [[root]];
  const scheduled = new Set<number>([root]);
  for (let levelIndex = 1; levelIndex < levels.length; levelIndex += 1) {
    const level = levels[levelIndex]!;
    const parentCount = levels[levelIndex - 1]!.length;
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex += 1) {
      const children = level
        .slice(parentIndex * 3, parentIndex * 3 + 3)
        .filter((bucket) => {
          if (scheduled.has(bucket)) return false;
          scheduled.add(bucket);
          return true;
        });
      if (children.length) stages.push(children);
    }
  }
  return stages;
}

export function useTimelinePreview(options: TimelinePreviewOptions) {
  const imageURL = shallowRef("");
  const cache = new Map<number, string>();
  const running = new Map<number, RunningPreview>();
  let hoverActive = false;
  let hoverTime = 0;
  let preloadStages: number[][] = [];
  let preloadStage = 0;
  let preloadQueue: number[] = [];
  let preloadPending = new Set<number>();
  let refinementLevels: number[][] = [];
  let mediaDuration = 0;
  let plannedDuration = 0;
  let planRevision = 0;
  let preloading = false;
  let batchSession = "";
  let plannedSession = "";
  let batchStarted = false;
  let batchController: AbortController | undefined;
  let suspended = false;
  let disposed = false;
  let warned = false;

  const concurrency = Math.max(1, options.preloadConcurrency ?? 2);
  const refinementDepth = Math.max(0, options.refinementDepth ?? 5);

  function levelBucket(level: number[], time: number): number {
    const ratio = Math.max(0, Math.min(1, time / mediaDuration));
    const index = Math.min(level.length - 1, Math.floor(ratio * level.length));
    return level[index]!;
  }

  function bestCachedBucket(time: number): number {
    for (let level = refinementLevels.length - 1; level >= 0; level -= 1) {
      const bucket = levelBucket(refinementLevels[level]!, time);
      if (cache.has(bucket)) return bucket;
    }
    return -1;
  }

  function updateHoverImage(): void {
    if (!hoverActive) return;
    const cachedBucket = bestCachedBucket(hoverTime);
    imageURL.value = cachedBucket >= 0 ? (cache.get(cachedBucket) ?? "") : "";
  }

  function remember(bucket: number, url: string): void {
    const previous = cache.get(bucket);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    cache.delete(bucket);
    cache.set(bucket, url);

    const defaultLimit = 3 ** refinementDepth + 24;
    const limit = options.cacheSize ?? defaultLimit;
    while (cache.size > limit) {
      const oldest = cache.entries().next().value as
        | [number, string]
        | undefined;
      if (!oldest) break;
      cache.delete(oldest[0]);
      URL.revokeObjectURL(oldest[1]);
    }
  }

  function prepareNextStage(): void {
    while (preloadStage < preloadStages.length) {
      const candidates = preloadStages[preloadStage]!.filter(
        (bucket) => !cache.has(bucket) && !running.has(bucket),
      );
      if (candidates.length) {
        preloadQueue = candidates;
        preloadPending = new Set(candidates);
        return;
      }
      preloadStage += 1;
    }
    preloadQueue = [];
    preloadPending.clear();
  }

  function takePreloadBucket(): number {
    while (preloadQueue.length) {
      const bucket = preloadQueue.shift()!;
      if (!cache.has(bucket) && !running.has(bucket)) return bucket;
      preloadPending.delete(bucket);
    }
    return -1;
  }

  function completePreloadBucket(bucket: number): void {
    preloadPending.delete(bucket);
    if (preloadPending.size || preloadQueue.length) return;
    preloadStage += 1;
    prepareNextStage();
  }

  function fillWorkers(): void {
    if (disposed) return;
    const canRunStage = preloadStage === 0 || preloading;
    while (canRunStage && running.size < concurrency) {
      const bucket = takePreloadBucket();
      if (bucket < 0) break;
      void load(bucket);
    }
  }

  async function load(bucket: number): Promise<void> {
    if (disposed || cache.has(bucket) || running.has(bucket)) return;
    const requestController = new AbortController();
    let succeeded = false;
    const requestPlanRevision = planRevision;
    running.set(bucket, {
      controller: requestController,
      planRevision: requestPlanRevision,
    });
    try {
      const query = new URLSearchParams({ time: String(bucket) });
      const response = await (options.fetcher ?? fetch)(
        playbackURL(
          `${options.base}/preview.jpg?${query}`,
          options.playbackToken,
        ),
        { signal: requestController.signal },
      );
      if (!response.ok) {
        if (isPlaybackAuthorizationFailure(response.status)) {
          options.onAuthorizationExpired?.();
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const nextURL = URL.createObjectURL(await response.blob());
      if (requestController.signal.aborted || disposed) {
        URL.revokeObjectURL(nextURL);
        return;
      }
      remember(bucket, nextURL);
      succeeded = true;
      updateHoverImage();
    } catch (error) {
      if (
        !(error instanceof DOMException && error.name === "AbortError") &&
        !warned
      ) {
        warned = true;
        console.warn("Timeline preview unavailable", error);
      }
    } finally {
      const active = running.get(bucket);
      const belongsToCurrentPlan =
        active?.controller === requestController &&
        requestPlanRevision === planRevision;
      if (active?.controller === requestController) running.delete(bucket);
      if (belongsToCurrentPlan) {
        if (
          requestController.signal.aborted &&
          !disposed &&
          preloading &&
          !succeeded
        ) {
          preloadQueue.unshift(bucket);
        } else if (preloading) {
          completePreloadBucket(bucket);
        }
      }
      fillWorkers();
    }
  }

  function request(time: number): void {
    hoverActive = true;
    hoverTime = Math.max(0, time);
    updateHoverImage();
    // Hover is deliberately read-only: it only selects the most precise image
    // already present in the progressive cache. It never starts network or
    // FFmpeg work, even before the preview plan has been initialized.
  }

  function clear(): void {
    hoverActive = false;
    imageURL.value = "";
  }

  function ensurePlan(duration: number): boolean {
    if (!Number.isFinite(duration) || duration <= 0) return false;
    if (
      plannedDuration === duration &&
      refinementLevels.length &&
      preloadStages.length
    ) {
      return true;
    }

    stopBatch();
    preloading = false;
    planRevision += 1;
    for (const active of running.values()) {
      active.controller.abort();
    }
    mediaDuration = duration;
    plannedDuration = duration;
    refinementLevels = buildTernaryLevels(duration, refinementDepth);
    preloadStages = buildProgressiveStages(refinementLevels);
    preloadStage = 0;
    prepareNextStage();
    return true;
  }

  async function startBatch(duration: number, session: string): Promise<void> {
    if (batchStarted || disposed || !session) return;
    batchStarted = true;
    batchSession = session;
    const revision = planRevision;
    batchController = new AbortController();
    try {
      const response = await (options.fetcher ?? fetch)(
        playbackURL(`${options.base}/previews/start`, options.playbackToken),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            durationSeconds: duration,
            refinementDepth,
            session,
          }),
          signal: batchController.signal,
        },
      );
      if (!response.ok) {
        if (isPlaybackAuthorizationFailure(response.status)) {
          options.onAuthorizationExpired?.();
        }
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn(
          "Timeline preview batch unavailable; using planned frame requests",
          error,
        );
      }
    } finally {
      if (!disposed && revision === planRevision) {
        preloading = true;
        fillWorkers();
      }
    }
  }

  function stopBatch(): void {
    batchController?.abort();
    batchController = undefined;
    if (batchStarted && batchSession) {
      void (options.fetcher ?? fetch)(playbackURL(`${options.base}/previews/stop`, options.playbackToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: batchSession }),
        keepalive: true,
      }).catch(() => undefined);
    }
    batchStarted = false;
    batchSession = "";
  }

  function initialize(duration: number, session = ""): void {
    if (!ensurePlan(duration)) return;
    plannedSession = session;
    if (suspended) return;
    if (session) {
      void startBatch(duration, session);
      return;
    }
    fillWorkers();
  }

  function preload(duration: number): void {
    if (!ensurePlan(duration)) return;
    suspended = false;
    preloading = true;
    fillWorkers();
  }

  function pausePreload(): void {
    if (suspended) return;
    suspended = true;
    preloading = false;
    planRevision += 1;
    preloadQueue = [];
    preloadPending.clear();
    for (const active of running.values()) active.controller.abort();
    stopBatch();
  }

  function resumePreload(): void {
    if (disposed || !suspended || plannedDuration <= 0) return;
    suspended = false;
    preloading = true;
    preloadStage = 0;
    prepareNextStage();
    if (plannedSession) {
      void startBatch(plannedDuration, plannedSession);
      return;
    }
    fillWorkers();
  }

  function stopPreload(): void {
    suspended = true;
    preloading = false;
    planRevision += 1;
    preloadStages = [];
    preloadQueue = [];
    preloadPending.clear();
    plannedSession = "";
    for (const active of running.values()) {
      active.controller.abort();
    }
    stopBatch();
  }

  onScopeDispose(() => {
    disposed = true;
    for (const active of running.values()) active.controller.abort();
    running.clear();
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
    preloadStages = [];
    preloadQueue = [];
    preloadPending.clear();
    stopBatch();
  });

  return {
    imageURL,
    request,
    clear,
    initialize,
    preload,
    pausePreload,
    resumePreload,
    stopPreload,
  };
}
