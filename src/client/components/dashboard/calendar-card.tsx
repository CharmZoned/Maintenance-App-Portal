import type { DashboardCalendarModel } from "./admin-dashboard-model";

/** STUB — replaced by the calendar agent. Props are the contract. */
export function CalendarCard({
  calendar,
}: {
  calendar: DashboardCalendarModel;
  onNavigate: (href: string) => void;
  className?: string;
  /** Preview/testing only: start with these event kinds switched off. */
  defaultHiddenKinds?: import("./admin-dashboard-model").DashboardEventKind[];
  /** Preview/testing only: initially selected day (`YYYY-MM-DD`). */
  defaultSelectedDay?: string;
}) {
  return <div data-stub="calendar">{calendar.events.length} calendar events</div>;
}
