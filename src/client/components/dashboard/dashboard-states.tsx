/** STUBS — replaced by the intro/KPI agent. Props are the contract. */

/** Data-shaped skeletons (Figma "Loading"): six KPI tiles, then card placeholders. */
export function DashboardLoading() {
  return <div data-stub="loading" aria-busy="true">Loading…</div>;
}

/** No properties yet (Figma "Empty"): "Start your portfolio" + "Getting started". */
export function DashboardEmpty(_props: {
  statsLines: string[];
  contactLines: string[];
  onAddProperty: () => void;
}) {
  return <div data-stub="empty">Empty</div>;
}

/** Load failed (Figma "Error"): "Dashboard unavailable" + Retry + last attempt line. */
export function DashboardError(_props: {
  message: string;
  lastAttemptLine: string;
  onRetry: () => void;
}) {
  return <div data-stub="error">Error</div>;
}
