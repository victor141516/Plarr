export type PlayerCommand =
  "toggle-playback" | "seek-backward" | "seek-forward" | "toggle-fullscreen";

type KeyboardInput = {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  typing?: boolean;
};

export function playerCommand(input: KeyboardInput): PlayerCommand | undefined {
  if (input.typing || input.altKey || input.ctrlKey || input.metaKey) return;
  if ((input.code === "Space" || input.key === " ") && !input.repeat)
    return "toggle-playback";
  if (input.key === "ArrowLeft") return "seek-backward";
  if (input.key === "ArrowRight") return "seek-forward";
  if (input.key.toLowerCase() === "f" && !input.repeat)
    return "toggle-fullscreen";
}
