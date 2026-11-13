import { useEffect, useState } from "react";
import { AppNav, reportLocation, type AppNavItem } from "@clawnify/app/client";
import { useAppState } from "./hooks/use-app-state";
import { useAuth } from "./hooks/use-auth";
import { useRouter, type Route } from "./hooks/use-router";
import { AppContext } from "./context";
import { ErrorBanner } from "./components/error-banner";
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
];
const ADMIN: AppNavItem[] = [
  { id: "settings", label: "Settings", href: "/settings", icon: "settings" },
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
  const state = useAppState(ready, { isAdmin });
  const { path, route, navigate } = useRouter();

  useEffect(() => {
    if (ready) reportLocation(path);
  }, [path, ready]);

  useEffect(() => {
    if (window.location.pathname === "/reset-password") {
      setAuthScreen("reset-confirm");
    }
  }, []);

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
        message="Your account is signed in but has no portal role yet. Ask an admin to run private.assign_admin for your email, or link a Staff row."
        onLogout={() => void auth.logout()}
      />
    );
  }

  if (auth.gate.state === "unapproved") {
    const status = auth.gate.role.account_status;
    return (
      <BlockedPage
        title="Account not approved"
        message={`Your account status is “${status}”. An admin must approve your account before you can use the portal.`}
        onLogout={() => void auth.logout()}
      />
    );
  }

  if (auth.gate.state === "forbidden") {
    return (
      <BlockedPage
        title="Staff access required"
        message={`Signed in as ${auth.gate.role.role}. This portal is for admin and maintenance staff. Tenant/landlord portals come in later phases.`}
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
          window.history.replaceState(null, "", "/dashboard");
          setAuthScreen("login");
          navigate("/dashboard");
        }}
      />
    );
  }

  const groups = [
    { items: PORTFOLIO },
    { label: "Operations", items: OPERATIONS },
    { label: "Admin", items: ADMIN },
  ];

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <div className="flex shrink-0">
          <AppNav
            title="LG Maintenance Portal"
            icon="home"
            groups={groups}
            active={activeFor(route)}
            onNavigate={(item) => navigate(item.href ?? "/dashboard")}
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
              {route.name === "settings" && <SettingsPage />}
              {route.name === "not-found" && (
                <Placeholder title="Not found" message="That page doesn't exist." />
              )}
            </>
          )}
        </main>
        <ErrorBanner />
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
