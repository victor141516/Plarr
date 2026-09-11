export type AVFragmentLane = "main" | "audio";

export type AVFragmentSample = {
  lane: AVFragmentLane;
  sequence: number;
  start: number;
};

export type AVSyncDivergence = {
  sequenceDelta: number;
  ptsDelta: number;
};

// Separate adaptive audio and video playlists may have a small, stable PTS
// offset and may be downloaded at different rates. Only compare equivalent
// fragments and detect a change from the initial offset; an absolute offset is
// not evidence of drift. A new guard is created for every HLS generation.
export class AVSyncGuard {
  private readonly samples = {
    main: new Map<number, AVFragmentSample>(),
    audio: new Map<number, AVFragmentSample>(),
  };
  private readonly evaluatedSequences = new Set<number>();
  private baselineOffset: number | undefined;
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

    const offset =
      sample.lane === "main"
        ? sample.start - matching.start
        : matching.start - sample.start;
    if (this.baselineOffset === undefined) {
      this.baselineOffset = offset;
      return undefined;
    }
    const ptsDelta = Math.abs(offset - this.baselineOffset);
    const divergent = ptsDelta > 0.75;

    if (!divergent) {
      this.consecutiveDivergences = 0;
      this.baselineOffset = this.baselineOffset * 0.9 + offset * 0.1;
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
