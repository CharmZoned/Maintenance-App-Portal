import { useEffect, useState } from "react";
import { AppNav, reportLocation, type AppNavItem } from "@clawnify/app/client";
import { useAppState } from "./hooks/use-app-state";
import { useAuth } from "./hooks/use-auth";
import { useRouter, type Route } from "./hooks/use-router";
import { AppContext } from "./context";
import { ErrorBanner } from "./components/error-banner";
import { NoticeBanner } from "./components/notice-banner";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { PropertiesList } from "./components/properties/properties-list";
import { PropertyPage } from "./components/properties/property-page";
import { TenantsList } from "./components/tenants/tenants-list";
import { TenantPage } from "./components/tenants/tenant-page";
import { LeasesPage } from "./components/leases/leases-page";
import { RentPage } from "./components/rent/rent-page";
import { MaintenancePage } from "./components/maintenance/maintenance-page";
import { SettingsPage } from "./components/settings/settings-page";
import { LandlordsPage } from "./components/landlords/landlords-page";
import { ApplicationsPage } from "./components/applications/applications-page";
import { UsersPage } from "./components/users/users-page";
import { LoginPage } from "./components/auth/login-page";
import { ResetRequestPage, ResetConfirmPage } from "./components/auth/reset-password-page";
import { BlockedPage } from "./components/auth/blocked-page";
import { Button } from "./components/ui/button";

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
  { id: "applications", label: "Rental applications", href: "/applications", icon: "clipboard-list", color: "blue" },
];
const ADMIN_ITEMS: AppNavItem[] = [
  { id: "users", label: "Users", href: "/users", icon: "users", color: "violet" },
  { id: "settings", label: "Settings", href: "/settings", icon: "settings" },
];
const TENANT_NAV: AppNavItem[] = [
  { id: "maintenance", label: "My requests", href: "/maintenance", home: true, icon: "list-checks", color: "orange" },
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
  const state = useAppState(ready, { isAdmin, isTenant });
  const { path, route, navigate } = useRouter();
  const operationsNav = isAdmin
    ? OPERATIONS
    : OPERATIONS.filter((i) => i.id !== "applications");

  useEffect(() => {
    if (ready) reportLocation(path);
  }, [path, ready]);

  useEffect(() => {
    if (window.location.pathname === "/reset-password") {
      setAuthScreen("reset-confirm");
    }
  }, []);

  useEffect(() => {
    if (!ready || !isTenant) return;
    if (route.name !== "maintenance") {
      navigate("/maintenance");
    }
  }, [ready, isTenant, route.name, navigate]);

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
    return (
      <BlockedPage
        title="Access required"
        message={`Signed in as ${auth.gate.role.role}. This portal is for admin, maintenance staff, or linked tenants. Landlord self-serve comes later.`}
        onLogout={() => void auth.logout()}
      />
    );
  }

  // reset-password while already authenticated (from email link)
  if (authScreen === "reset-confirm" && window.location.pathname === "/reset-password") {
    return (
      <ResetConfirmPage
        error={auth.authError}
        onSubmit={auth.updatePassword}
        onDone={() => {
          window.history.replaceState(null, "", isTenant ? "/maintenance" : "/dashboard");
          setAuthScreen("login");
          navigate(isTenant ? "/maintenance" : "/dashboard");
        }}
      />
    );
  }

  const adminNav = isAdmin ? ADMIN_ITEMS : ADMIN_ITEMS.filter((i) => i.id === "settings");
  const groups = isTenant
    ? [{ items: TENANT_NAV }]
    : [
        { items: PORTFOLIO },
        { label: "Operations", items: operationsNav },
        { label: "Admin", items: adminNav },
      ];

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <div className="flex shrink-0">
          <AppNav
            title={isTenant ? "LG Tenant Portal" : "LG Maintenance Portal"}
            icon="home"
            groups={groups}
            active={activeFor(route)}
            onNavigate={(item) => navigate(item.href ?? (isTenant ? "/maintenance" : "/dashboard"))}
          />
        </div>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-end gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <span>{auth.gate.user.email}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">
              {auth.gate.role.role}
            </span>
            <Button variant="outline" size="sm" onClick={() => void auth.logout()}>
              Sign out
            </Button>
          </div>
          {state.loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Loading…
            </div>
          ) : isTenant ? (
            <>
              {route.name === "maintenance" && <MaintenancePage />}
              {route.name !== "maintenance" && (
                <Placeholder title="Tenant portal" message="Use My requests to submit and track maintenance." />
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
              {route.name === "leases" && <LeasesPage navigate={navigate} />}
              {route.name === "rent" && <RentPage />}
              {route.name === "maintenance" && <MaintenancePage />}
              {route.name === "applications" &&
                (isAdmin ? (
                  <ApplicationsPage />
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
              {route.name === "settings" && <SettingsPage />}
              {route.name === "not-found" && (
                <Placeholder title="Not found" message="That page doesn't exist." />
              )}
            </>
          )}
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
