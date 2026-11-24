import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/context";
import { useShellChrome } from "@/components/chrome/shell-chrome-context";
import { WorkOrderDialog } from "@/components/maintenance/work-order-dialog";
import { PropertyDialog } from "@/components/properties/property-dialog";
import { TenantDialog } from "@/components/tenants/tenant-dialog";
import { AdminUploadDocumentDialog } from "@/components/documents/admin-upload-document-dialog";
import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import { formatDayShort, toDay } from "@/lib/admin-dates";
import { AdminDashboardView } from "./admin-dashboard-view";
import type { DashboardNoticeModel } from "./admin-dashboard-model";
import type { QuickAddActionId } from "./quick-add-menu";

/** How long the "Dashboard refreshed" strip stays up. */
const NOTICE_MS = 8_000;

type OpenDialog = "request" | "property" | "tenant" | "document" | null;

/**
 * Admin Dashboard (Figma "001 - Admin Pages" · AH — Dashboard).
 *
 * Container: loads the view model, owns the short create dialogs opened from
 * "New request" and "Quick add", and reports a refresh after a save. Layout
 * lives in `AdminDashboardView`; wording and data in `lib/admin-dashboard.ts`.
 */
export function DashboardPage({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const chrome = useShellChrome();
  const { intro, state, reload } = useAdminDashboard({
    displayName: chrome?.displayName ?? null,
    email: chrome?.email ?? "",
    role: chrome?.role ?? "",
  });
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [notice, setNotice] = useState<DashboardNoticeModel | null>(null);

  const noticeTimer = useRef<number | null>(null);
  const showNotice = useCallback((next: DashboardNoticeModel) => {
    if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    setNotice(next);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  /** After a save: re-read everything and say so, or say that it could not be re-read. */
  const refreshAfterSave = useCallback(async () => {
    const ok = await reload();
    showNotice(
      ok
        ? {
            tone: "success",
            message: `Success · Dashboard refreshed. Portfolio is up to date as of just now, ${formatDayShort(toDay(new Date()))}.`,
          }
        : {
            tone: "error",
            message:
              "Error · Your change was saved, but the dashboard couldn’t refresh. Reload the page to see the latest data.",
          },
    );
  }, [reload, showNotice]);

  const closeDialog = useCallback((open: boolean) => {
    if (!open) setDialog(null);
  }, []);

  const onQuickAdd = useCallback(
    (actionId: string) => {
      switch (actionId as QuickAddActionId) {
        case "add-property":
          setDialog("property");
          break;
        case "add-tenant":
          setDialog("tenant");
          break;
        // Payments are recorded against a charge, so start from the rent roll.
        case "record-payment":
          navigate("/rent");
          break;
        case "upload-document":
          setDialog("document");
          break;
        case "new-message":
          navigate("/messages");
          break;
      }
    },
    [navigate],
  );

  return (
    <>
      <AdminDashboardView
        intro={intro}
        state={state}
        notice={notice}
        canCreateRequest={app.canCreateWorkOrders}
        onNavigate={navigate}
        onNewRequest={() => setDialog("request")}
        onQuickAdd={onQuickAdd}
        onRetry={() => void reload()}
        onAddProperty={() => setDialog("property")}
      />

      <WorkOrderDialog
        open={dialog === "request"}
        onOpenChange={closeDialog}
        onSaved={() => void refreshAfterSave()}
      />
      {/* Saving a property updates the shell's list, which reloads the dashboard on its own. */}
      <PropertyDialog open={dialog === "property"} onOpenChange={closeDialog} />
      <TenantDialog
        open={dialog === "tenant"}
        onOpenChange={closeDialog}
        onSaved={() => void refreshAfterSave()}
      />
      <AdminUploadDocumentDialog
        open={dialog === "document"}
        onOpenChange={closeDialog}
        onUploaded={() => void refreshAfterSave()}
      />
    </>
  );
}
