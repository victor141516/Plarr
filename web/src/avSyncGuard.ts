export type AVFragmentLane = "main" | "audio";

export type AVFragmentSample = {
  lane: AVFragmentLane;
  sequence: number;
  start: number;
  duration?: number;
};

export type AVSyncDivergence = {
  sequenceDelta: number;
  ptsDelta: number;
};

// Audio and video segment boundaries need not line up even when their media
// timelines do. Predict each boundary offset from the previous fragments'
// durations and only treat unexplained, sustained changes as drift.
export class AVSyncGuard {
  private readonly samples = {
    main: new Map<number, AVFragmentSample>(),
    audio: new Map<number, AVFragmentSample>(),
  };
  private readonly evaluatedSequences = new Set<number>();
  private expectedOffset: number | undefined;
  private previousSequence: number | undefined;
  private previousVideoDuration = 0;
  private previousAudioDuration = 0;
  private consecutiveDivergences = 0;
  private reconciled = false;

  observe(sample: AVFragmentSample): AVSyncDivergence | undefined {
    if (
      this.reconciled ||
      !Number.isFinite(sample.sequence) ||
      !Number.isFinite(sample.start)
    ) {
      return undefined;
    }

    const laneSamples = this.samples[sample.lane];
    laneSamples.set(sample.sequence, sample);
    while (laneSamples.size > 24) {
      laneSamples.delete(laneSamples.keys().next().value!);
    }
    const otherLane: AVFragmentLane =
      sample.lane === "main" ? "audio" : "main";
    const matching = this.samples[otherLane].get(sample.sequence);
    if (!matching || this.evaluatedSequences.has(sample.sequence)) {
      return undefined;
    }
    this.evaluatedSequences.add(sample.sequence);
    while (this.evaluatedSequences.size > 48) {
      this.evaluatedSequences.delete(
        this.evaluatedSequences.values().next().value!,
      );
    }

    const video = sample.lane === "main" ? sample : matching;
    const audio = sample.lane === "audio" ? sample : matching;
    const videoDuration =
      typeof video.duration === "number" && Number.isFinite(video.duration)
        ? video.duration
        : 0;
    const audioDuration =
      typeof audio.duration === "number" && Number.isFinite(audio.duration)
        ? audio.duration
        : 0;
    const offset = video.start - audio.start;
    if (
      this.expectedOffset === undefined ||
      this.previousSequence === undefined ||
      sample.sequence !== this.previousSequence + 1
    ) {
      this.expectedOffset = offset;
      this.previousSequence = sample.sequence;
      this.previousVideoDuration = videoDuration;
      this.previousAudioDuration = audioDuration;
      this.consecutiveDivergences = 0;
      return undefined;
    }
    this.expectedOffset +=
      this.previousVideoDuration - this.previousAudioDuration;
    this.previousSequence = sample.sequence;
    this.previousVideoDuration = videoDuration;
    this.previousAudioDuration = audioDuration;
    const ptsDelta = Math.abs(offset - this.expectedOffset);
    const divergent = ptsDelta > 0.75;

    if (!divergent) {
      this.consecutiveDivergences = 0;
      this.expectedOffset = this.expectedOffset * 0.9 + offset * 0.1;
      return undefined;
    }

    this.consecutiveDivergences++;
    if (this.consecutiveDivergences < 3) return undefined;
    this.reconciled = true;
    return { sequenceDelta: 0, ptsDelta };
  }
}

export class AVSyncRecoveryLimiter {
  private lastRecoveryAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly cooldownMs = 30_000) {}

  request(now = Date.now()): boolean {
    if (now - this.lastRecoveryAt < this.cooldownMs) return false;
    this.lastRecoveryAt = now;
    return true;
  }
}
