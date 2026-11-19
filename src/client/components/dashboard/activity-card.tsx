import type { ActivityModel } from "./admin-dashboard-model";

/** STUB — replaced by the attention/activity agent. Props are the contract. */
export function ActivityCard({
  activity,
}: {
  activity: ActivityModel;
  onNavigate: (href: string) => void;
  className?: string;
}) {
  return <div data-stub="activity">{activity.groups.length} activity groups</div>;
}
