import { useEffect, useState } from "react";
import { AppNav, reportLocation, type AppNavItem } from "@clawnify/app/client";
import { useAppState } from "./hooks/use-app-state";
import { useAuth } from "./hooks/use-auth";
import { useRouter, type Route } from "./hooks/use-router";
import { AppContext } from "./context";
import { ErrorBanner } from "./components/error-banner";
import { NoticeBanner } from "./components/notice-banner";
import { PortalErrorBoundary } from "./components/portal-error-boundary";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { PropertiesList } from "./components/properties/properties-list";
import { PropertyPage } from "./components/properties/property-page";
import { TenantsList } from "./components/tenants/tenants-list";
import { TenantPage } from "./components/tenants/tenant-page";
import { LeasesPage } from "./components/leases/leases-page";
import { RentPage } from "./components/rent/rent-page";
import { MaintenancePage } from "./components/maintenance/maintenance-page";
import { CalendarPage } from "./components/calendar/calendar-page";
import { TenantDocumentsPage } from "./components/documents/tenant-documents-page";
import { LandlordDocumentsPage } from "./components/documents/landlord-documents-page";
import { SettingsPage } from "./components/settings/settings-page";
import { LandlordsPage } from "./components/landlords/landlords-page";
import { ApplicationsPage } from "./components/applications/applications-page";
import { UsersPage } from "./components/users/users-page";
import { LoginPage } from "./components/auth/login-page";
import { ResetRequestPage, ResetConfirmPage } from "./components/auth/reset-password-page";
import { BlockedPage } from "./components/auth/blocked-page";
import { Button } from "./components/ui/button";
import {
  isLandlordAllowedRoute,
  ROLE_HOME,
  resolveReadyLanding,
  type PortalAudience,
} from "./lib/safe-redirect";

const PORTFOLIO: AppNavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", home: true },
  { id: "properties", label: "Properties", href: "/properties", icon: "building-2", color: "green" },
  { id: "landlords", label: "Landlords", href: "/landlords", icon: "users", color: "green" },
  { id: "tenants", label: "Tenants", href: "/tenants", icon: "users", color: "blue" },
  { id: "leases", label: "Leases", href: "/leases", icon: "clipboard-list", color: "violet" },
];
const OPERATIONS: AppNavItem[] = [
  { id: "rent", label: "Rent", href: "/rent", icon: "dollar-sign", color: "amber" },
  { id: "maintenance", label: "Maintenance", href: "/maintenance", icon: "list-checks", color: "orange" },
  { id: "calendar", label: "Calendar", href: "/calendar", icon: "calendar-days", color: "blue" },
];
/** Maintenance workers: assigned jobs + calendar only (no empty portfolio/admin shell). */
const MAINTENANCE_NAV: AppNavItem[] = [
  {
    id: "maintenance",
    label: "Assigned jobs",
    href: "/maintenance",
    home: true,
    icon: "list-checks",
    color: "orange",
  },
  { id: "calendar", label: "Calendar", href: "/calendar", icon: "calendar-days", color: "blue" },
];
/** Admin-only: Users queue, rental Applications (applicant income PII), and Settings. */
const ADMIN_ITEMS: AppNavItem[] = [
  { id: "users", label: "Users", href: "/users", icon: "users", color: "violet" },
  { id: "applications", label: "Rental applications", href: "/applications", icon: "clipboard-list", color: "blue" },
  { id: "settings", label: "Settings", href: "/settings", icon: "settings" },
];
const TENANT_NAV: AppNavItem[] = [
  { id: "maintenance", label: "My requests", href: "/maintenance", home: true, icon: "list-checks", color: "orange" },
  { id: "documents", label: "Documents", href: "/documents", icon: "clipboard-list", color: "blue" },
];
const LANDLORD_NAV: AppNavItem[] = [
  { id: "properties", label: "Properties", href: "/properties", home: true, icon: "building-2", color: "green" },
  { id: "maintenance", label: "Maintenance", href: "/maintenance", icon: "list-checks", color: "orange" },
  { id: "documents", label: "Documents", href: "/documents", icon: "clipboard-list", color: "blue" },
];

function activeFor(route: Route): string {
  if (route.name === "property") return "properties";
  if (route.name === "tenant") return "tenants";
  return route.name;
}

type AuthScreen = "login" | "reset-request" | "reset-confirm";

export function App() {
  const auth = useAuth();
  const [authScreen, setAuthScreen] = useState<AuthScreen>(() =>
    window.location.pathname === "/reset-password" ? "reset-confirm" : "login",
  );
  const ready = auth.gate.state === "ready";
  const isAdmin = auth.gate.state === "ready" && auth.gate.role.role === "admin";
  const isTenant =
    auth.gate.state === "ready" &&
    auth.gate.role.role === "tenant" &&
    auth.gate.role.tenant_id != null;
  const isLandlord =
    auth.gate.state === "ready" &&
    auth.gate.role.role === "landlord" &&
    auth.gate.role.landlord_id != null;
  const isMaintenance =
    auth.gate.state === "ready" &&
    auth.gate.role.role === "maintenance" &&
    auth.gate.role.staff_id != null;
  const state = useAppState(ready, { isAdmin, isTenant, isLandlord, isMaintenance });
  const { path, search, route, navigate, replace } = useRouter();

  useEffect(() => {
    if (ready) reportLocation(path);
  }, [path, ready]);

  useEffect(() => {
    if (window.location.pathname === "/reset-password") {
      setAuthScreen("reset-confirm");
    }
  }, []);

  // Phase 4b / WS-R + role shell: one replace landing (redirect/intent → clamp).
  // No separate effects — avoids same-tick order races and replace-then-push history.
  useEffect(() => {
    if (!ready) return;
    const audience: PortalAudience = isTenant
      ? "tenant"
      : isLandlord
        ? "landlord"
        : isMaintenance
          ? "maintenance"
          : "staff";
    const landing = resolveReadyLanding({
      search: window.location.search,
      origin: window.location.origin,
      pathname: window.location.pathname,
      audience,
    });
    if (!landing.shouldNavigate) return;
    navigate(landing.path, { replace: true, search: landing.search });
  }, [ready, isTenant, isLandlord, isMaintenance, path, navigate]);

  if (auth.gate.state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Restoring session…
      </div>
    );
  }

  if (auth.gate.state === "unauthenticated") {
    if (authScreen === "reset-request") {
      return (
        <ResetRequestPage
          error={auth.authError}
          onBack={() => setAuthScreen("login")}
          onSubmit={auth.requestPasswordReset}
        />
      );
    }
    if (authScreen === "reset-confirm") {
      return (
        <ResetConfirmPage
          error={auth.authError}
          onSubmit={auth.updatePassword}
          onDone={() => {
            window.history.replaceState(null, "", "/dashboard");
            setAuthScreen("login");
          }}
        />
      );
    }
    return (
      <LoginPage
        configured={auth.configured}
        error={auth.authError}
        onLogin={auth.login}
        onSignup={auth.signup}
        onForgot={() => setAuthScreen("reset-request")}
      />
    );
  }

  if (auth.gate.state === "error") {
    return (
      <BlockedPage
        title="Couldn’t load your role"
        message={auth.gate.message}
        onRetry={() => void auth.retryRole()}
        onLogout={() => void auth.logout()}
      />
    );
  }

  if (auth.gate.state === "no_role") {
    return (
      <BlockedPage
        title="No role assigned"
        message="Your account is signed in but has no portal role yet. Ask an admin to assign a role on the Users page, or run private.assign_admin for bootstrap."
        onRetry={() => void auth.retryRole()}
        retryLabel="Check again"
        onLogout={() => void auth.logout()}
      />
    );
  }

  if (auth.gate.state === "unapproved") {
    const status = auth.gate.role.account_status;
    const pendingCopy =
      status === "pending"
        ? "Your email is verified (or signup is complete). An admin must approve your account before you can use the portal. After approval, use Check again or sign in again."
        : `Your account status is “${status}”. Contact an admin if you believe this is a mistake. After they change your status, use Check again.`;
    return (
      <BlockedPage
        title="Account not approved"
        message={pendingCopy}
        onRetry={() => void auth.retryRole()}
        retryLabel="Check again"
        onLogout={() => void auth.logout()}
      />
    );
  }

  if (auth.gate.state === "forbidden") {
    const role = auth.gate.role.role;
    const hint =
      role === "landlord" && auth.gate.role.landlord_id == null
        ? "Ask an admin to link your Landlord row, then use Check again."
        : role === "tenant" && auth.gate.role.tenant_id == null
          ? "Ask an admin to link your Tenant row, then use Check again."
          : role === "maintenance" && auth.gate.role.staff_id == null
            ? "Ask an admin to link a Staff row, then use Check again."
            : "This portal is for admin, maintenance staff, linked tenants, or linked landlords.";
    return (
      <BlockedPage
        title="Access required"
        message={`Signed in as ${role}. ${hint}`}
        onRetry={() => void auth.retryRole()}
        retryLabel="Check again"
        onLogout={() => void auth.logout()}
      />
    );
  }

  const homePath = isTenant
    ? ROLE_HOME.tenant
    : isLandlord
      ? ROLE_HOME.landlord
      : isMaintenance
        ? ROLE_HOME.maintenance
        : ROLE_HOME.staff;

  // reset-password while already authenticated (from email link)
  if (authScreen === "reset-confirm" && window.location.pathname === "/reset-password") {
    return (
      <ResetConfirmPage
        error={auth.authError}
        onSubmit={auth.updatePassword}
        onDone={() => {
          setAuthScreen("login");
          // replace:true syncs React path even when URL already matches (avoids
          // replaceState-then-navigate no-op leaving route stuck on /reset-password).
          navigate(homePath, { replace: true, search: "" });
        }}
      />
    );
  }

  // Settings (and Users / Applications) are admin-only — staff must not see the Admin nav group.
  // Maintenance workers get a short jobs+calendar menu (not the empty portfolio shell).
  const groups = isTenant
    ? [{ items: TENANT_NAV }]
    : isLandlord
      ? [{ items: LANDLORD_NAV }]
      : isMaintenance
        ? [{ items: MAINTENANCE_NAV }]
        : [
            { items: PORTFOLIO },
            { label: "Operations", items: OPERATIONS },
            ...(isAdmin ? [{ label: "Admin", items: ADMIN_ITEMS }] : []),
          ];

  const portalTitle = isTenant
    ? "LG Tenant Portal"
    : isLandlord
      ? "LG Landlord Portal"
      : "LG Maintenance Portal";

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <div className="flex shrink-0">
          <AppNav
            title={portalTitle}
            icon="home"
            groups={groups}
            active={activeFor(route)}
            onNavigate={(item) => navigate(item.href ?? homePath)}
          />
        </div>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-end gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <span>{auth.gate.user.email}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">
              {auth.gate.role.role}
            </span>
            {isLandlord && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium tracking-wide">
                Read-only
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => void auth.logout()}>
              Sign out
            </Button>
          </div>
          {/* Pages keep their own list loaders — do not blank the shell while lookups finish. */}
          <PortalErrorBoundary>
            {isTenant ? (
              <>
                {route.name === "maintenance" && <MaintenancePage />}
                {route.name === "documents" && <TenantDocumentsPage />}
                {route.name !== "maintenance" && route.name !== "documents" && (
                  <Placeholder title="Tenant portal" message="Use My requests to submit and track maintenance." />
                )}
              </>
            ) : isLandlord ? (
              <>
                {route.name === "properties" && <PropertiesList navigate={navigate} />}
                {route.name === "property" && <PropertyPage id={route.id} navigate={navigate} />}
                {route.name === "maintenance" && <MaintenancePage />}
                {route.name === "documents" && <LandlordDocumentsPage />}
                {!isLandlordAllowedRoute(route) && (
                  <Placeholder
                    title="Landlord portal"
                    message="Read-only view of your properties, maintenance, and documents. Editing is not available yet."
                  />
                )}
              </>
            ) : isMaintenance ? (
              <>
                {route.name === "maintenance" && (
                  <MaintenancePage search={search} replace={replace} />
                )}
                {route.name === "calendar" && <CalendarPage navigate={navigate} />}
                {route.name !== "maintenance" && route.name !== "calendar" && (
                  <Placeholder
                    title="Assigned jobs"
                    message="Use Assigned jobs or Calendar from the menu."
                  />
                )}
              </>
            ) : (
              <>
                {route.name === "dashboard" && <DashboardPage navigate={navigate} />}
                {route.name === "properties" && <PropertiesList navigate={navigate} />}
                {route.name === "property" && <PropertyPage id={route.id} navigate={navigate} />}
                {route.name === "landlords" && <LandlordsPage />}
                {route.name === "tenants" && <TenantsList navigate={navigate} />}
                {route.name === "tenant" && <TenantPage id={route.id} navigate={navigate} />}
                {route.name === "leases" && (
                  <LeasesPage navigate={navigate} search={search} replace={replace} />
                )}
                {route.name === "rent" && <RentPage search={search} replace={replace} />}
                {route.name === "maintenance" && (
                  <MaintenancePage search={search} replace={replace} />
                )}
                {route.name === "calendar" && <CalendarPage navigate={navigate} />}
                {route.name === "applications" &&
                  (isAdmin ? (
                    <ApplicationsPage search={search} replace={replace} />
                  ) : (
                    <Placeholder
                      title="Admins only"
                      message="Rental applications include applicant income and other PII — admins only."
                    />
                  ))}
                {route.name === "users" &&
                  (isAdmin ? (
                    <UsersPage />
                  ) : (
                    <Placeholder
                      title="Admins only"
                      message="The Users approval queue is restricted to admins."
                    />
                  ))}
                {route.name === "settings" &&
                  (isAdmin ? (
                    <SettingsPage />
                  ) : (
                    <Placeholder
                      title="Admins only"
                      message="Rent policy and portal settings are restricted to admins."
                    />
                  ))}
                {route.name === "not-found" && (
                  <Placeholder title="Not found" message="That page doesn't exist." />
                )}
              </>
            )}
          </PortalErrorBoundary>
        </main>
        <ErrorBanner />
        <NoticeBanner />
      </div>
    </AppContext.Provider>
  );
}

function Placeholder({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
