import { computed, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { isHDRVideo, resolveDeliveryColor, type ColorPreference } from "./mediaCapabilities";
import { originalQualityDescription } from "./originalQuality";
import { buildPlaybackDiagnostics, diagnosticsText } from "./playbackDiagnostics";
import { playerTitle } from "./playerPresentation";
import type {
  PlaybackMode,
  PlayerProbe,
  PlayerTrack,
  QualityLevel,
  PlaybackTranscodeDiagnostics,
} from "./playerTypes";

interface PlaybackViewModelOptions {
  probe: ShallowRef<PlayerProbe | null>;
  audio: Ref<number | undefined>;
  selectedAudioTrack: ComputedRef<PlayerTrack | undefined>;
  colorPreference: ShallowRef<ColorPreference>;
  hdrDeliverySupported: ShallowRef<boolean>;
  params: URLSearchParams;
  mediaPath: string;
  diagnosticMode: Ref<PlaybackMode>;
  quality: Ref<string>;
  activeLevelIndex: Ref<number>;
  availableLevels: Ref<QualityLevel[]>;
  bandwidthEstimate: Ref<number>;
  bufferedSeconds: Ref<number>;
  diagnosticsDecision: Ref<string>;
  transcodeDiagnostics: Ref<PlaybackTranscodeDiagnostics | null>;
  transcodeDiagnosticsError: Ref<string>;
  playbackIssue: Ref<string>;
  reactiveAVSyncReconciliations: Ref<number>;
  isAutomatic: () => boolean;
  canDirect: () => boolean;
  canRemux: () => boolean;
  canOriginalHLS: () => boolean;
}

export function usePlaybackViewModel(options: PlaybackViewModelOptions) {
  const sourceHDR = computed(() => isHDRVideo(options.probe.value?.video));
  const deliveryColor = computed(() =>
    resolveDeliveryColor(
      options.colorPreference.value,
      sourceHDR.value,
      options.hdrDeliverySupported.value,
    ),
  );
  const originalAvailable = computed(
    () =>
      (!sourceHDR.value || deliveryColor.value !== "sdr") &&
      (options.canDirect() || options.canRemux()),
  );
  const originalUnavailableReason = computed(() =>
    deliveryColor.value === "sdr" && sourceHDR.value
      ? "HDR is disabled"
      : "Unsupported by this browser",
  );
  const originalDescription = computed(() =>
    originalQualityDescription(
      options.probe.value,
      options.audio.value,
      options.canDirect() && !options.canOriginalHLS(),
      options.canOriginalHLS(),
    ),
  );
  const displayTitle = computed(() =>
    playerTitle(
      options.params,
      options.probe.value?.format?.tags?.title,
      options.mediaPath,
    ),
  );
  const diagnosticSections = computed(() =>
    buildPlaybackDiagnostics({
      probe: options.probe.value,
      selectedAudio: options.selectedAudioTrack.value,
      mode: options.diagnosticMode.value,
      automatic: options.isAutomatic(),
      quality: options.quality.value,
      activeLevel:
        options.activeLevelIndex.value >= 0
          ? options.availableLevels.value[options.activeLevelIndex.value]
          : undefined,
      bandwidthEstimate: options.bandwidthEstimate.value,
      bufferSeconds: options.bufferedSeconds.value,
      decision: options.diagnosticsDecision.value,
      deliveryColor: deliveryColor.value,
      sourceHDR: sourceHDR.value,
      transcodeDiagnostics: options.transcodeDiagnostics.value,
      transcodeDiagnosticsError: options.transcodeDiagnosticsError.value,
      playbackIssue: options.playbackIssue.value,
      reactiveAVSyncReconciliations:
        options.reactiveAVSyncReconciliations.value,
    }),
  );
  const diagnosticCopyText = computed(() =>
    diagnosticsText(diagnosticSections.value),
  );

  return {
    deliveryColor,
    diagnosticCopyText,
    diagnosticSections,
    displayTitle,
    originalAvailable,
    originalDescription,
    originalUnavailableReason,
    sourceHDR,
  };
}
