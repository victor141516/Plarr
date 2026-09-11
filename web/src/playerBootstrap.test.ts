import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlayerBootstrap } from "./playerBootstrap";

afterEach(() => vi.restoreAllMocks());

describe("loadPlayerBootstrap", () => {
  it("loads config and probe with the same cancellation signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ allowedParentOrigins: [] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ durationSeconds: 30 })),
      );

    await expect(
      loadPlayerBootstrap("/api/v1/media/id", controller.signal),
    ).resolves.toEqual({
      config: { allowedParentOrigins: [] },
      probe: { durationSeconds: 30 },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/config", {
      signal: controller.signal,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/media/id/probe", {
      signal: controller.signal,
    });
  });

  it("surfaces an API error instead of accepting an invalid config", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Bad config" } }), {
          status: 500,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ durationSeconds: 30 })),
      );

    await expect(
      loadPlayerBootstrap("/api/v1/media/id", new AbortController().signal),
    ).rejects.toThrow("Bad config");
  });
});
