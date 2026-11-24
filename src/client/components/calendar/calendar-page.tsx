import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import * as data from "@/lib/data";
import { useApp } from "@/context";
import { cn, toIsoDate } from "@/lib/utils";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CALENDAR_KIND_LABEL,
  buildCalendarEvents,
  buildMonthGrid,
  groupEventsByDay,
  type CalendarEvent,
  type CalendarEventKind,
} from "@/lib/calendar-events";
import { formatRequestDay } from "@/lib/request-status";
import { formatDayLong, formatMonthYear } from "@/lib/admin-dates";
import { withFrom } from "@/lib/back-link";
import { viewerRoleFrom } from "@/components/maintenance/request/role-visibility";
import type { Application, Lease, RentCharge, WorkOrder } from "@/types";

const WEEKDAYS = [
  { short: "Sun", long: "Sunday" },
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
];

const KIND_DOT: Record<CalendarEventKind, string> = {
  wo_scheduled: "bg-cat-orange-solid",
  wo_follow_up: "bg-cat-amber-solid",
  lease_start: "bg-cat-emerald-solid",
  lease_end: "bg-cat-violet-solid",
  rent_due: "bg-cat-sky-solid",
  application_move_in: "bg-cat-teal-solid",
};

const WORK_KINDS: readonly CalendarEventKind[] = ["wo_scheduled", "wo_follow_up"];

/** `?month=YYYY-MM&day=YYYY-MM-DD`, so Back from a request returns to the same view. */
function readCalendarQuery(search: string, today: string): { year: number; month: number; day: string | null } {
  const p = new URLSearchParams(search);
  const monthParam = p.get("month");
  const dayParam = p.get("day");
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;
  const monthKey = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : (day ?? today).slice(0, 7);
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month: month - 1, day: dayParam === null && !monthParam ? today : day };
}

function calendarSearch(year: number, month: number, day: string | null, today: string): string {
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  // The default view (this month, today selected) is the bare /calendar.
  if (day === today && monthKey === today.slice(0, 7)) return "";
  const p = new URLSearchParams();
  p.set("month", monthKey);
  if (day) p.set("day", day);
  return `?${p.toString()}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function CalendarPage({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const today = toIsoDate(new Date());
  // A technician's calendar is their visits and follow-ups only.
  const workOnly = viewerRoleFrom(app) === "maintenance";
  const [initial] = useState(() => readCalendarQuery(window.location.search, today));
  const [cursor, setCursor] = useState({ year: initial.year, month: initial.month });
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [charges, setCharges] = useState<RentCharge[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [chargesLoading, setChargesLoading] = useState(!workOnly);
  const [selectedDay, setSelectedDay] = useState<string | null>(initial.day);

  const period = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
  const { listWorkOrders, listLeases, listCharges, setError, isAdmin } = app;

  // Keep the month and day in the URL (replace) without a router round-trip.
  useEffect(() => {
    const next = calendarSearch(cursor.year, cursor.month, selectedDay, today);
    if (next !== window.location.search) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}`);
    }
  }, [cursor.year, cursor.month, selectedDay, today]);

  // Catalogs once (requests / leases / optional applications) — not on month flip.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setCatalogLoading(true);
        const appsPromise: Promise<Application[]> = isAdmin
          ? data.listApplications("all").catch(() => [] as Application[])
          : Promise.resolve([] as Application[]);
        const leasesPromise: Promise<Lease[]> = workOnly ? Promise.resolve([]) : listLeases();
        const [wos, ls, apps] = await Promise.all([listWorkOrders(), leasesPromise, appsPromise]);
        if (cancelled) return;
        setWorkOrders(wos);
        setLeases(ls);
        setApplications(apps);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listWorkOrders, listLeases, setError, isAdmin, workOnly]);

  // Rent charges are period-scoped — refresh when the viewed month changes.
  useEffect(() => {
    if (workOnly) return;
    let cancelled = false;
    (async () => {
      try {
        setChargesLoading(true);
        const ch = await listCharges(period);
        if (cancelled) return;
        setCharges(ch);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setChargesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listCharges, setError, period, workOnly]);

  const events = useMemo(
    () =>
      buildCalendarEvents({
        workOrders,
        leases,
        charges,
        applications: isAdmin ? applications : [],
      }),
    [workOrders, leases, charges, applications, isAdmin],
  );

  const byDay = useMemo(
    () => groupEventsByDay(events, cursor.year, cursor.month),
    [events, cursor.year, cursor.month],
  );

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor.year, cursor.month]);

  const monthLabel = formatMonthYear(cursor.year, cursor.month);
  const dayEvents = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  let monthCount = 0;
  for (const list of byDay.values()) monthCount += list.length;
  const loading = catalogLoading;
  const kinds = (Object.keys(CALENDAR_KIND_LABEL) as CalendarEventKind[]).filter((k) =>
    workOnly ? WORK_KINDS.includes(k) : isAdmin || k !== "application_move_in",
  );

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    setSelectedDay(null);
  }

  function goToday() {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDay(today);
  }

  function dayKey(day: number): string {
    return toIsoDate(new Date(cursor.year, cursor.month, day));
  }

  /** Request links carry ?from= so the request page's back link returns here. */
  function openEvent(href: string) {
    navigate(href.startsWith("/maintenance/") ? withFrom(href) : href);
  }

  const isCurrentMonth = period === today.slice(0, 7);
  const meta = loading
    ? undefined
    : [
        plural(monthCount, workOnly ? "visit or follow-up" : "dated item", workOnly ? "visits and follow-ups" : undefined),
        chargesLoading ? "updating rent…" : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <PageShell title="Calendar" meta={meta}>
      <p className="text-sm text-muted-foreground">
        {workOnly
          ? "Your visits and follow-ups. Select a day, then open a job."
          : `Visits, follow-ups, lease start and end, rent due${isAdmin ? ", and desired move-in dates" : ""}. Select a day, then open an item.`}
      </p>

      {/* Month switcher: its own row, so the page title never truncates on a phone. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-11 md:size-8" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <h2 className="min-w-[8.5rem] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
            {monthLabel}
          </h2>
          <Button variant="ghost" size="icon" className="size-11 md:size-8" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Button
          variant="secondary"
          className="h-11 md:h-8"
          onClick={goToday}
          disabled={isCurrentMonth && selectedDay === today}
        >
          Today
        </Button>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Key">
        {kinds.map((kind) => (
          <li key={kind} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", KIND_DOT[kind])} aria-hidden />
            {CALENDAR_KIND_LABEL[kind]}
          </li>
        ))}
      </ul>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading calendar…</Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="overflow-hidden p-2 sm:p-4">
            <div
              className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              aria-hidden
            >
              {WEEKDAYS.map((d) => (
                <div key={d.short} className="py-1">
                  {d.short}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {grid.map((day, idx) => {
                if (day == null) {
                  return <div key={`pad-${idx}`} className="min-h-12 rounded-md sm:min-h-[4.5rem]" aria-hidden />;
                }
                const key = dayKey(day);
                const list = byDay.get(key) ?? [];
                const isToday = key === today;
                const isSelected = key === selectedDay;
                const missed = list.some((ev) => ev.missed);
                // Full date in the name ("Wednesday 25 November 2026"), not just "25".
                const name = [
                  isToday ? "Today" : null,
                  formatDayLong(key),
                  list.length ? plural(list.length, "item") : "nothing scheduled",
                  missed ? "includes a missed visit" : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(key)}
                    aria-label={name}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    className={cn(
                      "flex min-h-12 flex-col items-center rounded-md border px-0.5 py-1 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:min-h-[4.5rem] sm:items-stretch sm:px-1.5",
                      isSelected ? "border-foreground/25 bg-muted" : "border-transparent hover:bg-muted/60",
                      isToday && !isSelected && "border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums sm:mb-1",
                        isToday && "bg-foreground text-background",
                      )}
                      aria-hidden
                    >
                      {day}
                    </span>
                    {/* Phone: dots only; the day's list below has the words. */}
                    <span className="mt-1 flex flex-wrap justify-center gap-0.5 sm:hidden" aria-hidden>
                      {list.slice(0, 3).map((ev) => (
                        <span key={ev.id} className={cn("h-1.5 w-1.5 rounded-full", KIND_DOT[ev.kind])} />
                      ))}
                    </span>
                    <span className="hidden flex-1 flex-col gap-0.5 overflow-hidden sm:flex" aria-hidden>
                      {list.slice(0, 3).map((ev) => (
                        <span
                          key={ev.id}
                          className={cn(
                            "truncate rounded px-1 py-0.5 text-[10px] leading-tight",
                            ev.missed ? "font-medium text-warning" : "text-foreground/90",
                          )}
                          title={ev.title}
                        >
                          <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", KIND_DOT[ev.kind])} />
                          {ev.time ? `${ev.time} ` : ""}
                          {ev.title}
                        </span>
                      ))}
                      {list.length > 3 && (
                        <span className="px-1 text-[10px] text-muted-foreground">+{list.length - 3} more</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="flex min-h-[16rem] flex-col p-4">
            <h2 className="text-sm font-semibold">
              {selectedDay
                ? selectedDay === today
                  ? `Today · ${formatRequestDay(new Date(`${selectedDay}T00:00:00`))}`
                  : formatRequestDay(new Date(`${selectedDay}T00:00:00`))
                : "Select a day"}
            </h2>
            <div className="mt-3 flex-1 space-y-2 overflow-auto">
              {!selectedDay || dayEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <CalendarDays className="size-6 text-faint" aria-hidden />
                  <p className="text-sm text-muted-foreground">
                    {selectedDay ? "Nothing scheduled this day." : "Pick a day to see what’s on."}
                  </p>
                </div>
              ) : (
                dayEvents.map((ev) => <EventRow key={ev.id} event={ev} onOpen={openEvent} />)
              )}
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: (to: string) => void }) {
  const kind = [CALENDAR_KIND_LABEL[event.kind], event.time].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={() => onOpen(event.href)}
      className="flex min-h-11 w-full items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left outline-none transition-colors hover:border-border hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", KIND_DOT[event.kind])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-xs font-medium", event.missed ? "text-warning" : "text-muted-foreground")}>
          {kind}
          {event.missed ? " (missed)" : ""}
        </span>
        <span className="block truncate text-sm font-medium">{event.title}</span>
        {event.subtitle && <span className="block truncate text-xs text-muted-foreground">{event.subtitle}</span>}
      </span>
    </button>
  );
}
