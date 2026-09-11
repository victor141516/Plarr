import type { PlayerConfig, PlayerProbe } from "./playerTypes";

async function responseJSON<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  throw new Error(body?.error?.message || `HTTP ${response.status}`);
}

export async function loadPlayerBootstrap(
  mediaBase: string,
  signal: AbortSignal,
): Promise<{ config: PlayerConfig; probe: PlayerProbe }> {
  const [config, probe] = await Promise.all([
    fetch("/api/v1/config", { signal }).then((response) =>
      responseJSON<PlayerConfig>(response),
    ),
    fetch(`${mediaBase}/probe`, { signal }).then((response) =>
      responseJSON<PlayerProbe>(response),
    ),
  ]);
  return { config, probe };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
