import {
  onBeforeUnmount,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { playerCommand } from "./keyboard";
import { clampVolume } from "./playerState";
import { useEventListener } from "./useEventListener";
import { useMobileSeekGestures } from "./useMobileSeekGestures";

type Options = {
  video: Ref<HTMLVideoElement | null>;
  current: Ref<number>;
  playing: Ref<boolean>;
  controls: Ref<boolean>;
  diagnosticsOpen: Ref<boolean>;
  diagnosticsCopied: Ref<boolean>;
  menu: Ref<string>;
  volume: Ref<number>;
  muted: Ref<boolean>;
  diagnosticCopyText: ComputedRef<string>;
  togglePlayback: () => void;
  seek: (position: number) => void;
  onBoostStart?: () => void;
  onBoostEnd?: () => void;
};

export function usePlayerInteractions(options: Options) {
  const playbackRate = shallowRef(1);
  let hideTimer: number | undefined;
  let copiedTimer: number | undefined;
  let holdTimer: number | undefined;
  let holdSource: "pointer" | "space" | undefined;
  let holdWasPaused = false;
  let holdPreviousRate = 1;
  let pendingSpace = false;
  let suppressSurfaceClick = false;
  let touchSurfaceClick = false;
  let touchStartedWithControlsVisible = true;
  let lastAudibleVolume = 1;

  const holdDelayMilliseconds = 350;
  const mobileSeek = useMobileSeekGestures({
    current: options.current,
    seek: options.seek,
    singleTap: handleMobileSingleTap,
    revealControls: reveal,
  });

  function usesTouchLayout(): boolean {
    return window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
  }

  function scheduleControlsHide(delay?: number): void {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    hideTimer = undefined;
    if (!options.playing.value || options.diagnosticsOpen.value) return;
    hideTimer = window.setTimeout(() => {
      options.controls.value = false;
      options.menu.value = "";
      hideTimer = undefined;
    }, delay ?? (usesTouchLayout() ? 5000 : 2600));
  }

  function hideMobileControls(): void {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    hideTimer = undefined;
    options.controls.value = false;
    options.menu.value = "";
    closeDiagnostics();
  }

  function handleMobileSingleTap(): void {
    if (!options.playing.value) {
      options.controls.value = true;
      options.togglePlayback();
      return;
    }
    if (touchStartedWithControlsVisible) hideMobileControls();
    else scheduleControlsHide(5000);
  }

  function applyPlaybackRate(value: number): void {
    const element = options.video.value;
    if (element) element.playbackRate = value;
  }

  function setPlaybackRate(value: number): void {
    playbackRate.value = value;
    if (!holdSource) applyPlaybackRate(value);
  }

  function clearHoldTimer(): void {
    if (holdTimer !== undefined) window.clearTimeout(holdTimer);
    holdTimer = undefined;
  }

  function beginHold(source: "pointer" | "space"): void {
    if (holdTimer !== undefined || holdSource) return;
    holdTimer = window.setTimeout(() => {
      holdTimer = undefined;
      const element = options.video.value;
      if (!element) return;
      holdSource = source;
      options.onBoostStart?.();
      holdWasPaused = element.paused;
      holdPreviousRate = element.playbackRate || playbackRate.value;
      element.playbackRate = 2;
      if (element.paused) void element.play();
    }, holdDelayMilliseconds);
  }

  function restoreHold(source: "pointer" | "space"): boolean {
    if (holdSource !== source) return false;
    options.onBoostEnd?.();
    const element = options.video.value;
    if (element) {
      element.playbackRate = holdPreviousRate;
      if (holdWasPaused) element.pause();
    }
    holdSource = undefined;
    holdWasPaused = false;
    if (source === "pointer") suppressSurfaceClick = true;
    return true;
  }

  function cancelHolds(): void {
    clearHoldTimer();
    pendingSpace = false;
    if (holdSource) restoreHold(holdSource);
  }

  function syncVolumeFromElement() {
    const element = options.video.value;
    if (!element) return;
    options.volume.value = element.volume;
    options.muted.value = element.muted;
    if (element.volume > 0 && !element.muted)
      lastAudibleVolume = element.volume;
  }

  function setVolume(value: number) {
    const element = options.video.value;
    if (!element) return;
    const next = clampVolume(value);
    element.volume = next;
    if (next > 0) {
      lastAudibleVolume = next;
      element.muted = false;
    } else element.muted = true;
    syncVolumeFromElement();
  }

  function changeVolume(event: Event) {
    setVolume(Number((event.target as HTMLInputElement).value));
  }

  function toggleMute() {
    const element = options.video.value;
    if (!element) return;
    if (element.muted || element.volume === 0) {
      if (element.volume === 0) element.volume = lastAudibleVolume || 1;
      element.muted = false;
    } else {
      lastAudibleVolume = element.volume;
      element.muted = true;
    }
    syncVolumeFromElement();
  }

  function isTypingTarget(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    if (!element) return false;
    if (
      element.isContentEditable ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT"
    )
      return true;
    if (element.tagName !== "INPUT") return false;
    return [
      "text",
      "search",
      "email",
      "password",
      "number",
      "url",
      "tel",
    ].includes((element as HTMLInputElement).type);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && options.diagnosticsOpen.value) {
      event.preventDefault();
      closeDiagnostics();
      return;
    }
    const typing = isTypingTarget(event.target);
    const space = event.code === "Space" || event.key === " ";
    if (
      space &&
      !typing &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      if (!event.repeat && !pendingSpace && holdSource !== "space") {
        pendingSpace = true;
        beginHold("space");
      }
      return;
    }
    const command = playerCommand({
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      typing,
    });
    if (!command) return;
    event.preventDefault();
    if (command === "toggle-playback") options.togglePlayback();
    else if (command === "seek-backward")
      options.seek(options.current.value - 5);
    else if (command === "seek-forward")
      options.seek(options.current.value + 5);
    else void fullscreen();
  }

  function handleKeyup(event: KeyboardEvent): void {
    if (event.code !== "Space" && event.key !== " ") return;
    if (!pendingSpace && holdSource !== "space") return;
    event.preventDefault();
    const wasHeld = restoreHold("space");
    clearHoldTimer();
    pendingSpace = false;
    if (!wasHeld) options.togglePlayback();
  }

  function beginSurfacePress(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      touchSurfaceClick = true;
      touchStartedWithControlsVisible = options.controls.value;
      return;
    }
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    suppressSurfaceClick = false;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(
      event.pointerId,
    );
    beginHold("pointer");
  }

  function endSurfacePress(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      mobileSeek.handlePointerUp(event);
      return;
    }
    if (event.pointerType === "mouse") {
      restoreHold("pointer");
      clearHoldTimer();
    }
  }

  function cancelSurfacePress(): void {
    touchSurfaceClick = false;
    restoreHold("pointer");
    clearHoldTimer();
  }

  function surfaceClick(): void {
    if (mobileSeek.consumeSyntheticClick()) {
      touchSurfaceClick = false;
      return;
    }
    if (touchSurfaceClick) {
      touchSurfaceClick = false;
      handleMobileSingleTap();
      return;
    }
    if (suppressSurfaceClick) {
      suppressSurfaceClick = false;
      return;
    }
    options.togglePlayback();
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const video = options.video.value;
        const player = video?.closest<HTMLElement>(".player");
        await (player ?? video?.parentElement)?.requestFullscreen();
      }
    } catch {}
  }

  function pip() {
    void (
      options.video.value as
        | (HTMLVideoElement & {
            requestPictureInPicture?: () => Promise<unknown>;
          })
        | null
    )?.requestPictureInPicture?.();
  }

  function toggleDiagnostics() {
    options.diagnosticsOpen.value = !options.diagnosticsOpen.value;
    options.diagnosticsCopied.value = false;
    options.menu.value = "";
    options.controls.value = true;
    if (hideTimer) clearTimeout(hideTimer);
  }

  function closeDiagnostics() {
    options.diagnosticsOpen.value = false;
    options.diagnosticsCopied.value = false;
  }

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(options.diagnosticCopyText.value);
    } catch {
      const field = document.createElement("textarea");
      field.value = options.diagnosticCopyText.value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    options.diagnosticsCopied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(
      () => (options.diagnosticsCopied.value = false),
      1800,
    );
  }

  function reveal(event?: Event) {
    options.controls.value = true;
    const touched = event?.type.startsWith("touch") ?? false;
    scheduleControlsHide(touched ? 5000 : undefined);
  }

  watch(options.playing, (isPlaying) => {
    if (isPlaying) scheduleControlsHide();
    else {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      hideTimer = undefined;
      options.controls.value = true;
    }
  });

  useEventListener<KeyboardEvent>(window, "keydown", handleKeydown);
  useEventListener<KeyboardEvent>(window, "keyup", handleKeyup);
  useEventListener(window, "blur", cancelHolds);
  useEventListener(document, "visibilitychange", () => {
    if (document.hidden) cancelHolds();
  });
  useEventListener<PointerEvent>(document, "pointerdown", (event) => {
    if (!options.diagnosticsOpen.value) return;
    const target = event.target as Element | null;
    if (target?.closest(".diagnostics-panel, [data-diagnostics-toggle]")) return;
    closeDiagnostics();
  });
  onBeforeUnmount(() => {
    if (hideTimer) clearTimeout(hideTimer);
    if (copiedTimer) clearTimeout(copiedTimer);
    cancelHolds();
  });

  return {
    changeVolume,
    beginSurfacePress,
    cancelSurfacePress,
    closeDiagnostics,
    copyDiagnostics,
    fullscreen,
    pip,
    playbackRate,
    mobileSeekDirection: mobileSeek.hintDirection,
    mobileSeekSeconds: mobileSeek.hintSeconds,
    reveal,
    syncVolumeFromElement,
    setPlaybackRate,
    surfaceClick,
    endSurfacePress,
    toggleDiagnostics,
    toggleMute,
  };
}
