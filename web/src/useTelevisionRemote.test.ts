// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/vue";
import { defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTelevisionRemote } from "./useTelevisionRemote";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(enabled = true) {
  const video = document.createElement("video");
  const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
  const options = {
    enabled,
    video: ref(video),
    menu: ref(""),
    diagnosticsOpen: ref(false),
    close: vi.fn(),
    toggle: vi.fn(),
  };
  const view = render(
    defineComponent({
      setup() {
        useTelevisionRemote(options);
        return () => h("button", "Audio");
      },
    }),
  );
  return { ...options, ...view, pause };
}

describe("webOS smoke-test remote", () => {
  it("closes overlays before pausing and closing the player", async () => {
    const p = mount();
    p.diagnosticsOpen.value = true;
    p.menu.value = "quality";
    await fireEvent.keyDown(window, { keyCode: 461 });
    expect(p.diagnosticsOpen.value).toBe(false);
    expect(p.close).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { keyCode: 461 });
    expect(p.menu.value).toBe("");
    expect(p.close).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { keyCode: 461 });
    expect(p.pause).toHaveBeenCalledOnce();
    expect(p.close).toHaveBeenCalledOnce();
  });
  it("uses OK on the video without hijacking a focused control", async () => {
    const p = mount();
    await fireEvent.keyDown(window, { key: "Enter", keyCode: 13 });
    expect(p.toggle).toHaveBeenCalledOnce();
    p.getByRole("button").focus();
    await fireEvent.keyDown(window, { key: "Enter", keyCode: 13 });
    expect(p.toggle).toHaveBeenCalledOnce();
  });
  it("does not repeatedly close on a held Back key", async () => {
    const p = mount();
    await fireEvent.keyDown(window, { keyCode: 461, repeat: true });
    expect(p.close).not.toHaveBeenCalled();
  });
  it("leaves desktop input alone and removes handlers after unmount", async () => {
    const desktop = mount(false);
    await fireEvent.keyDown(window, { keyCode: 461 });
    expect(desktop.close).not.toHaveBeenCalled();
    desktop.unmount();
    const tv = mount();
    tv.unmount();
    await fireEvent.keyDown(window, { keyCode: 461 });
    expect(tv.close).not.toHaveBeenCalled();
  });
});
