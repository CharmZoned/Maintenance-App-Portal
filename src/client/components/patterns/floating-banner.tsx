import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FloatingBannerTone = "success" | "error";

/** How long a success message stays. Errors stay until dismissed. */
export const SUCCESS_DISMISS_MS = 4000;

/**
 * The one floating message (toast) for the portal.
 *
 * Rendered into `document.body` above dialog overlays (z-60, pointer events
 * on), so a save that fails inside a dialog or bottom sheet is never drawn
 * behind it. Mounting after the dialog opened also keeps it out of the
 * dialog's aria-hidden sweep, so screen readers announce it.
 *
 * Errors do not auto-dismiss: a message that vanishes in four seconds is easy
 * to miss on a phone in the field.
 */
export function FloatingBanner({
  tone,
  message,
  onDismiss,
  autoDismissMs,
  placement = "default",
}: {
  tone: FloatingBannerTone;
  message: ReactNode;
  onDismiss: () => void;
  /** Override the auto-dismiss (0 keeps it). Defaults: success 4s, error never. */
  autoDismissMs?: number;
  /** "above-bar": clear a sticky phone action bar (request page). */
  placement?: "default" | "above-bar";
}) {
  const ms = autoDismissMs ?? (tone === "success" ? SUCCESS_DISMISS_MS : 0);

  useEffect(() => {
    if (!ms) return;
    const t = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(t);
  }, [message, ms, onDismiss]);

  if (typeof document === "undefined") return null;

  // With a dialog or sheet open, its actions sit at the bottom: show the
  // message at the top so it never covers Save / Cancel.
  const overDialog =
    document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !=
    null;

  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return createPortal(
    <div
      role={tone === "success" ? "status" : "alert"}
      data-testid="floating-banner"
      style={{ pointerEvents: "auto" }}
      className={cn(
        "fixed inset-x-4 z-[60] mx-auto flex max-w-[520px] items-center gap-3 rounded-md px-4 py-3 text-sm leading-5 shadow-float",
        overDialog
          ? "top-[calc(var(--staging-ribbon-offset,0px)+1rem)]"
          : placement === "above-bar"
            ? "bottom-24 md:bottom-6"
            : "bottom-4",
        tone === "success" ? "bg-success-tint text-success" : "bg-destructive-tint text-destructive",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-sm opacity-80 outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
