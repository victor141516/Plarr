export function watchPartyShareURL(playerUrl: string): string {
  const url = new URL(playerUrl);
  const [path, query = ""] = url.hash.split("?");
  const current = new URLSearchParams(query);
  const shared = new URLSearchParams();
  for (const key of ["room", "playbackToken", "title"]) {
    const value = current.get(key);
    if (value) shared.set(key, value);
  }
  url.hash = `${path}?${shared}`;
  return url.toString();
}
