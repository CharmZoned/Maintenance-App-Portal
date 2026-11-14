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
import type { Application, Lease, RentCharge, WorkOrder } from "@/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const KIND_DOT: Record<CalendarEventKind, string> = {
  wo_scheduled: "bg-cat-orange-solid",
  wo_follow_up: "bg-cat-amber-solid",
  lease_start: "bg-cat-emerald-solid",
  lease_end: "bg-cat-violet-solid",
  rent_due: "bg-cat-sky-solid",
  application_move_in: "bg-cat-teal-solid",
};

export function CalendarPage({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const today = toIsoDate(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [charges, setCharges] = useState<RentCharge[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [chargesLoading, setChargesLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(today);

  const period = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
  const { listWorkOrders, listLeases, listCharges, setError, isAdmin } = app;

  // Catalogs once (WOs / leases / optional applications) — not on month flip.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setCatalogLoading(true);
        const appsPromise: Promise<Application[]> = isAdmin
          ? data.listApplications("all").catch(() => [] as Application[])
          : Promise.resolve([] as Application[]);
        const [wos, ls, apps] = await Promise.all([listWorkOrders(), listLeases(), appsPromise]);
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
  }, [listWorkOrders, listLeases, setError, isAdmin]);

  // Rent charges are period-scoped — refresh when the viewed month changes.
  useEffect(() => {
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
  }, [listCharges, setError, period]);

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

  const grid = useMemo(
    () => buildMonthGrid(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const dayEvents = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const monthCount = [...byDay.values()].reduce((n, list) => n + list.length, 0);
  const loading = catalogLoading && workOrders.length === 0 && leases.length === 0;

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    setSelectedDay(null);
  }

  function dayKey(day: number): string {
    return toIsoDate(new Date(cursor.year, cursor.month, day));
  }

  return (
    <PageShell
      title="Calendar"
      meta={`${monthCount} dated item${monthCount === 1 ? "" : "s"} · read-only${chargesLoading ? " · updating rent…" : ""}`}
      actions={
        <div className="inline-flex items-center rounded-full bg-muted p-[0.1875rem]">
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setSelectedDay(today);
            }}
            className="min-w-[9.5rem] px-2 text-center text-sm font-medium tabular-nums"
          >
            {monthLabel}
          </button>
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">
        Existing dates only — work-order schedule and follow-ups, lease start/end, rent due dates
        {isAdmin ? ", and application desired move-in" : ""}. Select a day, then open an item in the
        list.
      </p>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.keys(CALENDAR_KIND_LABEL) as CalendarEventKind[])
          .filter((k) => isAdmin || k !== "application_move_in")
          .map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", KIND_DOT[kind])} />
              {CALENDAR_KIND_LABEL[kind]}
            </span>
          ))}
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading calendar…</Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="overflow-hidden p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {grid.map((day, idx) => {
                if (day == null) {
                  return <div key={`pad-${idx}`} className="min-h-[4.5rem] rounded-md bg-transparent" />;
                }
                const key = dayKey(day);
                const list = byDay.get(key) ?? [];
                const isToday = key === today;
                const isSelected = key === selectedDay;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(key)}
                    className={cn(
                      "flex min-h-[4.5rem] flex-col items-stretch rounded-md border px-1.5 py-1 text-left transition-colors",
                      isSelected
                        ? "border-foreground/25 bg-muted"
                        : "border-transparent hover:bg-muted/60",
                      isToday && !isSelected && "border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                        isToday && "bg-foreground text-background",
                      )}
                    >
                      {day}
                    </span>
                    <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                      {list.slice(0, 3).map((ev) => (
                        <span
                          key={ev.id}
                          className="truncate rounded px-1 py-0.5 text-[10px] leading-tight text-foreground/90"
                          title={ev.title}
                        >
                          <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", KIND_DOT[ev.kind])} />
                          {ev.title}
                        </span>
                      ))}
                      {list.length > 3 && (
                        <span className="px-1 text-[10px] text-muted-foreground">+{list.length - 3} more</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="flex min-h-[16rem] flex-col p-4">
            <h2 className="text-sm font-semibold">
              {selectedDay
                ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })
                : "Select a day"}
            </h2>
            <div className="mt-3 flex-1 space-y-2 overflow-auto">
              {!selectedDay || dayEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <CalendarDays className="size-6 text-faint" aria-hidden />
                  <p className="text-sm text-muted-foreground">No dated items this day.</p>
                </div>
              ) : (
                dayEvents.map((ev) => <EventRow key={ev.id} event={ev} onOpen={navigate} />)
              )}
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: (to: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(event.href)}
      className="flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-muted"
    >
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", KIND_DOT[event.kind])} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">
          {CALENDAR_KIND_LABEL[event.kind]}
        </span>
        <span className="block truncate text-sm font-medium">{event.title}</span>
        {event.subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{event.subtitle}</span>
        )}
      </span>
    </button>
  );
}
