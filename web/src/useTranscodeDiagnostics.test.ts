// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, nextTick, shallowRef } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscodeDiagnostics } from "./useTranscodeDiagnostics";

describe("useTranscodeDiagnostics", () => {
  const active = shallowRef(true);

  beforeEach(() => {
    vi.useFakeTimers();
    active.value = true;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("refreshes fallback history only while the panel is open", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rendition: "1080p",
            attempts: [{ name: "nvidia-cuda-tonemap", status: "running" }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rendition: "1080p",
            attempts: [
              {
                name: "nvidia-cuda-tonemap",
                status: "failed",
                error: "CUDA device unavailable",
              },
              { name: "cpu", status: "active" },
            ],
            selected: "cpu",
          }),
        ),
      );
    let state: ReturnType<typeof useTranscodeDiagnostics> | undefined;
    render(
      defineComponent({
        setup() {
          state = useTranscodeDiagnostics({
            sessionId: "session-1",
            active,
            pollMilliseconds: 1000,
            fetcher,
          });
          return () => null;
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(state?.diagnostics.value?.attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(state?.diagnostics.value?.selected).toBe("cpu");

    active.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
