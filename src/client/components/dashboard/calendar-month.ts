import { addDays, formatDayLong, parseDay, toDay } from "@/lib/admin-dates";
import type { DashboardCalendarEvent, DashboardEventKind } from "./admin-dashboard-model";

/**
 * Pure month-grid and filter helpers for the Dashboard calendar card. Days are
 * local `YYYY-MM-DD` strings throughout, so nothing shifts across timezones.
 */

/** Every event kind, in the order the filter chips are drawn. */
export const EVENT_KINDS: readonly DashboardEventKind[] = [
  "visit",
  "follow_up",
  "rent_due",
  "lease_start",
  "lease_end",
  "move_in",
];

export interface CalendarMonth {
  year: number;
  /** Zero-based: 0 = January. */
  monthIndex: number;
}

/** The month a day falls in. */
export function monthOfDay(day: string): CalendarMonth {
  const d = parseDay(day);
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

/** `delta` months later (negative = earlier), rolling over years. */
export function shiftMonth(month: CalendarMonth, delta: number): CalendarMonth {
  const d = new Date(month.year, month.monthIndex + delta, 1);
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

export function isDayInMonth(day: string, month: CalendarMonth): boolean {
  const m = monthOfDay(day);
  return m.year === month.year && m.monthIndex === month.monthIndex;
}

/** First day of the month as `YYYY-MM-DD`. */
export function firstDayOfMonth(month: CalendarMonth): string {
  return toDay(new Date(month.year, month.monthIndex, 1));
}

/**
 * The month as rows of seven cells, weeks starting on Monday. Cells outside
 * the month are `null` (the design leaves them blank). Only as many weeks as
 * the month needs: four to six.
 */
export function monthWeeks(month: CalendarMonth): (string | null)[][] {
  const first = new Date(month.year, month.monthIndex, 1);
  const daysInMonth = new Date(month.year, month.monthIndex + 1, 0).getDate();
  // getDay(): 0 = Sunday. Monday-first offset: Mon 0 … Sun 6.
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(toDay(new Date(month.year, month.monthIndex, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * The kinds whose filter chip is pressed. No hidden kinds means no filter is
 * applied, so no chip is pressed and every kind shows.
 */
export function activeFilterKinds(hiddenKinds: readonly DashboardEventKind[]): DashboardEventKind[] {
  if (hiddenKinds.length === 0) return [];
  return EVENT_KINDS.filter((kind) => !hiddenKinds.includes(kind));
}

/**
 * Press or release one filter chip and return the new hidden kinds.
 *
 * The chips are "show only" filters, as drawn: with none pressed everything
 * shows; pressing chips narrows the calendar to those kinds. Releasing the
 * last pressed chip clears the filter rather than hiding everything.
 */
export function toggleKindFilter(
  hiddenKinds: readonly DashboardEventKind[],
  kind: DashboardEventKind,
): DashboardEventKind[] {
  // No filter yet: show only this kind.
  if (hiddenKinds.length === 0) return EVENT_KINDS.filter((k) => k !== kind);
  // Not showing: add it to the kinds shown.
  if (hiddenKinds.includes(kind)) return EVENT_KINDS.filter((k) => k !== kind && hiddenKinds.includes(k));
  // Showing: take it out, unless it is the last one.
  const next = EVENT_KINDS.filter((k) => k === kind || hiddenKinds.includes(k));
  return next.length === EVENT_KINDS.length ? [] : next;
}

/** Events grouped by day, leaving out hidden kinds. Input order is kept. */
export function groupEventsByDay(
  events: readonly DashboardCalendarEvent[],
  hiddenKinds: readonly DashboardEventKind[] = [],
): Map<string, DashboardCalendarEvent[]> {
  const byDay = new Map<string, DashboardCalendarEvent[]>();
  for (const event of events) {
    if (hiddenKinds.includes(event.kind)) continue;
    const list = byDay.get(event.day);
    if (list) list.push(event);
    else byDay.set(event.day, [event]);
  }
  return byDay;
}

/** How many grouped events fall inside the month. */
export function countEventsInMonth(
  byDay: ReadonlyMap<string, readonly DashboardCalendarEvent[]>,
  month: CalendarMonth,
): number {
  let count = 0;
  for (const [day, list] of byDay) {
    if (isDayInMonth(day, month)) count += list.length;
  }
  return count;
}

/** "3 events", "1 event", "No events". */
export function eventCountLabel(count: number): string {
  if (count === 0) return "No events";
  return count === 1 ? "1 event" : `${count} events`;
}

/** Accessible name of a day button: "Tuesday 17 November 2026, 1 event". */
export function dayButtonLabel(day: string, eventCount: number): string {
  return `${formatDayLong(day)}, ${eventCountLabel(eventCount).toLowerCase()}`;
}

/**
 * Where a grid key moves the day cursor, or `null` when the key is not a grid
 * key. Arrows step a day or a week, Home/End go to the Monday/Sunday of the
 * week, Page Up/Down step a month (clamped to the month's last day).
 */
export function dayForKey(day: string, key: string): string | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(day, -1);
    case "ArrowRight":
      return addDays(day, 1);
    case "ArrowUp":
      return addDays(day, -7);
    case "ArrowDown":
      return addDays(day, 7);
    case "Home":
      return addDays(day, -((parseDay(day).getDay() + 6) % 7));
    case "End":
      return addDays(day, 6 - ((parseDay(day).getDay() + 6) % 7));
    case "PageUp":
    case "PageDown": {
      const d = parseDay(day);
      const target = shiftMonth(monthOfDay(day), key === "PageUp" ? -1 : 1);
      const last = new Date(target.year, target.monthIndex + 1, 0).getDate();
      return toDay(new Date(target.year, target.monthIndex, Math.min(d.getDate(), last)));
    }
    default:
      return null;
  }
}
