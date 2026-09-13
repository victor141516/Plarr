// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { AudioLines, Play } from "@lucide/vue";
import PlayerOverflowMenu from "./PlayerOverflowMenu.vue";

afterEach(cleanup);

describe("PlayerOverflowMenu", () => {
  it("keeps quick actions compact and settings as labelled rows", async () => {
    const view = render(PlayerOverflowMenu, {
      props: {
        open: true,
        hiddenIds: ["play", "audio"],
        quickActions: [{ id: "play", label: "Play", icon: Play }],
        settingActions: [
          {
            id: "audio",
            label: "Audio tracks",
            icon: AudioLines,
            submenu: true,
          },
        ],
      },
      slots: { audio: "Audio choices" },
    });

    expect(view.getByRole("button", { name: "Play" }).textContent).toBe("");
    expect(view.getByText("Audio tracks")).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "Audio tracks" }));
    expect(view.getByText("Audio choices")).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect(view.getByText("Audio tracks")).toBeTruthy();
  });

  it("emits direct actions without opening a subview", async () => {
    const view = render(PlayerOverflowMenu, {
      props: {
        open: true,
        hiddenIds: ["play"],
        quickActions: [{ id: "play", label: "Play", icon: Play }],
        settingActions: [],
      },
    });
    await fireEvent.click(view.getByRole("button", { name: "Play" }));
    expect(view.emitted().activate).toEqual([["play"]]);
  });
});
