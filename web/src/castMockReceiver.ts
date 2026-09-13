import type { CastMediaRequest } from "./castTypes";

export interface MockReceiverResult {
  requested: string[];
  videoSegment: string;
  audioSegment?: string;
}

function mediaLines(manifest: string): string[] {
  return manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function attributeURI(line: string): string | undefined {
  return line.match(/\bURI="([^"]+)"/)?.[1];
}

async function getText(
  url: string,
  requested: string[],
  fetcher: typeof fetch,
): Promise<string> {
  requested.push(url);
  const response = await fetcher(url);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Mock receiver request failed (${response.status}): ${url}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return response.text();
}

async function getBytes(
  url: string,
  requested: string[],
  fetcher: typeof fetch,
): Promise<void> {
  requested.push(url);
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Mock receiver request failed: ${url}`);
  await response.arrayBuffer();
}

export async function runMockCastReceiver(
  request: CastMediaRequest,
  fetcher: typeof fetch = fetch,
): Promise<MockReceiverResult> {
  const requested: string[] = [];
  const master = await getText(request.contentId, requested, fetcher);
  const videoReference = mediaLines(master)[0];
  if (!videoReference) throw new Error("Cast master has no video rendition.");
  const videoPlaylistURL = new URL(videoReference, request.contentId).toString();
  const videoPlaylist = await getText(videoPlaylistURL, requested, fetcher);
  const mapLine = videoPlaylist
    .split(/\r?\n/)
    .find((line) => line.startsWith("#EXT-X-MAP:"));
  const initReference = mapLine ? attributeURI(mapLine) : undefined;
  if (initReference) {
    await getBytes(
      new URL(initReference, videoPlaylistURL).toString(),
      requested,
      fetcher,
    );
  }
  const videoSegmentReference = mediaLines(videoPlaylist)[0];
  if (!videoSegmentReference)
    throw new Error("Cast video playlist has no media segment.");
  const videoSegment = new URL(
    videoSegmentReference,
    videoPlaylistURL,
  ).toString();
  await getBytes(videoSegment, requested, fetcher);

  const defaultAudioLine = master
    .split(/\r?\n/)
    .find(
      (line) =>
        line.startsWith("#EXT-X-MEDIA:") &&
        line.includes("TYPE=AUDIO") &&
        line.includes("DEFAULT=YES"),
    );
  const audioReference = defaultAudioLine
    ? attributeURI(defaultAudioLine)
    : undefined;
  let audioSegment: string | undefined;
  if (audioReference) {
    const audioPlaylistURL = new URL(audioReference, request.contentId).toString();
    const audioPlaylist = await getText(audioPlaylistURL, requested, fetcher);
    const segmentReference = mediaLines(audioPlaylist)[0];
    if (!segmentReference)
      throw new Error("Cast audio playlist has no media segment.");
    audioSegment = new URL(segmentReference, audioPlaylistURL).toString();
    await getBytes(audioSegment, requested, fetcher);
  }
  return { requested, videoSegment, audioSegment };
}
