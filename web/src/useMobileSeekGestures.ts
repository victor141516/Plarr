import { onBeforeUnmount, readonly, shallowRef, type Ref } from "vue";

export type MobileSeekDirection = "backward" | "forward";

type Options = {
  current: Ref<number>;
  seek: (position: number) => void;
  singleTap: () => void;
  revealControls: () => void;
};

const doubleTapWindowMilliseconds = 320;
const hintLifetimeMilliseconds = 500;
const seekStepSeconds = 5;

export function useMobileSeekGestures(options: Options) {
  const hintDirection = shallowRef<MobileSeekDirection | undefined>();
  const hintSeconds = shallowRef(0);
  let lastTapAt = 0;
  let lastTapDirection: MobileSeekDirection | undefined;
  let gestureStartPosition = 0;
  let singleTapTimer: number | undefined;
  let hintTimer: number | undefined;
  let suppressNextClick = false;
  let suppressClickTimer: number | undefined;

  function clearSingleTap(): void {
    if (singleTapTimer !== undefined) window.clearTimeout(singleTapTimer);
    singleTapTimer = undefined;
  }

  function clearHintTimer(): void {
    if (hintTimer !== undefined) window.clearTimeout(hintTimer);
    hintTimer = undefined;
  }

  function suppressSyntheticClick(): void {
    suppressNextClick = true;
    if (suppressClickTimer !== undefined)
      window.clearTimeout(suppressClickTimer);
    suppressClickTimer = window.setTimeout(() => {
      suppressNextClick = false;
      suppressClickTimer = undefined;
    }, 500);
  }

  function directionFor(event: PointerEvent): MobileSeekDirection | undefined {
    const element = event.currentTarget as HTMLElement | null;
    if (!element) return undefined;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0) return undefined;
    const ratio = (event.clientX - bounds.left) / bounds.width;
    if (ratio <= 0.25) return "backward";
    if (ratio >= 0.75) return "forward";
    return undefined;
  }

  function showHint(direction: MobileSeekDirection, seconds: number): void {
    hintDirection.value = direction;
    hintSeconds.value = seconds;
    clearHintTimer();
    hintTimer = window.setTimeout(() => {
      hintDirection.value = undefined;
      hintSeconds.value = 0;
      hintTimer = undefined;
    }, hintLifetimeMilliseconds);
  }

  function handlePointerUp(event: PointerEvent): boolean {
    if (event.pointerType !== "touch") return false;
    const direction = directionFor(event);
    if (!direction) return false;

    suppressSyntheticClick();
    options.revealControls();
    const now = Date.now();
    const continuesGesture =
      direction === lastTapDirection &&
      now - lastTapAt <= doubleTapWindowMilliseconds;

    if (!continuesGesture) {
      clearSingleTap();
      lastTapDirection = direction;
      lastTapAt = now;
      gestureStartPosition = options.current.value;
      hintDirection.value = undefined;
      hintSeconds.value = 0;
      singleTapTimer = window.setTimeout(() => {
        singleTapTimer = undefined;
        lastTapDirection = undefined;
        options.singleTap();
      }, doubleTapWindowMilliseconds);
      return true;
    }

    clearSingleTap();
    lastTapAt = now;
    const seconds =
      hintDirection.value === direction
        ? hintSeconds.value + seekStepSeconds
        : seekStepSeconds;
    const sign = direction === "forward" ? 1 : -1;
    options.seek(gestureStartPosition + sign * seconds);
    showHint(direction, seconds);
    return true;
  }

  function consumeSyntheticClick(): boolean {
    if (!suppressNextClick) return false;
    suppressNextClick = false;
    if (suppressClickTimer !== undefined)
      window.clearTimeout(suppressClickTimer);
    suppressClickTimer = undefined;
    return true;
  }

  onBeforeUnmount(() => {
    clearSingleTap();
    clearHintTimer();
    if (suppressClickTimer !== undefined)
      window.clearTimeout(suppressClickTimer);
  });

  return {
    hintDirection: readonly(hintDirection),
    hintSeconds: readonly(hintSeconds),
    handlePointerUp,
    consumeSyntheticClick,
  };
}
