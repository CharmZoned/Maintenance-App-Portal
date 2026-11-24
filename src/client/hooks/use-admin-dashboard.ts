import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AdminDashboardState,
  DashboardIntroModel,
} from "@/components/dashboard/admin-dashboard-model";
import { useApp } from "@/context";
import {
  buildDashboardIntro,
  buildDashboardState,
  buildErrorState,
  dashboardChargePeriods,
  type AdminDashboardSources,
  type AdminDashboardViewer,
} from "@/lib/admin-dashboard";
import { greetingForHour, toDay } from "@/lib/admin-dates";
import * as data from "@/lib/data";
import { loadAdminInbox } from "@/lib/inbox";
import type { Landlord, Property } from "@/types";

/** A secondary read: a failure becomes `null` and only its own card degrades. */
function soft<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

/**
 * Every read the dashboard needs, in one parallel round. Properties, units and
 * requests are core — if one of them fails the whole load rejects. Everything
 * else is wrapped in `soft`. Exported for tests.
 */
export async function loadAdminDashboardSources(input: {
  viewer: AdminDashboardViewer;
  /** Properties the app shell already holds; re-read here only when it has none. */
  properties: Property[];
  landlords: Landlord[];
  now: Date;
}): Promise<AdminDashboardSources> {
  const isAdmin = input.viewer.role === "admin";
  const [
    properties,
    units,
    workOrders,
    leases,
    charges,
    accounts,
    staff,
    tenants,
    applications,
    marketing,
    paymentsAwaitingVerification,
    statusEvents,
    comments,
    payments,
    documents,
    inbox,
  ] = await Promise.all([
    // An empty shell list may mean "none yet" or "lookups failed", so confirm
    // with a real read before the page is allowed to show the empty state.
    input.properties.length > 0 ? Promise.resolve(input.properties) : data.listProperties(),
    data.listUnits(),
    data.listWorkOrders(),
    soft(data.listLeases()),
    soft(data.listChargesForPeriods(dashboardChargePeriods(input.now))),
    // The approval queue is an admin-only RPC.
    isAdmin ? soft(data.listUserAccounts()) : Promise.resolve(null),
    soft(data.listStaff()),
    soft(data.listTenants()),
    soft(data.listApplications("all")),
    soft(data.listUnitMarketingFlags()),
    soft(data.listPaymentsAwaitingVerification()),
    soft(data.listRecentMaintenanceStatusEvents()),
    soft(data.listRecentMaintenanceComments()),
    soft(data.listRecentPayments()),
    soft(data.listRecentDocumentUploads()),
    // Same inbox and unread rule as the Messages page and the rail badge.
    soft(loadAdminInbox()),
  ]);

  return {
    properties,
    units,
    workOrders,
    viewer: input.viewer,
    // The shell swallows a failed landlord lookup into []; names then fall back
    // to the landlord name carried on each property.
    landlords: input.landlords.length > 0 ? input.landlords : null,
    leases,
    charges,
    accounts,
    staff,
    tenants,
    applications,
    marketing,
    paymentsAwaitingVerification,
    statusEvents,
    comments,
    payments,
    documents,
    inbox,
  };
}

/**
 * Loads the admin Dashboard and turns it into the view model.
 *
 * - First load → `loading`; core reads fail → `error`; no properties → `empty`;
 *   otherwise `ready`.
 * - A reload with content on screen runs in the background (`refreshing`): the
 *   current model stays up and, if the reload fails, is kept (`reload()`
 *   resolves false).
 * - Results are dropped after unmount, and an older response never overwrites
 *   a newer one.
 */
export function useAdminDashboard(user: {
  displayName: string | null;
  email: string;
  role: string;
}): {
  intro: DashboardIntroModel;
  state: AdminDashboardState;
  /** True while re-fetching with a model already on screen. */
  refreshing: boolean;
  /** Re-fetch. Resolves true when the reload succeeded. */
  reload: () => Promise<boolean>;
} {
  const app = useApp();
  const [state, setState] = useState<AdminDashboardState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  /** Drives the greeting and date line; moves when the hour or the day changes. */
  const [clock, setClock] = useState(() => new Date());

  const viewer = useMemo<AdminDashboardViewer>(
    () => ({ displayName: user.displayName, email: user.email, role: user.role }),
    [user.displayName, user.email, user.role],
  );

  // Latest values for the stable `reload` callback.
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const lookupsRef = useRef({ properties: app.properties, landlords: app.landlords });
  lookupsRef.current = { properties: app.properties, landlords: app.landlords };

  const mountedRef = useRef(false);
  /** Bumped per load; a response whose number is stale is dropped. */
  const requestRef = useRef(0);
  const latestRef = useRef<Promise<boolean> | null>(null);
  /** True once a model (ready or empty) is on screen. */
  const hasContentRef = useRef(false);
  /** Last good sources, so the model can be re-worded when the day changes. */
  const sourcesRef = useRef<AdminDashboardSources | null>(null);

  const reload = useCallback((): Promise<boolean> => {
    const request = ++requestRef.current;
    const background = hasContentRef.current;
    if (background) setRefreshing(true);
    else setState({ status: "loading" });

    const run = (async (): Promise<boolean> => {
      let sources: AdminDashboardSources | null = null;
      try {
        sources = await loadAdminDashboardSources({
          viewer: viewerRef.current,
          properties: lookupsRef.current.properties,
          landlords: lookupsRef.current.landlords,
          now: new Date(),
        });
      } catch {
        sources = null;
      }
      if (!mountedRef.current) return false;
      // A newer load started while this one was in flight: its result decides.
      if (request !== requestRef.current) return latestRef.current ?? false;

      const now = new Date();
      setClock(now);
      setRefreshing(false);
      if (!sources) {
        // Keep whatever is on screen; only a first load turns into the error state.
        if (!background) setState(buildErrorState(now, now));
        return false;
      }
      sourcesRef.current = sources;
      hasContentRef.current = true;
      setState(buildDashboardState(sources, viewerRef.current, now));
      return true;
    })();
    latestRef.current = run;
    return run;
  }, []);

  // Load once the shell's lookups have settled, and again whenever they change
  // (a property was added, renamed or removed elsewhere in the app).
  const lookupsLoading = app.loading;
  const shellProperties = app.properties;
  useEffect(() => {
    mountedRef.current = true;
    if (!lookupsLoading) void reload();
    return () => {
      mountedRef.current = false;
      // Invalidate anything in flight.
      requestRef.current += 1;
    };
  }, [lookupsLoading, shellProperties, reload]);

  // Keep the greeting, the date line and every "today" in the model honest
  // when the page stays open across noon, the evening or midnight.
  const clockRef = useRef(clock);
  clockRef.current = clock;
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      const previous = clockRef.current;
      const sameDay = toDay(previous) === toDay(now);
      if (sameDay && greetingForHour(previous.getHours()) === greetingForHour(now.getHours())) return;
      setClock(now);
      const sources = sourcesRef.current;
      if (!sameDay && sources) {
        // Re-word relative dates ("Tomorrow", "In 4 days") for the new day right
        // away, from what is already loaded…
        setState((current) =>
          current.status === "ready" ? buildDashboardState(sources, viewerRef.current, now) : current,
        );
        // …then re-read in the background: the rent-charge window follows the
        // month, and a day's worth of activity may have happened elsewhere.
        if (hasContentRef.current) void reload();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const intro = useMemo(
    () => buildDashboardIntro({ displayName: user.displayName, email: user.email }, clock),
    [user.displayName, user.email, clock],
  );

  return { intro, state, refreshing, reload };
}
