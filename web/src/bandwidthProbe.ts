type BandwidthFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function measureNetworkBandwidth(
  url: string,
  signal?: AbortSignal,
  fetcher: BandwidthFetcher = fetch,
  now: () => number = () => performance.now(),
): Promise<number> {
  const started = now();
  const response = await fetcher(url, {
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(`Bandwidth probe failed with HTTP ${response.status}`);
  const bytes = (await response.arrayBuffer()).byteLength;
  const elapsedSeconds = Math.max(0.001, (now() - started) / 1000);
  return Math.round((bytes * 8) / elapsedSeconds);
}
