import { useRef } from "react";

/**
 * Where focus goes when a dialog closes.
 *
 * Radix returns focus to whatever was focused when the dialog opened. When
 * that element is gone or can't take focus (a menu item that unmounted, a
 * button disabled while saving), focus falls to <body> and keyboard users
 * lose their place. Return to the opener when possible, else the page's main
 * region.
 *
 * Spread the result onto a Radix Dialog / AlertDialog Content.
 */
export function useFocusReturn(handlers: {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const opener = useRef<Element | null>(null);

  return {
    onOpenAutoFocus(event: Event) {
      // Runs before Radix moves focus into the dialog, so this is the opener.
      opener.current = document.activeElement;
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: Event) {
      handlers.onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      const el = opener.current;
      opener.current = null;
      if (el instanceof HTMLElement && el.isConnected && el !== document.body) {
        el.focus({ preventScroll: true });
        if (document.activeElement === el) return;
      }
      document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
    },
  };
}

/** id of the app's <main> region: the skip link and the focus fallback target it. */
export const MAIN_CONTENT_ID = "main-content";
