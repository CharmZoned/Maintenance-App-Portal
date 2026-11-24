import { useCallback } from "react";
import { useApp } from "../context";
import { FloatingBanner } from "./patterns/floating-banner";

/** Ordinary in-app notice (green) — distinct from ErrorBanner (red). Phase 6 push deferred. */
export function NoticeBanner() {
  const { notice, setNotice } = useApp();
  const dismiss = useCallback(() => setNotice(null), [setNotice]);
  if (!notice) return null;
  return <FloatingBanner tone="success" message={notice} onDismiss={dismiss} />;
}
