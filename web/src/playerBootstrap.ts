import type { PlayerConfig, PlayerProbe } from "./playerTypes";
import { playbackURL } from "./playbackURL";

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
  playbackToken = "",
  onConfig?: (config: PlayerConfig) => void,
  onAuthorizationExpired?: () => void,
): Promise<{ config: PlayerConfig; probe: PlayerProbe }> {
  const config = await fetch("/api/v1/config", { signal }).then((response) =>
    responseJSON<PlayerConfig>(response),
  );
  onConfig?.(config);
  const probe = await fetch(
    playbackURL(`${mediaBase}/probe`, playbackToken),
    { signal },
  ).then((response) => {
    if (response.status === 401 || response.status === 403) {
      onAuthorizationExpired?.();
    }
    return responseJSON<PlayerProbe>(response);
  });
  return { config, probe };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
