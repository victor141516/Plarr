import { describe, expect, it } from "vitest";
import {
  calculateResponsiveControls,
  type ResponsiveControlDefinition,
} from "./useResponsiveControls";

const controls: ResponsiveControlDefinition[] = [
  { id: "time", zone: "left", priority: 0, overflow: false },
  { id: "volume", zone: "left", priority: 1, overflow: true },
  { id: "back", zone: "left", priority: 3, overflow: true },
  { id: "play", zone: "left", priority: 4, overflow: true },
  { id: "forward", zone: "left", priority: 3, overflow: true },
  { id: "quality", zone: "right", priority: 2, overflow: true },
];

const widths = Object.fromEntries(controls.map(({ id }) => [id, 40]));

describe("calculateResponsiveControls", () => {
  it("keeps every control when the left and right groups fit", () => {
    const result = calculateResponsiveControls({
      containerWidth: 500,
      controls,
      widths,
      moreWidth: 40,
      gap: 6,
    });
    expect([...result.hidden]).toEqual([]);
    expect(result.overflowing).toBe(false);
  });

  it("hides controls in priority order without hysteresis", () => {
    const result = calculateResponsiveControls({
      containerWidth: 250,
      controls,
      widths,
      moreWidth: 40,
      gap: 6,
    });
    expect(result.hidden.has("time")).toBe(true);
    expect(result.hidden.has("volume")).toBe(true);
    expect(result.hidden.has("quality")).toBe(false);
    expect(result.hidden.has("back")).toBe(false);
    expect(result.hidden.has("forward")).toBe(false);
  });

  it("hides equal-priority controls together", () => {
    const result = calculateResponsiveControls({
      containerWidth: 130,
      controls,
      widths,
      moreWidth: 40,
      gap: 6,
    });
    expect(result.hidden.has("back")).toBe(true);
    expect(result.hidden.has("forward")).toBe(true);
    expect(result.hidden.has("play")).toBe(false);
  });

  it("reports the last-resort overflow after every optional control is hidden", () => {
    const result = calculateResponsiveControls({
      containerWidth: 30,
      controls,
      widths,
      moreWidth: 40,
      gap: 6,
    });
    expect(result.hidden.size).toBe(controls.length);
    expect(result.overflowing).toBe(true);
  });
});
