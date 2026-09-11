import { onScopeDispose, type Ref } from "vue";

export interface PlaybackStartupWatchdogOptions {
  loading: Readonly<Ref<boolean>>;
  timeoutMilliseconds?: number;
  hasPlayableBuffer: () => boolean;
  onTimeout: () => void;
}

export function usePlaybackStartupWatchdog(
  options: PlaybackStartupWatchdogOptions,
) {
  let timer: number | undefined;
  let generation = 0;

  function clear(): void {
    generation++;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  }

  function arm(): void {
    clear();
    const current = generation;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (
        generation === current &&
        options.loading.value &&
        !options.hasPlayableBuffer()
      ) {
        options.onTimeout();
      }
    }, options.timeoutMilliseconds ?? 15_000);
  }

  onScopeDispose(clear);

  return { arm, clear };
}
