import { useEffect, useSyncExternalStore } from "react";

/**
 * How many dialogs or sheets are open right now. Floating messages use it to
 * move out of the way of a dialog's actions and to stay readable by screen
 * readers when a dialog opens on top of them.
 */
let openCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOpenDialogCount(): number {
  return useSyncExternalStore(subscribe, () => openCount, () => 0);
}

/** Call from a component rendered only while a dialog's content is mounted. */
export function useMarkDialogOpen() {
  useEffect(() => {
    openCount += 1;
    emit();
    return () => {
      openCount -= 1;
      emit();
    };
  }, []);
}

/** Attribute on floating messages; dialogs ignore outside clicks that land on them. */
export const FLOATING_BANNER_ATTR = "data-floating-banner";

/** True when an outside-interaction event started on a floating message. */
export function startedOnFloatingBanner(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && target.closest(`[${FLOATING_BANNER_ATTR}]`) != null;
}
