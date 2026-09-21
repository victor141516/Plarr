import { onBeforeUnmount, onMounted, type Ref } from "vue";

// Minimal webOS playback smoke test: OK/play/pause and Back. Desktop keyboard
// handling and playback engine selection remain unchanged outside ?tv=1.
export function useTelevisionRemote(options: {
  enabled: boolean;
  video: Ref<HTMLVideoElement | null>;
  menu: Ref<string>;
  diagnosticsOpen: Ref<boolean>;
  close: () => void;
  toggle: () => void;
}) {
  function keydown(event: KeyboardEvent) {
    const back =
      event.keyCode === 461 ||
      event.key === "Escape" ||
      event.key === "BrowserBack";
    const enter = event.key === "Enter" || event.keyCode === 13;
    const play = event.keyCode === 415 || event.key === "MediaPlay";
    const pause = event.keyCode === 19 || event.key === "MediaPause";
    const toggle = event.key === "MediaPlayPause";
    if (!back && !enter && !play && !pause && !toggle) return;
    // Preserve activation of focused buttons, menus and fields.
    const active = document.activeElement;
    if (
      enter &&
      active?.matches("button,a,input,select,textarea,[role=button]")
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (back) {
      if (options.diagnosticsOpen.value) options.diagnosticsOpen.value = false;
      else if (options.menu.value) options.menu.value = "";
      else {
        options.video.value?.pause();
        options.close();
      }
    } else if (
      enter ||
      toggle ||
      (play && options.video.value?.paused) ||
      (pause && !options.video.value?.paused)
    ) {
      options.toggle();
    }
  }
  onMounted(() => {
    if (options.enabled) window.addEventListener("keydown", keydown, true);
  });
  onBeforeUnmount(() => window.removeEventListener("keydown", keydown, true));
}
