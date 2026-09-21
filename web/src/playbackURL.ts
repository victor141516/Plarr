export function playbackURL(raw: string, playbackToken = ""): string {
  if (!playbackToken) return raw;
  const [path = raw, fragment = ""] = raw.split("#", 2);
  const separator = path.includes("?") ? "&" : "?";
  const secured = `${path}${separator}playback_token=${encodeURIComponent(playbackToken)}`;
  return fragment ? `${secured}#${fragment}` : secured;
}

export function isPlaybackAuthorizationFailure(status: number): boolean {
  return status === 401 || status === 403;
}
