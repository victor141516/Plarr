// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import PlaybackDiagnosticsPanel from "./PlaybackDiagnosticsPanel.vue";

describe("PlaybackDiagnosticsPanel", () => {
  it("renders typed diagnostic rows and emits its actions", async () => {
    const view = render(PlaybackDiagnosticsPanel, {
      props: {
        sections: [
          { title: "Stream", rows: [{ label: "Codec", value: "H.264" }] },
        ],
        copied: false,
      },
    });

    expect(view.getByText("H.264")).toBeTruthy();
    await fireEvent.click(
      view.getByRole("button", { name: "Copy information" }),
    );
    await fireEvent.click(
      view.getByRole("button", { name: "Close advanced information" }),
    );

    expect(view.emitted().copy).toHaveLength(1);
    expect(view.emitted().close).toHaveLength(1);
  });
});
