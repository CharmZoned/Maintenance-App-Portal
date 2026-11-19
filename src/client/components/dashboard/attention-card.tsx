import type { AttentionModel } from "./admin-dashboard-model";

/** STUB — replaced by the attention/activity agent. Props are the contract. */
export function AttentionCard({
  attention,
}: {
  attention: AttentionModel;
  onNavigate: (href: string) => void;
  className?: string;
}) {
  return <div data-stub="attention">{attention.items.length} attention items</div>;
}
