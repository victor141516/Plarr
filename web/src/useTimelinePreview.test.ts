// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelinePreview } from "./useTimelinePreview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useTimelinePreview", () => {
  it("never starts preview work from hover, even before initialization", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    let preview!: ReturnType<typeof useTimelinePreview>;
    render(
      defineComponent({
        setup() {
          preview = useTimelinePreview({ base: "/media", fetcher });
          return () => null;
        },
      }),
    );

    preview.request(10);
    preview.request(3000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(preview.imageURL.value).toBe("");
  });

  it("seeds complete coverage first, then refines each parent left to right", async () => {
    vi.useFakeTimers();
    const responses: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => responses.push(resolve)),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preload"),
      revokeObjectURL: vi.fn(),
    });
    let preview!: ReturnType<typeof useTimelinePreview>;
    render(
      defineComponent({
        setup() {
          preview = useTimelinePreview({
            base: "/media",
            fetcher,
            refinementDepth: 2,
            preloadConcurrency: 5,
          });
          return () => null;
        },
      }),
    );

    preview.initialize(900);
    expect(fetcher).toHaveBeenCalledOnce();
    responses[0]!(new Response(new Blob(["jpeg"])));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledOnce();

    preview.preload(900);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls.slice(0, 3).map((call) => call[0])).toEqual([
      "/media/preview.jpg?time=450",
      "/media/preview.jpg?time=150",
      "/media/preview.jpg?time=750",
    ]);
    responses[1]!(new Response(new Blob(["jpeg"])));
    responses[2]!(new Response(new Blob(["jpeg"])));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
    expect(fetcher.mock.calls.slice(3, 5).map((call) => call[0])).toEqual([
      "/media/preview.jpg?time=50",
      "/media/preview.jpg?time=250",
    ]);
    responses[3]!(new Response(new Blob(["jpeg"])));
    responses[4]!(new Response(new Blob(["jpeg"])));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(7));
    responses[5]!(new Response(new Blob(["jpeg"])));
    responses[6]!(new Response(new Blob(["jpeg"])));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(9));
    responses[7]!(new Response(new Blob(["jpeg"])));
    responses[8]!(new Response(new Blob(["jpeg"])));
    expect(new Set(fetcher.mock.calls.map((call) => call[0])).size).toBe(9);
    vi.unstubAllGlobals();
  });

  it("uses one generated image throughout each final timeline segment", async () => {
    let objectURLIndex = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(new Blob(["jpeg"])),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => `blob:segment-${++objectURLIndex}`),
      revokeObjectURL: vi.fn(),
    });
    let preview!: ReturnType<typeof useTimelinePreview>;
    render(
      defineComponent({
        setup() {
          preview = useTimelinePreview({
            base: "/media",
            fetcher,
            refinementDepth: 1,
            preloadConcurrency: 4,
          });
          return () => null;
        },
      }),
    );

    preview.preload(100);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(objectURLIndex).toBe(3));
    preview.request(0);
    const firstSegment = preview.imageURL.value;
    preview.request(33.32);
    expect(preview.imageURL.value).toBe(firstSegment);
    preview.request(33.34);
    expect(preview.imageURL.value).not.toBe(firstSegment);
    vi.unstubAllGlobals();
  });

  it("serves a coarse ancestor immediately and improves it as stages finish", async () => {
    vi.useFakeTimers();
    const responses: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => responses.push(resolve)),
    );
    let objectURLIndex = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => `blob:level-${++objectURLIndex}`),
      revokeObjectURL: vi.fn(),
    });
    let preview!: ReturnType<typeof useTimelinePreview>;
    render(
      defineComponent({
        setup() {
          preview = useTimelinePreview({
            base: "/media",
            fetcher,
            refinementDepth: 2,
          });
          return () => null;
        },
      }),
    );

    preview.preload(100);
    preview.request(90);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(preview.imageURL.value).toBe("");
    responses[0]!(new Response(new Blob(["middle"])));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));

    expect(preview.imageURL.value).toBe("blob:level-1");
    preview.request(1);
    expect(preview.imageURL.value).toBe("blob:level-1");
    preview.request(50);
    expect(preview.imageURL.value).toBe("blob:level-1");
    preview.request(99);
    expect(preview.imageURL.value).toBe("blob:level-1");
    expect(fetcher).toHaveBeenCalledTimes(3);

    responses[2]!(new Response(new Blob(["right-third"])));
    await vi.waitFor(() =>
      expect(preview.imageURL.value).toBe("blob:level-2"),
    );
    vi.unstubAllGlobals();
  });

  it("updates an already visible hover as its interval is refined", async () => {
    const responses: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => responses.push(resolve)),
    );
    let objectURLIndex = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => `blob:refinement-${++objectURLIndex}`),
      revokeObjectURL: vi.fn(),
    });
    let preview!: ReturnType<typeof useTimelinePreview>;
    render(
      defineComponent({
        setup() {
          preview = useTimelinePreview({
            base: "/media",
            fetcher,
            refinementDepth: 2,
          });
          return () => null;
        },
      }),
    );

    preview.preload(100);
    preview.request(10);
    responses[0]!(new Response(new Blob(["whole timeline"])));
    await vi.waitFor(() =>
      expect(preview.imageURL.value).toBe("blob:refinement-1"),
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));

    responses[1]!(new Response(new Blob(["first third"])));
    await vi.waitFor(() =>
      expect(preview.imageURL.value).toBe("blob:refinement-2"),
    );
    responses[2]!(new Response(new Blob(["last third"])));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));

    responses[3]!(new Response(new Blob(["first ninth"])));
    await vi.waitFor(() =>
      expect(preview.imageURL.value).toBe("blob:refinement-4"),
    );
    vi.unstubAllGlobals();
  });

  it("cancels every running preload when playback becomes unavailable", async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    let preview!: ReturnType<typeof useTimelinePreview>;
    render(
      defineComponent({
        setup() {
          preview = useTimelinePreview({
            base: "/media",
            fetcher,
            refinementDepth: 5,
          });
          return () => null;
        },
      }),
    );

    preview.preload(7_200);
    expect(fetcher).toHaveBeenCalledOnce();
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    preview.stopPreload();
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("starts one server-side batch tied to the playback session", async () => {
    const fetcher = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/previews/start")) {
          return Promise.resolve(new Response(null, { status: 202 }));
        }
        if (String(input).endsWith("/previews/stop")) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
    );
    let preview!: ReturnType<typeof useTimelinePreview>;
    render(
      defineComponent({
        setup() {
          preview = useTimelinePreview({
            base: "/media",
            fetcher,
            refinementDepth: 2,
          });
          return () => null;
        },
      }),
    );

    preview.initialize(900, "playback-session");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[0]?.[0]).toBe("/media/previews/start");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      durationSeconds: 900,
      refinementDepth: 2,
      session: "playback-session",
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/media/preview.jpg?time=450",
    );

    preview.stopPreload();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls[2]?.[0]).toBe("/media/previews/stop");
  });
});
