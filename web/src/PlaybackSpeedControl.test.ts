// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import PlaybackSpeedControl from "./PlaybackSpeedControl.vue";

afterEach(cleanup);

describe("PlaybackSpeedControl", () => {
  it("shows the exact rate and emits the discrete slider value", async () => {
    const view = render(PlaybackSpeedControl, { props: { value: 1.25 } });
    expect(view.getByText("1.25×")).toBeTruthy();
    await fireEvent.input(view.getByRole("slider"), { target: { value: "8" } });
    expect(view.emitted().select).toEqual([[2.5]]);
  });
});
