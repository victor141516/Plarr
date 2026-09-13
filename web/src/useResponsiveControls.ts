import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComputedRef,
} from "vue";

export type ControlZone = "left" | "center" | "right";

export interface ResponsiveControlDefinition {
  id: string;
  zone: ControlZone;
  priority: number;
  overflow: boolean;
}

export interface ResponsiveControlLayout {
  containerWidth: number;
  controls: readonly ResponsiveControlDefinition[];
  widths: Readonly<Record<string, number>>;
  moreWidth: number;
  gap: number;
}

export interface ResponsiveControlResult {
  hidden: Set<string>;
  overflowing: boolean;
}

function zoneWidth(
  controls: readonly ResponsiveControlDefinition[],
  widths: Readonly<Record<string, number>>,
  hidden: ReadonlySet<string>,
  gap: number,
): number {
  const visible = controls.filter((control) => !hidden.has(control.id));
  if (!visible.length) return 0;
  return (
    visible.reduce((total, control) => total + (widths[control.id] ?? 0), 0) +
    gap * (visible.length - 1)
  );
}

export function calculateResponsiveControls(
  layout: ResponsiveControlLayout,
): ResponsiveControlResult {
  const hidden = new Set<string>();
  const left = layout.controls.filter((control) => control.zone === "left");
  const center = layout.controls.filter((control) => control.zone === "center");
  const right = layout.controls.filter((control) => control.zone === "right");

  const fits = () => {
    const leftWidth = zoneWidth(left, layout.widths, hidden, layout.gap);
    const centerWidth = zoneWidth(center, layout.widths, hidden, layout.gap);
    const visibleRightWidth = zoneWidth(right, layout.widths, hidden, layout.gap);
    const visibleRightCount = right.filter(
      (control) => !hidden.has(control.id),
    ).length;
    const rightWidth =
      visibleRightWidth +
      layout.moreWidth +
      (visibleRightCount ? layout.gap : 0);
    const occupiedZones = [leftWidth, centerWidth, rightWidth].filter(
      (width) => width > 0,
    ).length;
    return (
      leftWidth +
        centerWidth +
        rightWidth +
        layout.gap * Math.max(0, occupiedZones - 1) <=
      layout.containerWidth
    );
  };

  const priorities = [...new Set(layout.controls.map((control) => control.priority))]
    .sort((a, b) => a - b);
  for (const priority of priorities) {
    if (fits()) return { hidden, overflowing: false };
    for (const control of layout.controls) {
      if (control.priority === priority) hidden.add(control.id);
    }
  }

  return { hidden, overflowing: !fits() };
}

export function useResponsiveControls(
  definitions: ComputedRef<readonly ResponsiveControlDefinition[]>,
) {
  const row = ref<HTMLElement | null>(null);
  const hidden = ref<Set<string>>(new Set());
  const overflowing = ref(false);
  const measuredWidths: Record<string, number> = {};
  let observer: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;

  const hiddenOverflowIds = computed(() =>
    definitions.value
      .filter((control) => control.overflow && hidden.value.has(control.id))
      .map((control) => control.id),
  );

  function equalSets(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    return a.size === b.size && [...a].every((item) => b.has(item));
  }

  function measure(): void {
    const element = row.value;
    if (!element || element.clientWidth <= 0) return;
    element.querySelectorAll<HTMLElement>("[data-control-id]").forEach((item) => {
      const id = item.dataset.controlId;
      if (id) measuredWidths[id] = item.getBoundingClientRect().width;
    });
    const more = element.querySelector<HTMLElement>("[data-control-more]");
    const moreWidth = more?.getBoundingClientRect().width ?? 40;
    const style = getComputedStyle(element);
    const gap = Number.parseFloat(style.getPropertyValue("--control-gap")) || 6;
    const result = calculateResponsiveControls({
      containerWidth: element.clientWidth,
      controls: definitions.value,
      widths: measuredWidths,
      moreWidth,
      gap,
    });
    if (!equalSets(hidden.value, result.hidden)) hidden.value = result.hidden;
    overflowing.value = result.overflowing;
  }

  function scheduleMeasure(): void {
    void nextTick(() => measure());
  }

  onMounted(() => {
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleMeasure);
      if (row.value) observer.observe(row.value);
    }
    if (typeof MutationObserver !== "undefined" && row.value) {
      mutationObserver = new MutationObserver(scheduleMeasure);
      mutationObserver.observe(row.value, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    scheduleMeasure();
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    mutationObserver?.disconnect();
  });
  watch(definitions, scheduleMeasure, { deep: true });
  watch(hidden, scheduleMeasure);

  return {
    row,
    hidden,
    hiddenOverflowIds,
    overflowing,
    isVisible: (id: string) => !hidden.value.has(id),
  };
}
