import type { KpiTile } from "./admin-dashboard-model";

/** STUB — replaced by the intro/KPI agent. Props are the contract. */
export function KpiGrid({
  tiles,
}: {
  tiles: KpiTile[];
  onNavigate: (href: string) => void;
  className?: string;
}) {
  return <div data-stub="kpis">{tiles.length} KPI tiles</div>;
}
