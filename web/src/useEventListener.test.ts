// @vitest-environment jsdom
import { defineComponent } from "vue";
import { cleanup, render } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEventListener } from "./useEventListener";

afterEach(cleanup);

describe("useEventListener", () => {
  it("removes the listener when its component unmounts", () => {
    const listener = vi.fn();
    const view = render(
      defineComponent({
        setup() {
          useEventListener(window, "plarr-test", listener);
          return () => null;
        },
      }),
    );

    window.dispatchEvent(new Event("plarr-test"));
    expect(listener).toHaveBeenCalledTimes(1);

    view.unmount();
    window.dispatchEvent(new Event("plarr-test"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
