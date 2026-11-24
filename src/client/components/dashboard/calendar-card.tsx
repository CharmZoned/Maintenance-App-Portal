import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addDays,
  dayDiff,
  formatWeekdayDayMonth,
  relativeDayLabel,
  weekdayShort,
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
  countEventsOnDays,
  dayButtonLabel,
  dayForKey,
  eventCountLabel,
  groupEventsByDay,
  toggleKindFilter,
  weekDays,
  weekRangeLabel,
  weekStart,
} from "./calendar-month";
import {
  AdminButton,
  AdminIcon,
  DashboardCard,
  SCROLL_REGION,
  navProps,
} from "./dashboard-primitives";

const KIND_META: Record<DashboardEventKind, { label: string; icon: AdminIconName }> = {
  visit: { label: "Scheduled visit", icon: "calendar" },
  follow_up: { label: "Follow-up due", icon: "clock" },
  rent_due: { label: "Rent due", icon: "dollar" },
  lease_start: { label: "Lease starts", icon: "key" },
  lease_end: { label: "Lease ends", icon: "file" },
  move_in: { label: "Move-in", icon: "login" },
};

/**
 * Dashboard "Calendar" card: one week at a time, so it stays short.
 *
 * - Header: previous / next week and Today.
 * - The week's range and event count, with a "Show only" filter menu (the
 *   six event types; none ticked shows everything).
 * - A seven-day strip: a dot marks days with events; today has a ring, the
 *   selected day is tinted. Choosing a day scrolls the agenda to it.
 * - The agenda: every day of the week with its events, in a region that
 *   scrolls inside the card (it fills the card on desktop, and is capped at
 *   about 22rem on smaller screens), with sticky day headings.
 * - "Open full calendar" for the month view.
 */
export function CalendarCard({
  calendar,
  onNavigate,
  className,
  fill,
  defaultHiddenKinds,
  defaultSelectedDay,
}: {
  calendar: DashboardCalendarModel;
  onNavigate: (href: string) => void;
  className?: string;
  /** Fill the grid cell from `xl`; the agenda takes the spare height. */
  fill?: boolean;
  /** Preview/testing only: start with these event kinds switched off. */
  defaultHiddenKinds?: DashboardEventKind[];
  /** Preview/testing only: initially selected day (`YYYY-MM-DD`). */
  defaultSelectedDay?: string;
}) {
  const { today, events } = calendar;
  const [selectedDay, setSelectedDay] = React.useState(defaultSelectedDay ?? today);
  const [week, setWeek] = React.useState(() => weekStart(defaultSelectedDay ?? today));
  const [hiddenKinds, setHiddenKinds] = React.useState<DashboardEventKind[]>(
    defaultHiddenKinds ?? [],
  );
  // Roving tab stop in the strip: the day the arrow keys last moved to.
  const [cursorDay, setCursorDay] = React.useState(selectedDay);

  const stripRef = React.useRef<HTMLDivElement>(null);
  const agendaRef = React.useRef<HTMLDivElement>(null);
  const pendingFocusDay = React.useRef<string | null>(null);
  const firstScroll = React.useRef(true);
  const weekLabelId = React.useId();

  const days = React.useMemo(() => weekDays(week), [week]);
  const allByDay = React.useMemo(() => groupEventsByDay(events), [events]);
  const visibleByDay = React.useMemo(
    () => groupEventsByDay(events, hiddenKinds),
    [events, hiddenKinds],
  );

  const isFiltered = hiddenKinds.length > 0;
  const pressedKinds = activeFilterKinds(hiddenKinds);
  const weekTotal = countEventsOnDays(allByDay, days);
  const weekVisible = countEventsOnDays(visibleByDay, days);
  /** The filters hide every event of the week on screen. */
  const weekFilteredEmpty = isFiltered && weekTotal > 0 && weekVisible === 0;

  const inWeek = (day: string) => days.includes(day);
  const tabStopDay = [cursorDay, selectedDay, today].find(inWeek) ?? days[0];

  // Move keyboard focus once the target day's button is on screen (after a
  // week change from the arrow keys).
  React.useEffect(() => {
    const day = pendingFocusDay.current;
    if (!day) return;
    pendingFocusDay.current = null;
    stripRef.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  });

  // Bring the selected day's agenda to the top of the scroll region. Only the
  // region scrolls (never the page), and the first scroll is instant.
  React.useEffect(() => {
    const region = agendaRef.current;
    const group = region?.querySelector<HTMLElement>(`[data-agenda-day="${selectedDay}"]`);
    if (!region || !group) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    region.scrollTo({
      // The region is `relative`, so the group's offsetTop is measured from it.
      top: group.offsetTop,
      behavior: firstScroll.current || reduce ? "auto" : "smooth",
    });
    firstScroll.current = false;
  }, [selectedDay, week, weekFilteredEmpty]);

  const selectDay = (day: string) => {
    setSelectedDay(day);
    setCursorDay(day);
  };

  const showWeek = (day: string, select: string = day) => {
    setWeek(weekStart(day));
    selectDay(select);
  };

  const stepWeek = (delta: number) => {
    const target = addDays(days[0], delta * 7);
    // Land on today when stepping back into this week; otherwise on Monday.
    showWeek(target, weekDays(target).includes(today) ? today : target);
  };

  const onDayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, day: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = dayForKey(day, event.key);
    if (!target) return;
    event.preventDefault();
    setCursorDay(target);
    if (!inWeek(target)) setWeek(weekStart(target));
    pendingFocusDay.current = target;
  };

  const weekLabel = weekRangeLabel(week);
  const countLine =
    isFiltered && weekTotal > 0
      ? `${weekVisible} of ${eventCountLabel(weekTotal).toLowerCase()}`
      : eventCountLabel(weekTotal);

  const filterLabel =
    pressedKinds.length === 0
      ? "All types"
      : pressedKinds.length === 1
        ? KIND_META[pressedKinds[0]].label
        : `${pressedKinds.length} types`;

  return (
    <DashboardCard
      title="Calendar"
      className={className}
      fill={fill}
      scrollBody={false}
      bodyClassName="gap-3"
      actions={
        <>
          <StepButton label="Previous week" onClick={() => stepWeek(-1)}>
            <ChevronLeft aria-hidden size={18} strokeWidth={2.5} absoluteStrokeWidth />
          </StepButton>
          <StepButton label="Next week" onClick={() => stepWeek(1)}>
            <ChevronRight aria-hidden size={18} strokeWidth={2.5} absoluteStrokeWidth />
          </StepButton>
          <AdminButton type="button" className="h-9 px-3" onClick={() => showWeek(today)}>
            Today
          </AdminButton>
        </>
      }
      footer={
        <AdminButton asChild className="h-9 self-start px-3">
          <a {...navProps(calendar.href, onNavigate)}>Open full calendar</a>
        </AdminButton>
      }
    >
      {/* Week and filter */}
      <div className="flex min-w-0 items-center gap-2">
        <p
          id={weekLabelId}
          aria-live="polite"
          aria-atomic="true"
          className="flex min-w-0 flex-1 flex-col"
        >
          <span className="lg-body-medium truncate text-foreground">{weekLabel}</span>
          <span className="lg-caption text-muted-foreground">{countLine}</span>
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <AdminButton
              type="button"
              className={cn("h-9 max-w-[11rem] gap-1 px-3", isFiltered && "border-ring bg-brand-tint")}
              aria-label={`Show only: ${pressedKinds.length === 0 ? "all event types" : pressedKinds.map((k) => KIND_META[k].label).join(", ")}`}
            >
              <span className="truncate">{filterLabel}</span>
              <ChevronDown aria-hidden size={16} strokeWidth={2} absoluteStrokeWidth />
            </AdminButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="lg-admin w-56">
            <DropdownMenuLabel className="lg-label text-muted-foreground">Show only</DropdownMenuLabel>
            {EVENT_KINDS.map((kind) => (
              <DropdownMenuCheckboxItem
                key={kind}
                checked={pressedKinds.includes(kind)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => setHiddenKinds((hidden) => toggleKindFilter(hidden, kind))}
                className="min-h-9 gap-2 text-foreground"
              >
                <AdminIcon name={KIND_META[kind].icon} size={16} />
                {KIND_META[kind].label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!isFiltered}
              onSelect={() => setHiddenKinds([])}
              className="min-h-9 text-foreground"
            >
              Show all types
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Week strip */}
      <div
        ref={stripRef}
        role="group"
        aria-labelledby={weekLabelId}
        className="grid grid-cols-7 gap-1"
      >
        {days.map((day) => {
          const count = visibleByDay.get(day)?.length ?? 0;
          const isToday = day === today;
          const isSelected = day === selectedDay;
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              tabIndex={day === tabStopDay ? 0 : -1}
              aria-label={dayButtonLabel(day, count)}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => selectDay(day)}
              onKeyDown={(event) => onDayKeyDown(event, day)}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-sm text-foreground transition-colors duration-150",
                isToday && "border-2 border-ring",
                isSelected ? "bg-brand-tint" : "hover:bg-muted",
              )}
            >
              <span aria-hidden className="lg-label text-muted-foreground">
                {weekdayShort(day).slice(0, 1)}
              </span>
              <span aria-hidden className="lg-body-medium">
                {Number(day.slice(8))}
              </span>
              <span
                aria-hidden
                className={cn("size-1 rounded-full", count > 0 ? "bg-foreground" : "bg-transparent")}
              />
            </button>
          );
        })}
      </div>

      {/* Agenda */}
      {weekFilteredEmpty ? (
        <FilteredEmpty
          context={`${pressedKinds.map((k) => KIND_META[k].label).join(", ")} · ${weekLabel}`}
          onClear={() => {
            setHiddenKinds([]);
            pendingFocusDay.current = tabStopDay;
          }}
        />
      ) : (
        <div
          ref={agendaRef}
          aria-label={`Agenda, ${weekLabel}`}
          role="region"
          className={cn(
            SCROLL_REGION,
            "relative max-h-[22rem] border-t border-border",
            fill && "xl:max-h-none xl:min-h-0 xl:flex-1",
          )}
        >
          {days.map((day) => {
            const dayEvents = visibleByDay.get(day) ?? [];
            const hiddenHere = isFiltered && dayEvents.length === 0 && (allByDay.get(day)?.length ?? 0) > 0;
            return (
              <section key={day} data-agenda-day={day} aria-label={formatWeekdayDayMonth(day)}>
                <h3
                  className={cn(
                    "lg-label sticky top-0 z-10 bg-card pb-1 pt-3 uppercase",
                    day === selectedDay ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatWeekdayDayMonth(day)}
                  {Math.abs(dayDiff(today, day)) <= 1 ? (
                    <span> · {relativeDayLabel(day, today)}</span>
                  ) : null}
                </h3>
                {dayEvents.length > 0 ? (
                  <ul className="flex flex-col">
                    {dayEvents.map((event) => (
                      <AgendaEvent key={event.id} event={event} onNavigate={onNavigate} />
                    ))}
                  </ul>
                ) : (
                  <p className="lg-caption pb-1 text-muted-foreground">
                    {hiddenHere ? "Nothing of the types shown." : "Nothing scheduled."}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}

/** 36px bordered chevron button in the card header. */
function StepButton({
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
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-foreground transition-colors duration-150 hover:bg-muted"
    >
      {children}
    </button>
  );
}

/**
 * One agenda row ("AD / Calendar event", compact): the event type icon, the
 * title and record, then the people/place lines. The whole row links to the
 * record; its action ("Open request") leads the accessible name.
 */
function AgendaEvent({
  event,
  onNavigate,
}: {
  event: DashboardCalendarEvent;
  onNavigate: (href: string) => void;
}) {
  return (
    <li className="min-w-0">
      <a
        {...navProps(event.href, onNavigate)}
        className="-mx-2 flex items-start gap-3 rounded-sm px-2 py-2 transition-colors duration-150 hover:bg-muted active:bg-muted"
      >
        <AdminIcon name={KIND_META[event.kind].icon} size={16} className="mt-[3px] text-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="sr-only">{event.actionLabel}: </span>
          <span className="lg-body-medium break-words text-foreground">{event.title}</span>
          <span className="lg-caption break-words text-foreground">{event.record}</span>
          {event.details.length > 0 ? (
            <span className="lg-caption break-words text-muted-foreground">
              {event.details.join(" · ")}
            </span>
          ) : null}
        </span>
      </a>
    </li>
  );
}

/**
 * "Filtered calendar empty": shown in place of the agenda when the filters
 * leave nothing in the week. `context` is the "Follow-up due · 16 – 22 Nov
 * 2026" line.
 */
function FilteredEmpty({ context, onClear }: { context: string; onClear: () => void }) {
  return (
    <div className="flex w-full flex-col items-start gap-3 rounded-md border border-border bg-card p-4">
      <h3 className="lg-body-medium text-foreground">No matching events</h3>
      <div className="lg-caption text-muted-foreground">
        <p>{context}</p>
        <p>No events this week match these filters.</p>
      </div>
      <AdminButton type="button" className="h-9 px-3" onClick={onClear}>
        Clear filters
      </AdminButton>
    </div>
  );
}
