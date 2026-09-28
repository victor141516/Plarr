export type PlaybackFailureKind = "decode" | "network" | "other";

export function shouldRetryMP3WithAAC(input: {
  selectedCodec?: string;
  mp3CopyActive: boolean;
  alreadyRetried: boolean;
  failure: PlaybackFailureKind;
}): boolean {
  return input.failure === "decode" &&
    input.selectedCodec?.toLowerCase() === "mp3" &&
    input.mp3CopyActive &&
    !input.alreadyRetried;
}
