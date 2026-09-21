// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import {
  useVideoAdjustments,
  videoGammaFilterId,
} from "./useVideoAdjustments";

afterEach(cleanup);

describe("useVideoAdjustments", () => {
  function setup() {
    let adjustments!: ReturnType<typeof useVideoAdjustments>;
    render(
      defineComponent({
        setup() {
          adjustments = useVideoAdjustments();
          return () => h("div");
        },
      }),
    );
    return adjustments;
  }

  it("does not create a filter for the neutral defaults", () => {
    const adjustments = setup();

    expect(adjustments.adjusted.value).toBe(false);
    expect(adjustments.style.value).toEqual({});
    expect(adjustments.gammaExponent.value).toBe(1);
  });

  it("combines CSS color controls with an SVG gamma transfer", () => {
    const adjustments = setup();

    adjustments.set("brightness", 1.2);
    adjustments.set("contrast", 0.8);
    adjustments.set("saturation", 1.4);
    adjustments.set("gamma", 2);

    expect(adjustments.adjusted.value).toBe(true);
    expect(adjustments.style.value.filter).toBe(
      `brightness(1.2) contrast(0.8) saturate(1.4) url(\"#${videoGammaFilterId}\")`,
    );
    expect(adjustments.gammaExponent.value).toBe(0.5);
  });

  it("clamps invalid values and restores every neutral value", () => {
    const adjustments = setup();

    adjustments.set("brightness", 100);
    adjustments.set("saturation", -5);
    adjustments.set("gamma", Number.NaN);
    expect(adjustments.values).toEqual({
      brightness: 1.5,
      contrast: 1,
      saturation: 0,
      gamma: 1,
    });

    adjustments.reset();
    expect(adjustments.values).toEqual({
      brightness: 1,
      contrast: 1,
      saturation: 1,
      gamma: 1,
    });
    expect(adjustments.style.value).toEqual({});
  });
});
