export function manualLevelForReload(auto: boolean, manualLevel: number) {
  return !auto && Number.isInteger(manualLevel) && manualLevel >= 0
    ? manualLevel
    : undefined;
}

export function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

export function volumeGlyph(volume: number, muted: boolean) {
  if (muted || volume === 0) return "🔇";
  if (volume < 0.5) return "🔈";
  return "🔊";
}
