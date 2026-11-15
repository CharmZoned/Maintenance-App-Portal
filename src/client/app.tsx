import { useEffect, useState } from "react";
import { reportLocation } from "@clawnify/app/client";
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
import { MyJobsPage } from "./components/maintenance/my-jobs-page";
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
import { StubPage } from "./components/stub-page";
import { AccountPage } from "./components/account/account-page";
import { PageShell } from "./components/page-shell";
import { PortalNav, MobileTabBar, ShellChromeProvider } from "./components/chrome";
import { FoundationGalleryPage } from "./components/foundation/foundation-gallery-page";
import { PeoplePage } from "./components/people/people-page";
import { MessagesPage } from "./components/messages/messages-page";
import { NotificationsHost } from "./components/messages/notifications-host";
import { TenantHomePage } from "./components/home/tenant-home-page";
import { LandlordHomePage } from "./components/home/landlord-home-page";
import { navItemsForAudience } from "./lib/portal-nav";
import {
  isLandlordAllowedRoute,
  ROLE_HOME,
  resolveReadyLanding,
  type PortalAudience,
} from "./lib/safe-redirect";

function activeFor(route: Route): string {
  if (route.name === "property") return "properties";
  if (route.name === "tenant" || route.name === "landlords" || route.name === "users") {
    return "people";
  }
  if (route.name === "account") return "account";
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifUnread, setNotifUnread] = useState(false);

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
  // Skip while choosing a new password from a recovery link — clamp would yank
  // /reset-password → role home before the form can submit.
  useEffect(() => {
    if (!ready) return;
    if (window.location.pathname === "/reset-password") return;
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
        title="Your account isn’t set up yet"
        message="You’re signed in, but no portal role is linked yet. Message us and we’ll sort it out. Admins can assign a role on the Users page."
        onRetry={() => void auth.retryRole()}
        retryLabel="Check again"
        onLogout={() => void auth.logout()}
      />
    );
  }

  if (auth.gate.state === "unapproved") {
    const status = auth.gate.role.account_status;
    const emailConfirmed = Boolean(auth.gate.user.email_confirmed_at);
    const blocked =
      status === "pending"
        ? emailConfirmed
          ? {
              title: "Thanks — we’re reviewing your account",
              message:
                "You’ve confirmed your email. We’ll be in touch within one business day once your account is approved. An admin must approve your account before you can use the portal.",
            }
          : {
              title: "Confirm your email",
              message:
                "Check your email for a confirmation link. After you verify, we’ll review your account within one business day. An admin must approve your account before you can use the portal.",
            }
        : status === "suspended"
          ? {
              title: "Your access is paused",
              message:
                "This account has been suspended. Contact Landlord Gopher if you need access restored.",
            }
          : status === "rejected"
            ? {
                title: "We couldn’t approve this account",
                message:
                  "If you think this is a mistake, reply to the email we sent or contact Landlord Gopher and we’ll take another look.",
              }
            : {
                title: "Account not approved",
                message: `Your account status is “${status}”. Contact an admin if you believe this is a mistake. After they change your status, use Check again.`,
              };
    return (
      <BlockedPage
        title={blocked.title}
        message={blocked.message}
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
        title="Your account isn’t set up yet"
        message={`Signed in as ${role}. ${hint}`}
        onRetry={() => void auth.retryRole()}
        retryLabel="Check again"
        onLogout={() => void auth.logout()}
      />
    );
  }

  const audience: PortalAudience = isTenant
    ? "tenant"
    : isLandlord
      ? "landlord"
      : isMaintenance
        ? "maintenance"
        : "staff";

  const homePath = ROLE_HOME[audience];

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

  const navItems = navItemsForAudience(audience);
  const useMobileTabs = audience !== "staff";
  const metaFullName = auth.gate.user.user_metadata?.full_name;
  const chrome = {
    email: auth.gate.user.email ?? "",
    role: auth.gate.role.role,
    displayName:
      typeof metaFullName === "string" && metaFullName.trim() ? metaFullName.trim() : null,
    unread: notifUnread,
    onNotifications: () => setNotificationsOpen((v) => !v),
    onAccount: () => navigate("/account"),
    onSignOut: () => void auth.logout(),
  };

  return (
    <AppContext.Provider value={state}>
      <ShellChromeProvider value={chrome}>
        <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
          <div className={useMobileTabs ? "hidden shrink-0 md:flex" : "flex shrink-0"}>
            <PortalNav
              items={navItems}
              active={activeFor(route)}
              homeHref={homePath}
              onNavigate={(href) => navigate(href)}
            />
          </div>
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Pages keep their own list loaders — do not blank the shell while lookups finish. */}
            <PortalErrorBoundary>
              {isTenant ? (
                <>
                  {route.name === "home" && <TenantHomePage navigate={navigate} />}
                  {route.name === "maintenance" && (
                    <MaintenancePage search={search} replace={replace} />
                  )}
                  {route.name === "messages" && (
                    <MessagesPage search={search} navigate={navigate} replace={replace} />
                  )}
                  {route.name === "documents" && <TenantDocumentsPage />}
                  {route.name === "account" && (
                    <AccountPage
                      userId={auth.gate.user.id}
                      email={auth.gate.user.email ?? ""}
                      role={auth.gate.role.role}
                      onSignOut={() => void auth.logout()}
                    />
                  )}
                  {route.name !== "home" &&
                    route.name !== "maintenance" &&
                    route.name !== "messages" &&
                    route.name !== "documents" &&
                    route.name !== "account" && (
                      <Placeholder
                        title="Tenant portal"
                        message="Use Requests to submit and track maintenance."
                      />
                    )}
                </>
              ) : isLandlord ? (
                <>
                  {route.name === "home" && <LandlordHomePage navigate={navigate} />}
                  {route.name === "properties" && <PropertiesList navigate={navigate} />}
                  {route.name === "property" && <PropertyPage id={route.id} navigate={navigate} />}
                  {route.name === "maintenance" && (
                    <MaintenancePage search={search} replace={replace} />
                  )}
                  {route.name === "messages" && (
                    <MessagesPage search={search} navigate={navigate} replace={replace} />
                  )}
                  {route.name === "documents" && <LandlordDocumentsPage />}
                  {route.name === "account" && (
                    <AccountPage
                      userId={auth.gate.user.id}
                      email={auth.gate.user.email ?? ""}
                      role={auth.gate.role.role}
                      onSignOut={() => void auth.logout()}
                    />
                  )}
                  {!isLandlordAllowedRoute(route) && (
                    <Placeholder
                      title="Landlord portal"
                      message="View your properties, maintenance, and documents. Editing lands in later screen PRs."
                    />
                  )}
                </>
              ) : isMaintenance ? (
                <>
                  {route.name === "maintenance" && (
                    <MyJobsPage search={search} replace={replace} />
                  )}
                  {route.name === "messages" && (
                    <MessagesPage search={search} navigate={navigate} replace={replace} />
                  )}
                  {route.name === "calendar" && <CalendarPage navigate={navigate} />}
                  {route.name === "account" && (
                    <AccountPage
                      userId={auth.gate.user.id}
                      email={auth.gate.user.email ?? ""}
                      role={auth.gate.role.role}
                      onSignOut={() => void auth.logout()}
                    />
                  )}
                  {route.name !== "maintenance" &&
                    route.name !== "messages" &&
                    route.name !== "calendar" &&
                    route.name !== "account" && (
                      <Placeholder title="My jobs" message="Use My jobs or Messages from the menu." />
                    )}
                </>
              ) : (
                <>
                  {route.name === "dashboard" && <DashboardPage navigate={navigate} />}
                  {route.name === "properties" && <PropertiesList navigate={navigate} />}
                  {route.name === "property" && <PropertyPage id={route.id} navigate={navigate} />}
                  {route.name === "people" && (
                    <PeoplePage search={search} navigate={navigate} replace={replace} />
                  )}
                  {route.name === "messages" && (
                    <MessagesPage search={search} navigate={navigate} replace={replace} />
                  )}
                  {route.name === "documents" && (
                    <StubPage
                      title="Documents"
                      meta="Portfolio files"
                      message="Admin documents land in a later Lists screen PR."
                    />
                  )}
                  {route.name === "account" && (
                    <AccountPage
                      userId={auth.gate.user.id}
                      email={auth.gate.user.email ?? ""}
                      role={auth.gate.role.role}
                      onSignOut={() => void auth.logout()}
                    />
                  )}
                  {route.name === "foundation" && isAdmin && <FoundationGalleryPage />}
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
            <NotificationsHost
              open={notificationsOpen}
              onOpenChange={setNotificationsOpen}
              onUnreadChange={setNotifUnread}
              onNavigate={(to) => {
                setNotificationsOpen(false);
                navigate(to);
              }}
            />
            {useMobileTabs ? (
              <MobileTabBar
                items={navItems}
                active={activeFor(route)}
                onNavigate={(href) => navigate(href)}
              />
            ) : null}
          </main>
          <ErrorBanner />
          <NoticeBanner />
        </div>
      </ShellChromeProvider>
    </AppContext.Provider>
  );
}

function Placeholder({ title, message }: { title: string; message: string }) {
  return (
    <PageShell title={title}>
      <p className="text-sm text-muted-foreground">{message}</p>
    </PageShell>
  );
}
