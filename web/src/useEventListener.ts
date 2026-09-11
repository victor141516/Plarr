import { onMounted, onScopeDispose } from "vue";

/** Registers a DOM listener for the lifetime of the owning Vue scope. */
export function useEventListener<TEvent extends Event>(
  target: EventTarget,
  type: string,
  listener: (event: TEvent) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  const domListener = listener as EventListener;

  onMounted(() => target.addEventListener(type, domListener, options));
  onScopeDispose(() => target.removeEventListener(type, domListener, options));
}
