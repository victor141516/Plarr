import { computed, reactive, readonly, type CSSProperties } from "vue";

export type VideoAdjustmentName =
  | "brightness"
  | "contrast"
  | "saturation"
  | "gamma";

export interface VideoAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
}

export const videoGammaFilterId = "plarr-video-gamma";

const defaults: VideoAdjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  gamma: 1,
};

const ranges: Record<
  VideoAdjustmentName,
  { minimum: number; maximum: number }
> = {
  brightness: { minimum: 0.5, maximum: 1.5 },
  contrast: { minimum: 0.5, maximum: 1.5 },
  saturation: { minimum: 0, maximum: 2 },
  gamma: { minimum: 0.5, maximum: 2 },
};

function normalizedValue(name: VideoAdjustmentName, value: number): number {
  if (!Number.isFinite(value)) return defaults[name];
  const range = ranges[name];
  return Math.max(range.minimum, Math.min(range.maximum, value));
}

export function useVideoAdjustments() {
  const values = reactive<VideoAdjustments>({ ...defaults });

  const adjusted = computed(() =>
    (Object.keys(defaults) as VideoAdjustmentName[]).some(
      (name) => values[name] !== defaults[name],
    ),
  );

  const gammaExponent = computed(() => 1 / values.gamma);

  const style = computed<CSSProperties>(() => {
    const filters: string[] = [];
    if (values.brightness !== 1) {
      filters.push(`brightness(${values.brightness})`);
    }
    if (values.contrast !== 1) {
      filters.push(`contrast(${values.contrast})`);
    }
    if (values.saturation !== 1) {
      filters.push(`saturate(${values.saturation})`);
    }
    if (values.gamma !== 1) {
      filters.push(`url("#${videoGammaFilterId}")`);
    }
    return filters.length ? { filter: filters.join(" ") } : {};
  });

  function set(name: VideoAdjustmentName, value: number): void {
    values[name] = normalizedValue(name, value);
  }

  function reset(): void {
    Object.assign(values, defaults);
  }

  return {
    values: readonly(values),
    adjusted,
    gammaExponent,
    style,
    set,
    reset,
  };
}
