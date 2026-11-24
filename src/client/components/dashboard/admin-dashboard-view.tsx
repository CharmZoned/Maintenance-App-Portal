import { AdminPageShell } from "@/components/chrome/admin-page-shell";
import { useMediaQuery } from "@/hooks/use-media-query";
import type {
  AdminDashboardState,
  DashboardEventKind,
  DashboardIntroModel,
  DashboardNoticeModel,
} from "./admin-dashboard-model";
import { AttentionCard } from "./attention-card";
import { CalendarCard } from "./calendar-card";
import { DashboardIntro } from "./dashboard-intro";
import { DashboardNotice } from "./dashboard-primitives";
import { DashboardEmpty, DashboardError, DashboardLoading } from "./dashboard-states";
import { KpiGrid } from "./kpi-grid";
import { SnapshotCard } from "./side-cards";

/**
 * Admin Dashboard layout (Figma "001 - Admin Pages" · AH — Dashboard).
 *
 * Presentational: takes the view state and reports intent through callbacks.
 *
 * - Desktop (≥1280): fits one screen. A one-row intro, KPIs in one row of
 *   six, then three columns that fill the rest of the viewport — Needs your
 *   attention, Calendar (one week) and the tabbed Snapshot — each scrolling
 *   inside itself. On a very short window the row keeps a minimum height and
 *   the page scrolls instead of squashing the cards.
 * - Tablet (768–1279): KPIs three across; attention and calendar stacked
 *   beside the Snapshot card. The page scrolls.
 * - Phone (<768): one column, and the KPIs move below the calendar so "Needs
 *   your attention" leads the page.
 */
export function AdminDashboardView({
  intro,
  state,
  notice,
  canCreateRequest,
  onNavigate,
  onNewRequest,
  onQuickAdd,
  onRetry,
  onAddProperty,
  preview,
}: {
  intro: DashboardIntroModel;
  state: AdminDashboardState;
  notice?: DashboardNoticeModel | null;
  canCreateRequest: boolean;
  onNavigate: (href: string) => void;
  onNewRequest: () => void;
  onQuickAdd: (actionId: string) => void;
  onRetry: () => void;
  onAddProperty: () => void;
  /** Preview/testing only — force interactive pieces into a given state. */
  preview?: {
    quickAddOpen?: boolean;
    calendarHiddenKinds?: DashboardEventKind[];
    calendarSelectedDay?: string;
  };
}) {
  const isPhone = useMediaQuery("(max-width: 767px)");

  return (
    <AdminPageShell section="Dashboard">
      <div
        className="flex flex-col gap-6 xl:h-full xl:gap-4"
        data-dashboard-state={state.status}
      >
        <DashboardIntro
          intro={intro}
          canCreateRequest={canCreateRequest}
          onNewRequest={onNewRequest}
          onQuickAdd={onQuickAdd}
          defaultQuickAddOpen={preview?.quickAddOpen}
        />

        {notice ? <DashboardNotice tone={notice.tone}>{notice.message}</DashboardNotice> : null}

        {state.status === "loading" ? <DashboardLoading /> : null}

        {state.status === "error" ? (
          <DashboardError
            message={state.message}
            lastAttemptLine={state.lastAttemptLine}
            onRetry={onRetry}
          />
        ) : null}

        {state.status === "empty" ? (
          <DashboardEmpty
            statsLines={state.statsLines}
            contactLines={state.contactLines}
            onAddProperty={onAddProperty}
          />
        ) : null}

        {state.status === "ready" ? (
          <>
            {isPhone ? null : <KpiGrid tiles={state.model.kpis} onNavigate={onNavigate} />}

            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:min-h-[30rem] xl:flex-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,19rem)] 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,22rem)] xl:items-stretch xl:gap-4">
              <div className="flex min-w-0 flex-col gap-6 xl:contents">
                <AttentionCard
                  attention={state.model.attention}
                  onNavigate={onNavigate}
                  fill
                />
                <CalendarCard
                  calendar={state.model.calendar}
                  onNavigate={onNavigate}
                  fill
                  defaultHiddenKinds={preview?.calendarHiddenKinds}
                  defaultSelectedDay={preview?.calendarSelectedDay}
                />
                {isPhone ? <KpiGrid tiles={state.model.kpis} onNavigate={onNavigate} /> : null}
              </div>

              <SnapshotCard
                rent={state.model.rent}
                maintenance={state.model.maintenance}
                messages={state.model.messages}
                activity={state.model.activity}
                onNavigate={onNavigate}
                fill
              />
            </div>
          </>
        ) : null}
      </div>
    </AdminPageShell>
  );
}
