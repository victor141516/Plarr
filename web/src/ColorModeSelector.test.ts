// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import ColorModeSelector from "./ColorModeSelector.vue";

afterEach(cleanup);

describe("ColorModeSelector", () => {
  it("moves its knob between the three controlled positions", async () => {
    const view = render(ColorModeSelector, {
      props: { value: "auto", hdrSupported: true },
    });
    const track = view.getByRole("group", { name: "HDR" });

    expect(track.style.getPropertyValue("--switch-position")).toBe("1");
    expect(
      view.getByRole("button", { name: "HDR Auto" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await view.rerender({ value: "hdr", hdrSupported: true });
    expect(track.style.getPropertyValue("--switch-position")).toBe("2");
    expect(
      view.getByRole("button", { name: "HDR On" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("emits the selected physical position", async () => {
    const view = render(ColorModeSelector, {
      props: { value: "auto", hdrSupported: true },
    });

    await fireEvent.click(view.getByRole("button", { name: "HDR Off" }));
    expect(view.emitted().select).toEqual([["sdr"]]);
  });
});
