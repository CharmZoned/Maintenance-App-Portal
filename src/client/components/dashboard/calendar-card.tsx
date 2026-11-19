import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatDayShort,
  formatMonthYear,
  relativeDayHeading,
  relativeDayLabel,
} from "@/lib/admin-dates";
import { cn } from "@/lib/utils";
import type {
  AdminIconName,
  DashboardCalendarEvent,
  DashboardCalendarModel,
  DashboardEventKind,
} from "./admin-dashboard-model";
import {
  EVENT_KINDS,
  activeFilterKinds,
  countEventsInMonth,
  dayButtonLabel,
  dayForKey,
  eventCountLabel,
  firstDayOfMonth,
  groupEventsByDay,
  isDayInMonth,
  monthOfDay,
  monthWeeks,
  shiftMonth,
  toggleKindFilter,
  type CalendarMonth,
} from "./calendar-month";
import { AdminButton, AdminIcon, DashboardCard, navProps } from "./dashboard-primitives";

const KIND_META: Record<DashboardEventKind, { label: string; icon: AdminIconName }> = {
  visit: { label: "Scheduled visit", icon: "calendar" },
  follow_up: { label: "Follow-up due", icon: "clock" },
  rent_due: { label: "Rent due", icon: "dollar" },
  lease_start: { label: "Lease starts", icon: "key" },
  lease_end: { label: "Lease ends", icon: "file" },
  move_in: { label: "Move-in", icon: "login" },
};

const WEEKDAYS = [
  { short: "M", long: "Monday" },
  { short: "T", long: "Tuesday" },
  { short: "W", long: "Wednesday" },
  { short: "T", long: "Thursday" },
  { short: "F", long: "Friday" },
  { short: "S", long: "Saturday" },
  { short: "S", long: "Sunday" },
] as const;

/**
 * Dashboard "Calendar" card (Figma "AH — Dashboard" · Calendar): month
 * navigation, six event-type filters, a Monday-first month grid ("AD /
 * Calendar day") and the selected day's agenda ("AD / Calendar event").
 *
 * The filters are "show only" chips: none pressed shows every kind; pressed
 * chips (tinted, 2px ring) narrow the dots and the agenda to those kinds.
 * The card lays out by its own width: grid beside agenda when wide, grid
 * above agenda when narrow.
 */
export function CalendarCard({
  calendar,
  onNavigate,
  className,
  defaultHiddenKinds,
  defaultSelectedDay,
}: {
  calendar: DashboardCalendarModel;
  onNavigate: (href: string) => void;
  className?: string;
  /** Preview/testing only: start with these event kinds switched off. */
  defaultHiddenKinds?: DashboardEventKind[];
  /** Preview/testing only: initially selected day (`YYYY-MM-DD`). */
  defaultSelectedDay?: string;
}) {
  const { today, events } = calendar;
  const [month, setMonth] = React.useState<CalendarMonth>(() => monthOfDay(today));
  const [selectedDay, setSelectedDay] = React.useState(defaultSelectedDay ?? today);
  const [hiddenKinds, setHiddenKinds] = React.useState<DashboardEventKind[]>(
    defaultHiddenKinds ?? [],
  );
  // Roving tab stop inside the grid: the day the arrow keys last moved to.
  const [cursorDay, setCursorDay] = React.useState(selectedDay);

  const gridRef = React.useRef<HTMLDivElement>(null);
  const pendingFocusDay = React.useRef<string | null>(null);
  const monthLabelId = React.useId();

  const allByDay = React.useMemo(() => groupEventsByDay(events), [events]);
  const visibleByDay = React.useMemo(
    () => groupEventsByDay(events, hiddenKinds),
    [events, hiddenKinds],
  );
  const weeks = React.useMemo(() => monthWeeks(month), [month]);

  const isFiltered = hiddenKinds.length > 0;
  const pressedKinds = activeFilterKinds(hiddenKinds);
  const monthTotal = countEventsInMonth(allByDay, month);
  const monthVisible = countEventsInMonth(visibleByDay, month);
  /** The filters hide every event of the visible month. */
  const monthFilteredEmpty = isFiltered && monthTotal > 0 && monthVisible === 0;

  const dayEvents = visibleByDay.get(selectedDay) ?? [];
  /** The selected day has events, but none of the kinds being shown. */
  const dayFilteredEmpty =
    isFiltered && dayEvents.length === 0 && (allByDay.get(selectedDay)?.length ?? 0) > 0;

  const tabStopDay =
    [cursorDay, selectedDay, today].find((day) => isDayInMonth(day, month)) ??
    firstDayOfMonth(month);

  // Move keyboard focus once the target day's button is on screen (after a
  // month change from the arrow keys, or when the grid comes back).
  React.useEffect(() => {
    const day = pendingFocusDay.current;
    if (!day) return;
    pendingFocusDay.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  });

  const selectDay = (day: string) => {
    setSelectedDay(day);
    setCursorDay(day);
  };

  const goToToday = () => {
    setMonth(monthOfDay(today));
    selectDay(today);
  };

  const clearFilters = () => {
    setHiddenKinds([]);
    // The "Clear filters" button goes away with the empty block.
    pendingFocusDay.current = tabStopDay;
  };

  const onDayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, day: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = dayForKey(day, event.key);
    if (!target) return;
    event.preventDefault();
    setCursorDay(target);
    if (!isDayInMonth(target, month)) setMonth(monthOfDay(target));
    pendingFocusDay.current = target;
  };

  const monthLabel = formatMonthYear(month.year, month.monthIndex);
  const monthSummary =
    isFiltered && monthTotal > 0
      ? `${monthVisible} of ${eventCountLabel(monthTotal).toLowerCase()} shown`
      : eventCountLabel(monthTotal).toLowerCase();

  const filterLabels = pressedKinds.map((kind) => KIND_META[kind].label).join(", ");
  const selectedDayLine = `${relativeDayLabel(selectedDay, today)}, ${formatDayShort(selectedDay)}`;
  const emptyContext = (scope: string) => (filterLabels ? `${filterLabels} · ${scope}` : scope);

  const openFullCalendar = (
    <AdminButton asChild className="min-w-[11.5rem] self-start">
      <a {...navProps(calendar.href, onNavigate)}>Open full calendar</a>
    </AdminButton>
  );

  return (
    <DashboardCard
      title="Calendar"
      summary="Visits, follow-ups, rent and lease dates in one place."
      className={className}
    >
      {/* Month navigation */}
      <div className="flex items-center gap-1">
        <p
          id={monthLabelId}
          aria-live="polite"
          aria-atomic="true"
          className="lg-body-medium min-w-0 flex-1 text-foreground"
        >
          {monthLabel}
          <span className="sr-only">, {monthSummary}</span>
        </p>
        <MonthStepButton label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft aria-hidden size={20} strokeWidth={2.5} absoluteStrokeWidth />
        </MonthStepButton>
        <MonthStepButton label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight aria-hidden size={20} strokeWidth={2.5} absoluteStrokeWidth />
        </MonthStepButton>
        <AdminButton type="button" className="min-w-[4.25rem] px-3" onClick={goToToday}>
          Today
        </AdminButton>
      </div>

      {/* Event filters */}
      <div role="group" aria-label="Show only these event types" className="grid grid-cols-2 gap-x-2 gap-y-4">
        {EVENT_KINDS.map((kind) => {
          const pressed = pressedKinds.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={pressed}
              onClick={() => setHiddenKinds((hidden) => toggleKindFilter(hidden, kind))}
              className={cn(
                "lg-caption flex min-h-11 min-w-0 items-center gap-2 rounded-sm border px-2 py-1 text-left text-foreground transition-colors duration-150",
                pressed
                  ? "border-ring bg-brand-tint shadow-[inset_0_0_0_1px_var(--ring)]"
                  : "border-border hover:bg-muted",
              )}
            >
              <AdminIcon name={KIND_META[kind].icon} />
              <span className="min-w-0 flex-1">{KIND_META[kind].label}</span>
            </button>
          );
        })}
      </div>

      {monthFilteredEmpty ? (
        <>
          {openFullCalendar}
          <FilteredEmpty
            context={emptyContext(isDayInMonth(selectedDay, month) ? selectedDayLine : monthLabel)}
            onClear={clearFilters}
          />
        </>
      ) : (
        <>
          {/* Month and agenda */}
          <div className="flex flex-col gap-6 @[35rem]:flex-row @[35rem]:items-start">
            <div
              ref={gridRef}
              role="grid"
              aria-labelledby={monthLabelId}
              className="flex w-full max-w-[19.25rem] flex-col @[35rem]:w-[19.25rem] @[35rem]:shrink-0"
            >
              <div role="row" className="grid grid-cols-7">
                {WEEKDAYS.map((weekday) => (
                  <div
                    key={weekday.long}
                    role="columnheader"
                    className="lg-label text-center text-muted-foreground"
                  >
                    <span aria-hidden>{weekday.short}</span>
                    <span className="sr-only">{weekday.long}</span>
                  </div>
                ))}
              </div>
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} role="row" className="grid grid-cols-7">
                  {week.map((day, dayIndex) => {
                    if (!day) return <div key={dayIndex} role="gridcell" className="min-h-11" />;
                    const count = visibleByDay.get(day)?.length ?? 0;
                    const isToday = day === today;
                    const isSelected = day === selectedDay;
                    return (
                      <div key={day} role="gridcell">
                        <button
                          type="button"
                          data-day={day}
                          tabIndex={day === tabStopDay ? 0 : -1}
                          aria-label={dayButtonLabel(day, count)}
                          aria-pressed={isSelected}
                          aria-current={isToday ? "date" : undefined}
                          onClick={() => selectDay(day)}
                          onKeyDown={(event) => onDayKeyDown(event, day)}
                          className={cn(
                            "lg-body-medium flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-sm text-foreground transition-colors duration-150",
                            isToday && "border-2 border-ring",
                            isSelected ? "bg-brand-tint" : "hover:bg-muted",
                          )}
                        >
                          {Number(day.slice(8))}
                          {count > 0 ? (
                            <span aria-hidden className="size-1 rounded-full bg-foreground" />
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Selected day agenda */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {dayFilteredEmpty ? (
                <FilteredEmpty context={emptyContext(selectedDayLine)} onClear={clearFilters} />
              ) : (
                <>
                  <h3 className="lg-body-medium text-foreground">
                    {relativeDayHeading(selectedDay, today)}
                  </h3>
                  {dayEvents.length > 0 ? (
                    <ul className="flex flex-col gap-3">
                      {dayEvents.map((event, index) => (
                        <AgendaEvent
                          key={event.id}
                          event={event}
                          today={today}
                          onNavigate={onNavigate}
                          className={index > 0 ? "border-t border-border pt-3" : undefined}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="lg-caption text-muted-foreground">Nothing scheduled.</p>
                  )}
                </>
              )}
            </div>
          </div>
          {openFullCalendar}
        </>
      )}
    </DashboardCard>
  );
}

/** 44px bordered chevron button in the month navigation. */
function MonthStepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-foreground transition-colors duration-150 hover:bg-muted"
    >
      {children}
    </button>
  );
}

/**
 * "AD / Calendar event": the event type icon beside its title, record and
 * relative + absolute date, then the people/place lines and the action link.
 */
function AgendaEvent({
  event,
  today,
  onNavigate,
  className,
}: {
  event: DashboardCalendarEvent;
  today: string;
  onNavigate: (href: string) => void;
  className?: string;
}) {
  const recordId = React.useId();
  return (
    <li className={cn("flex flex-col gap-3", className)}>
      <div className="flex min-h-[5.5rem] items-start gap-3 py-3">
        <AdminIcon name={KIND_META[event.kind].icon} className="mt-px text-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="lg-body-medium text-foreground">{event.title}</p>
          <p id={recordId} className="lg-body text-foreground">
            {event.record}
          </p>
          <p className="lg-caption text-muted-foreground">{relativeDayHeading(event.day, today)}</p>
        </div>
      </div>
      {event.details.length > 0 ? (
        <div className="lg-caption text-muted-foreground">
          {event.details.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
      <AdminButton asChild className="min-w-[9.25rem] self-start">
        <a {...navProps(event.href, onNavigate)} aria-describedby={recordId}>
          {event.actionLabel}
        </a>
      </AdminButton>
    </li>
  );
}

/**
 * "Filtered calendar empty": shown in place of the events the filters leave
 * out. `context` is the "Follow-up due · Tomorrow, Tue 17 Nov 2026" line.
 */
function FilteredEmpty({ context, onClear }: { context: string; onClear: () => void }) {
  return (
    <div className="flex w-full flex-col items-start gap-4 rounded-md border border-border bg-card p-4">
      <h3 className="lg-section text-foreground">No matching events</h3>
      <div className="lg-body text-foreground">
        <p>{context}</p>
        <p>No events match these filters. Clear the filter or choose another day.</p>
      </div>
      <AdminButton type="button" className="min-w-40" onClick={onClear}>
        Clear filters
      </AdminButton>
    </div>
  );
}
