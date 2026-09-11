import {
  computed,
  reactive,
  readonly,
  type CSSProperties,
  type Ref,
} from "vue";

export type VideoFrameSide = "top" | "right" | "bottom" | "left";

export interface VideoFrameCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const minimumVisibleFraction = 0.2;
const maximumCropPerSide = 40;
const storageNamespace = "plarr:video-framing:v1";
const sides: VideoFrameSide[] = ["top", "right", "bottom", "left"];

type Options = {
  sourceAspect?: Readonly<Ref<number>>;
  mediaId?: string;
};

function emptyCrop(): VideoFrameCrop {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function clampCrop(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximumCropPerSide, value));
}

export function videoFrameStorageKey(mediaId: string): string {
  return `${storageNamespace}:${mediaId}`;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function restoreCrop(mediaId: string | undefined): VideoFrameCrop {
  const storage = browserStorage();
  if (!storage || !mediaId) return emptyCrop();
  try {
    const stored = JSON.parse(storage.getItem(videoFrameStorageKey(mediaId)) || "null");
    if (!stored || typeof stored !== "object") return emptyCrop();
    return {
      top: clampCrop(stored.top),
      right: clampCrop(stored.right),
      bottom: clampCrop(stored.bottom),
      left: clampCrop(stored.left),
    };
  } catch {
    return emptyCrop();
  }
}

export function useVideoFraming(options: Options = {}) {
  const crop = reactive<VideoFrameCrop>(restoreCrop(options.mediaId));

  function persist(): void {
    const storage = browserStorage();
    if (!storage || !options.mediaId) return;
    try {
      storage.setItem(
        videoFrameStorageKey(options.mediaId),
        JSON.stringify(Object.fromEntries(sides.map((side) => [side, crop[side]]))),
      );
    } catch {
      // Playback and framing remain usable when browser storage is unavailable.
    }
  }

  const geometry = computed(() => {
    const visibleWidth = Math.max(
      minimumVisibleFraction,
      1 - (crop.left + crop.right) / 100,
    );
    const visibleHeight = Math.max(
      minimumVisibleFraction,
      1 - (crop.top + crop.bottom) / 100,
    );
    const sourceAspect = Math.max(0.01, options.sourceAspect?.value || 16 / 9);
    return {
      visibleWidth,
      visibleHeight,
      frameAspect: (sourceAspect * visibleWidth) / visibleHeight,
    };
  });

  const frameStyle = computed<CSSProperties>(() => {
    const frameAspect = geometry.value.frameAspect;
    return {
      width: `min(100%, calc(100vh * ${frameAspect}))`,
      height: `min(100%, calc(100vw / ${frameAspect}))`,
      aspectRatio: String(frameAspect),
    };
  });

  const videoStyle = computed<CSSProperties>(() => {
    const { visibleWidth, visibleHeight } = geometry.value;

    return {
      width: `${100 / visibleWidth}%`,
      height: `${100 / visibleHeight}%`,
      left: `${-(crop.left / 100 / visibleWidth) * 100}%`,
      top: `${-(crop.top / 100 / visibleHeight) * 100}%`,
    };
  });

  function adjust(side: VideoFrameSide, delta: number): void {
    const next = Math.max(
      0,
      Math.min(maximumCropPerSide, crop[side] + delta),
    );
    if (next === crop[side]) return;
    crop[side] = next;
    persist();
  }

  function reset(): void {
    crop.top = 0;
    crop.right = 0;
    crop.bottom = 0;
    crop.left = 0;
    const storage = browserStorage();
    if (!storage || !options.mediaId) return;
    try {
      storage.removeItem(videoFrameStorageKey(options.mediaId));
    } catch {
      // Playback and framing remain usable when browser storage is unavailable.
    }
  }

  return {
    crop: readonly(crop),
    frameStyle,
    videoStyle,
    adjust,
    reset,
  };
}
