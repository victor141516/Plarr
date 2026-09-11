import type Hls from "hls.js";
import { computed, onBeforeUnmount, ref, type Ref, type ShallowRef } from "vue";
import { chooseTrack, type PlarrEventType } from "./protocol";
import type { PlaybackMode, PlayerProbe, PlayerTrack } from "./playerTypes";

interface PlayerTracksOptions {
  probe: ShallowRef<PlayerProbe | null>;
  video: Ref<HTMLVideoElement | null>;
  base: string;
  params: URLSearchParams;
  current: Ref<number>;
  menu: Ref<string>;
  getMode: () => PlaybackMode;
  getHls: () => Hls | null;
  getAutomatic: () => boolean;
  loadOriginalAt: (target: number, resume: boolean, automatic: boolean) => void;
  emit: (type: PlarrEventType, payload?: Record<string, unknown>) => void;
}

export function usePlayerTracks(options: PlayerTracksOptions) {
  const audio = ref<number>();
  const subtitle = ref<number>();
  const subtitlesEnabled = ref(false);
  let subtitleTimer: number | undefined;

  const audioTracks = computed<PlayerTrack[]>(
    () =>
      options.probe.value?.audio?.map((track: PlayerTrack) => ({
        ...track,
        language: track.tags?.language || "und",
        name:
          track.tags?.title ||
          track.tags?.language?.toUpperCase() ||
          `Audio ${track.index}`,
      })) || [],
  );
  const subtitleTracks = computed<PlayerTrack[]>(
    () =>
      options.probe.value?.subtitles?.map((track: PlayerTrack) => ({
        ...track,
        language: track.tags?.language || "und",
        name:
          track.tags?.title ||
          track.tags?.language?.toUpperCase() ||
          `Subtitle ${track.index}`,
      })) || [],
  );
  const selectedAudioTrack = computed(
    () =>
      audioTracks.value.find((track) => track.index === audio.value) ||
      audioTracks.value[0],
  );

  function initialize() {
    audio.value = chooseTrack(
      audioTracks.value,
      options.params.get("audio") || undefined,
      options.params.get("audioTitle") || undefined,
    )?.index;
    subtitle.value = chooseTrack(
      subtitleTracks.value,
      options.params.get("subtitles") || undefined,
      options.params.get("subtitleTitle") || undefined,
    )?.index;
    subtitlesEnabled.value = options.params.get("subtitlesEnabled") === "true";
  }

  function applyNativeTracks() {
    const list = (
      options.video.value as
        | (HTMLVideoElement & { audioTracks?: ArrayLike<{ enabled: boolean }> })
        | null
    )?.audioTracks;
    if (!list) return;
    for (let index = 0; index < list.length; index++) {
      const track = list[index];
      if (track) track.enabled = index === audio.value;
    }
  }

  function applySubtitle() {
    const element = options.video.value;
    if (!element) return;
    for (const old of [...element.querySelectorAll("track")]) old.remove();
    if (subtitle.value === undefined) return;
    const node = document.createElement("track");
    const selected = subtitleTracks.value.find(
      (track) => track.index === subtitle.value,
    );
    node.kind = "subtitles";
    node.label = selected?.name || "Subtitles";
    node.srclang = selected?.language || "und";
    node.src = `${options.base}/subtitles/${subtitle.value}.vtt`;
    node.default = subtitlesEnabled.value;
    element.appendChild(node);
    if (subtitleTimer) window.clearTimeout(subtitleTimer);
    subtitleTimer = window.setTimeout(() => {
      subtitleTimer = undefined;
      for (const track of [...element.textTracks]) {
        track.mode = subtitlesEnabled.value ? "showing" : "disabled";
      }
    }, 300);
  }

  function selectAudio(index: number) {
    audio.value = index;
    const mode = options.getMode();
    const hls = options.getHls();
    if (mode === "original-hls" || mode === "original-remux") {
      const element = options.video.value;
      if (element) {
        options.loadOriginalAt(
          options.current.value,
          !element.paused,
          options.getAutomatic(),
        );
      }
    } else if (hls) {
      const position = hls.audioTracks.findIndex(
        (track) =>
          track.id === index ||
          (track as typeof track & { index?: number }).index === index,
      );
      hls.audioTrack =
        position >= 0
          ? position
          : audioTracks.value.findIndex((track) => track.index === index);
    } else {
      applyNativeTracks();
    }
    const track = audioTracks.value.find((item) => item.index === index);
    options.emit("audio-track-changed", {
      audioLanguage: track?.language,
      audioTitle: track?.name,
    });
    options.menu.value = "";
  }

  function selectSubtitle(index?: number) {
    subtitle.value = index;
    subtitlesEnabled.value = index !== undefined;
    applySubtitle();
    const track = subtitleTracks.value.find((item) => item.index === index);
    options.emit(
      index === undefined ? "subtitles-disabled" : "subtitle-track-changed",
      {
        subtitleLanguage: track?.language,
        subtitleTitle: track?.name,
        subtitlesEnabled: subtitlesEnabled.value,
      },
    );
    options.menu.value = "";
  }

  onBeforeUnmount(() => {
    if (subtitleTimer) window.clearTimeout(subtitleTimer);
  });

  return {
    applyNativeTracks,
    applySubtitle,
    audio,
    audioTracks,
    initialize,
    selectedAudioTrack,
    selectAudio,
    selectSubtitle,
    subtitle,
    subtitleTracks,
    subtitlesEnabled,
  };
}
