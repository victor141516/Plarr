export interface PlayerLocation {
  mediaId: string;
  mediaPath: string;
  params: URLSearchParams;
  base: string;
  parentOrigin: string;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function parsePlayerLocation(hash: string): PlayerLocation {
  const routePart = hash.replace(/^#/, "").startsWith("/play/")
    ? hash.replace(/^#/, "").slice(6)
    : "";
  const [mediaId = "", query = ""] = routePart.split("?");
  const params = new URLSearchParams(query);
  let mediaPath = "";
  try {
    mediaPath = new TextDecoder().decode(
      Uint8Array.from(
        atob(
          mediaId.replace(/-/g, "+").replace(/_/g, "/") +
            "===".slice((mediaId.length + 3) % 4),
        ),
        (character) => character.charCodeAt(0),
      ),
    );
  } catch {
    // An invalid media id is handled by the bootstrap request.
  }
  return {
    mediaId,
    mediaPath,
    params,
    base: `/api/v1/media/${encodeURIComponent(mediaId)}`,
    parentOrigin: params.get("parentOrigin") || "",
    hasPrevious: params.get("hasPrevious") === "1",
    hasNext: params.get("hasNext") === "1",
  };
}
