import { toIsoDate } from "@/lib/utils";
import type { Application, Lease, RentCharge, WorkOrder } from "@/types";

/** Source kinds for the thin read-only month calendar (WS-O). */
export type CalendarEventKind =
  | "wo_scheduled"
  | "wo_follow_up"
  | "lease_start"
  | "lease_end"
  | "rent_due"
  | "application_move_in";

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  /** Local calendar day YYYY-MM-DD */
  date: string;
  title: string;
  subtitle?: string;
  href: string;
}

export const CALENDAR_KIND_LABEL: Record<CalendarEventKind, string> = {
  wo_scheduled: "WO scheduled",
  wo_follow_up: "WO follow-up",
  lease_start: "Lease start",
  lease_end: "Lease end",
  rent_due: "Rent due",
  application_move_in: "Desired move-in",
};

/**
 * Normalize DB date or timestamptz to a local calendar day YYYY-MM-DD.
 * Date-only strings stay as-is; timestamptz uses the viewer's local timezone.
 */
export function toCalendarDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return toIsoDate(d);
}

export function isDayInMonth(day: string, year: number, monthIndex: number): boolean {
  const [y, m] = day.split("-").map(Number);
  return y === year && m === monthIndex + 1;
}

function tenantLabel(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

function placeLabel(property?: string | null, unit?: string | null): string {
  return [property, unit].filter(Boolean).join(" · ");
}

export function eventsFromWorkOrders(orders: WorkOrder[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const w of orders) {
    const place = placeLabel(w.property_name, w.unit_name);
    const scheduled = toCalendarDay(w.scheduled_at);
    if (scheduled) {
      out.push({
        id: `wo-sched-${w.id}`,
        kind: "wo_scheduled",
        date: scheduled,
        title: w.title || `Work order #${w.id}`,
        subtitle: place || undefined,
        href: `/maintenance?wo=${w.id}`,
      });
    }
    const followUp = toCalendarDay(w.next_follow_up_date);
    if (followUp) {
      out.push({
        id: `wo-fu-${w.id}`,
        kind: "wo_follow_up",
        date: followUp,
        title: w.title || `Work order #${w.id}`,
        subtitle: place ? `Follow-up · ${place}` : "Follow-up",
        href: `/maintenance?wo=${w.id}`,
      });
    }
  }
  return out;
}

export function eventsFromLeases(leases: Lease[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const l of leases) {
    const who = tenantLabel(l.tenant_first_name, l.tenant_last_name) || "Lease";
    const place = placeLabel(l.property_name, l.unit_name);
    const detailHref =
      l.primary_tenant_id != null ? `/tenants/${l.primary_tenant_id}` : `/leases?lease=${l.id}`;
    const start = toCalendarDay(l.start_date);
    if (start) {
      out.push({
        id: `lease-start-${l.id}`,
        kind: "lease_start",
        date: start,
        title: `${who} — start`,
        subtitle: place || undefined,
        href: detailHref,
      });
    }
    const end = toCalendarDay(l.end_date);
    if (end) {
      out.push({
        id: `lease-end-${l.id}`,
        kind: "lease_end",
        date: end,
        title: `${who} — end`,
        subtitle: place || undefined,
        href: detailHref,
      });
    }
  }
  return out;
}

export function eventsFromCharges(charges: RentCharge[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const c of charges) {
    const due = toCalendarDay(c.due_date);
    if (!due) continue;
    const who = tenantLabel(c.tenant_first_name, c.tenant_last_name) || "Rent";
    const place = placeLabel(c.property_name, c.unit_name);
    const period = c.period || due.slice(0, 7);
    out.push({
      id: `rent-${c.id}`,
      kind: "rent_due",
      date: due,
      title: `${who} — rent due`,
      subtitle: place || undefined,
      href: `/rent?period=${encodeURIComponent(period)}`,
    });
  }
  return out;
}

export function eventsFromApplications(apps: Application[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const a of apps) {
    const moveIn = toCalendarDay(a.desired_move_in);
    if (!moveIn) continue;
    const who = tenantLabel(a.first_name, a.last_name) || "Applicant";
    const place = placeLabel(a.property_name, a.unit_name);
    out.push({
      id: `app-movein-${a.id}`,
      kind: "application_move_in",
      date: moveIn,
      title: `${who} — desired move-in`,
      subtitle: place || undefined,
      href: `/applications?app=${a.id}`,
    });
  }
  return out;
}

export function buildCalendarEvents(input: {
  workOrders: WorkOrder[];
  leases: Lease[];
  charges: RentCharge[];
  applications?: Application[];
}): CalendarEvent[] {
  return [
    ...eventsFromWorkOrders(input.workOrders),
    ...eventsFromLeases(input.leases),
    ...eventsFromCharges(input.charges),
    ...eventsFromApplications(input.applications ?? []),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Sunday-start month grid: leading/trailing nulls for empty cells. */
export function buildMonthGrid(year: number, monthIndex: number): (number | null)[] {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const startPad = first.getDay(); // 0 = Sunday
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function groupEventsByDay(
  events: CalendarEvent[],
  year: number,
  monthIndex: number,
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    if (!isDayInMonth(ev.date, year, monthIndex)) continue;
    const list = map.get(ev.date) ?? [];
    list.push(ev);
    map.set(ev.date, list);
  }
  return map;
}
