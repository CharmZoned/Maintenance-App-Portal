import { AdminPageShell } from "@/components/chrome/admin-page-shell";
import { useMediaQuery } from "@/hooks/use-media-query";
import type {
  AdminDashboardState,
  DashboardEventKind,
  DashboardIntroModel,
  DashboardNoticeModel,
} from "./admin-dashboard-model";
import { ActivityCard } from "./activity-card";
import { AttentionCard } from "./attention-card";
import { CalendarCard } from "./calendar-card";
import { DashboardIntro } from "./dashboard-intro";
import { DashboardNotice } from "./dashboard-primitives";
import { DashboardEmpty, DashboardError, DashboardLoading } from "./dashboard-states";
import { KpiGrid } from "./kpi-grid";
import {
  ListingsCard,
  MaintenanceSnapshotCard,
  MessagesCard,
  PortfolioCard,
  RentCard,
} from "./side-cards";

/**
 * Admin Dashboard layout (Figma "001 - Admin Pages" · AH — Dashboard).
 *
 * Presentational: takes the view state and reports intent through callbacks.
 *
 * - Desktop (≥1280): KPIs in one row of six, then a fluid main column beside a
 *   384px right column.
 * - Tablet (768–1279): KPIs three across, two equal columns.
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
      <div className="flex flex-col gap-6" data-dashboard-state={state.status}>
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

            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="flex min-w-0 flex-col gap-6">
                <AttentionCard attention={state.model.attention} onNavigate={onNavigate} />
                <CalendarCard
                  calendar={state.model.calendar}
                  onNavigate={onNavigate}
                  defaultHiddenKinds={preview?.calendarHiddenKinds}
                  defaultSelectedDay={preview?.calendarSelectedDay}
                />
                {isPhone ? <KpiGrid tiles={state.model.kpis} onNavigate={onNavigate} /> : null}
                <ActivityCard activity={state.model.activity} onNavigate={onNavigate} />
              </div>

              <div className="flex min-w-0 flex-col gap-6">
                <RentCard rent={state.model.rent} onNavigate={onNavigate} />
                <MaintenanceSnapshotCard
                  maintenance={state.model.maintenance}
                  onNavigate={onNavigate}
                />
                <MessagesCard messages={state.model.messages} onNavigate={onNavigate} />
                <ListingsCard listings={state.model.listings} onNavigate={onNavigate} />
                <PortfolioCard portfolio={state.model.portfolio} />
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AdminPageShell>
  );
}
