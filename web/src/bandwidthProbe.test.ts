import { describe, expect, it, vi } from "vitest";
import { measureNetworkBandwidth } from "./bandwidthProbe";

describe("measureNetworkBandwidth", () => {
  it("measures delivered bytes over elapsed wall time without caching", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(250_000)));
    const times = [100, 300];

    const measured = await measureNetworkBandwidth(
      "/media/bandwidth-probe",
      undefined,
      fetcher,
      () => times.shift()!,
    );

    expect(measured).toBe(10_000_000);
    expect(fetcher).toHaveBeenCalledWith("/media/bandwidth-probe", {
      cache: "no-store",
      signal: undefined,
    });
  });

  it("rejects unsuccessful responses", async () => {
    await expect(
      measureNetworkBandwidth(
        "/media/bandwidth-probe",
        undefined,
        async () => new Response(null, { status: 503 }),
      ),
    ).rejects.toThrow("HTTP 503");
  });
});
