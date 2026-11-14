import { useEffect } from "react";
import { useApp } from "../context";
import { X } from "lucide-react";

/** Ordinary in-app notice (green) — distinct from ErrorBanner (red). Phase 6 push deferred. */
export function NoticeBanner() {
  const { notice, setNotice } = useApp();

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice, setNotice]);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(90vw,520px)] -translate-x-1/2 items-start gap-3 rounded-md bg-success-tint px-4 py-3 text-sm text-success shadow-float"
    >
      <span className="flex-1">{notice}</span>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="opacity-80 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
