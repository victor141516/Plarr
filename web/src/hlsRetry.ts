export interface HLSNetworkErrorLike {
  response?: { code?: number };
  networkDetails?: { status?: number } | null;
}

export function hlsResponseStatus(error: HLSNetworkErrorLike): number {
  return Number(error.response?.code || error.networkDetails?.status || 0);
}

export function isExpiredHLSWindow(error: HLSNetworkErrorLike): boolean {
  return hlsResponseStatus(error) === 409;
}

export function shouldRetryHLSNetworkError(
  error: HLSNetworkErrorLike,
  attempts: number,
): boolean {
  if (attempts >= 3) return false;
  const status = hlsResponseStatus(error);
  if (status >= 400 && status < 500) return false;
  // Plarr uses 500 for deterministic generation failures after all encoder
  // strategies have already been exhausted. Repeating the same request only
  // hides the useful error behind a long loading loop.
  if (status === 500) return false;
  return status === 0 || status === 408 || status === 429 || status >= 502;
}
