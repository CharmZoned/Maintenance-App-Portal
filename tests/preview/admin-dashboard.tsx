import { createRoot } from "react-dom/client";
import "@/styles.css";
import { AdminWorkspace } from "@/components/chrome/admin-workspace";
import { ShellChromeProvider } from "@/components/chrome/shell-chrome-context";
import { AdminDashboardView } from "@/components/dashboard/admin-dashboard-view";
import type { DashboardNoticeModel } from "@/components/dashboard/admin-dashboard-model";
import { navItemsForAudience } from "@/lib/portal-nav";
import {
  fixtureIntro,
  fixtureStates,
  type FixtureStateName,
} from "./admin-dashboard-fixture";

/**
 * Dev-only preview: the admin Dashboard inside the admin workspace chrome,
 * fed with the Figma sample world. No auth, no backend.
 *
 *   /tests/preview/admin-dashboard.html?state=<name>
 *
 * States: default, all-clear, loading, empty, error (Figma frames of the same
 * name), plus success (success notice), filtered-empty (calendar filters match
 * nothing), quick-add (menu open) and drawer (phone navigation open).
 */

const params = new URLSearchParams(window.location.search);
const requested = params.get("state") ?? "default";

const NAV_COUNTS: Record<string, number> = { maintenance: 3, people: 1, messages: 3 };

function log(label: string) {
  return (value?: unknown) => console.info(`[preview] ${label}`, value ?? "");
}

function Preview() {
  const stateName: FixtureStateName =
    requested in fixtureStates ? (requested as FixtureStateName) : "default";
  const notice: DashboardNoticeModel | null =
    requested === "success"
      ? { tone: "success", message: "Success · Dashboard refreshed. Everything is up to date." }
      : null;

  const items = navItemsForAudience("staff").map((item) => ({
    ...item,
    count: NAV_COUNTS[item.id],
  }));

  return (
    <ShellChromeProvider
      value={{
        email: "ada.admin@landlordgopher.example",
        role: "admin",
        displayName: "Ada Admin",
        unread: false,
        onNotifications: log("notifications"),
        onAccount: log("account"),
        onSignOut: log("sign out"),
      }}
    >
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <AdminWorkspace
          items={items}
          active="dashboard"
          userName="Ada Admin"
          userMeta="Admin · Landlord Gopher"
          onNavigate={log("navigate")}
          onAccount={log("account")}
          onSignOut={log("sign out")}
          defaultDrawerOpen={requested === "drawer"}
        >
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <AdminDashboardView
              intro={fixtureIntro}
              state={fixtureStates[stateName]}
              notice={notice}
              canCreateRequest
              onNavigate={log("navigate")}
              onNewRequest={log("new request")}
              onQuickAdd={log("quick add")}
              onRetry={log("retry")}
              onAddProperty={log("add property")}
              preview={{
                quickAddOpen: requested === "quick-add",
                calendarHiddenKinds:
                  requested === "filtered-empty"
                    ? ["visit", "follow_up", "rent_due", "lease_start", "lease_end", "move_in"]
                    : undefined,
                calendarSelectedDay: "2026-11-17",
              }}
            />
          </main>
        </AdminWorkspace>
      </div>
    </ShellChromeProvider>
  );
}

createRoot(document.getElementById("app")!).render(<Preview />);
