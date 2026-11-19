/**
 * Date wording for the admin workspace. The design always pairs a relative
 * date with an absolute one ("Tomorrow · Tue 17 Nov 2026"), in day-month-year
 * order with short English names. All inputs are local calendar days
 * (`YYYY-MM-DD`) so nothing here shifts across a timezone boundary.
 */

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Parse `YYYY-MM-DD` as a LOCAL date (never `new Date(iso)`, which is UTC). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Local `YYYY-MM-DD` for a Date. */
export function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to` (positive = `to` is later). */
export function dayDiff(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function addDays(day: string, days: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + days);
  return toDay(d);
}

/** "Tue 17 Nov 2026" */
export function formatDayShort(day: string): string {
  const d = parseDay(day);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "17 Nov 2026" */
export function formatDayNoWeekday(day: string): string {
  const d = parseDay(day);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Monday 16 November 2026" */
export function formatDayLong(day: string): string {
  const d = parseDay(day);
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** "November 2026" for a zero-based month. */
export function formatMonthYear(year: number, monthIndex: number): string {
  return `${MONTHS_LONG[monthIndex]} ${year}`;
}

/**
 * "Today", "Tomorrow", "Yesterday", "In 4 days", "3 days ago" — `day`
 * relative to `today`.
 */
export function relativeDayLabel(day: string, today: string): string {
  const diff = dayDiff(today, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

/** "Tomorrow · Tue 17 Nov 2026" — the selected-day heading in the calendar. */
export function relativeDayHeading(day: string, today: string): string {
  return `${relativeDayLabel(day, today)} · ${formatDayShort(day)}`;
}

/** "Good morning" / "Good afternoon" / "Good evening" by local hour. */
export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
