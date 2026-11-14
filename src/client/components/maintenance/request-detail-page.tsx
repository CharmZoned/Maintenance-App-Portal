import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/page-shell";
import {
  ErrorRetry,
  PriorityChip,
  SkeletonRow,
  StatusChip,
} from "@/components/patterns";
import {
  formatActivityStamp,
  priorityLevel,
  requestNextStep,
  toRequestStatus,
  unitPropertyLabel,
} from "@/lib/request-status";
import { formatDate } from "@/lib/utils";
import type {
  MaintenanceComment,
  MaintenancePhoto,
  MaintenanceStatusEvent,
  WorkOrder,
} from "@/types";
import { WorkOrderDialog } from "./work-order-dialog";
import { MAX_MAINTENANCE_PHOTOS, takePhotoFiles } from "./work-order-status";

/**
 * N3 Request detail — full page (Figma 03 Request). Role chrome differs:
 * admin actions panel, worker sticky Start→Complete, tenant message + photos,
 * landlord read-only thread.
 */
export function RequestDetailPage({
  id,
  navigate,
}: {
  id: number;
  navigate: (to: string) => void;
}) {
  const app = useApp();
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [photos, setPhotos] = useState<MaintenancePhoto[]>([]);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [history, setHistory] = useState<MaintenanceStatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const listWorkOrders = app.listWorkOrders;
  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;
  const setError = app.setError;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listWorkOrders();
      const found = list.find((w) => w.id === id) ?? null;
      setOrder(found);
      if (!found) {
        setPhotos([]);
        setComments([]);
        setHistory([]);
        return;
      }
      const [p, c, h] = await Promise.all([
        listPhotos(id),
        listComments(id),
        listHistory(id),
      ]);
      setPhotos(p);
      setComments(
        app.isLandlord ? c.filter((row) => row.visibility === "tenant_visible") : c,
      );
      setHistory(h);
    } catch (err) {
      const message = (err as Error).message;
      setLoadError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    id,
    listWorkOrders,
    listPhotos,
    listComments,
    listHistory,
    setError,
    app.isLandlord,
  ]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const isWorker = app.canEditWorkOrders && !app.isAdmin;
  const backLabel = app.isTenant
    ? "← Requests"
    : isWorker
      ? "← My jobs"
      : "← Maintenance";

  const status = order ? toRequestStatus(order) : null;
  const nextStep = order ? requestNextStep(order) : undefined;
  const priority = order ? priorityLevel(order.priority) : null;
  const location = order
    ? unitPropertyLabel(order.unit_name, order.property_name)
    : "";
  const reporter = order
    ? [order.tenant_first_name, order.tenant_last_name].filter(Boolean).join(" ") ||
      (app.isTenant ? "You" : "—")
    : "";
  const requestLabel = order
    ? order.request_number
      ? `Request #${order.request_number}`
      : `Request #${order.id}`
    : "Request";

  const timeline = useMemo(() => {
    type TimelineRow = { who: string; when: string; body: string; at: string };
    if (!order) return [] as TimelineRow[];
    const rows: TimelineRow[] = [];
    if (order.description) {
      rows.push({
        who: app.isTenant ? "You" : reporter || "Reporter",
        when: formatActivityStamp(order.created_at),
        body: order.description,
        at: order.created_at,
      });
    }
    for (const ev of history) {
      rows.push({
        who: ev.changed_by_role ? roleLabel(ev.changed_by_role) : "System",
        when: formatActivityStamp(ev.created_at),
        body: ev.note?.trim() || `Status → ${ev.to_status}`,
        at: ev.created_at,
      });
    }
    for (const c of comments) {
      rows.push({
        who: commentAuthor(c, app.isTenant),
        when: formatActivityStamp(c.created_at),
        body: c.body,
        at: c.created_at,
      });
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [order, history, comments, app.isTenant, reporter]);

  async function runStatus(next: WorkOrder["status"], extra?: Parameters<typeof app.updateWorkOrder>[1]) {
    if (!order) return;
    setActionBusy(true);
    try {
      await app.updateWorkOrder(
        order.id,
        { status: next, ...extra },
        { previousStatus: order.status },
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function postComment() {
    if (!order || !commentBody.trim() || app.isLandlord) return;
    setPosting(true);
    try {
      await app.addMaintenanceComment(
        order.id,
        commentBody.trim(),
        app.isTenant ? "tenant_visible" : "tenant_visible",
      );
      setCommentBody("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPosting(false);
    }
  }

  async function onAddPhotos(files: FileList | null) {
    if (!order || app.isLandlord || !files?.length) return;
    const remaining = Math.max(0, MAX_MAINTENANCE_PHOTOS - photos.length);
    const picked = takePhotoFiles(files, remaining);
    if (picked.length === 0) return;
    setPhotoBusy(true);
    try {
      for (const file of picked) {
        await app.uploadMaintenancePhoto(order.id, file);
      }
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="Request" meta="Loading…">
        <div className="space-y-3" aria-busy="true">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell title="Request" meta="Couldn’t load">
        <ErrorRetry message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      </PageShell>
    );
  }

  if (!order) {
    return (
      <PageShell title="Request" meta="Not available">
        <div className="rounded-md border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground">This request isn’t available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed, or you don’t have access.
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => navigate("/maintenance")}>
            Back to list
          </Button>
        </div>
      </PageShell>
    );
  }

  const primaryAdminAction =
    status === "New"
      ? "Assign and schedule"
      : status === "In progress"
        ? "Complete"
        : status === "Assigned"
          ? "Start work"
          : null;

  return (
    <PageShell
      title={requestLabel}
      meta={[order.title, order.unit_name ? `Unit ${order.unit_name}` : null, order.property_name]
        .filter(Boolean)
        .join(" · ")}
      actions={
        app.isAdmin && primaryAdminAction ? (
          <Button
            variant="brand"
            size="header"
            disabled={actionBusy}
            onClick={() => {
              if (primaryAdminAction === "Assign and schedule" || primaryAdminAction === undefined) {
                setEditOpen(true);
              } else if (primaryAdminAction === "Complete") {
                void runStatus("closed");
              } else if (primaryAdminAction === "Start work") {
                void runStatus("in_progress");
              }
            }}
          >
            {primaryAdminAction}
          </Button>
        ) : null
      }
      width="max-w-7xl"
    >
      <button
        type="button"
        onClick={() => navigate("/maintenance")}
        className="text-[13px] font-medium text-brand-text hover:underline"
      >
        {backLabel}
      </button>

      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {status ? <StatusChip status={status} nextStep={nextStep} /> : null}
            {priority ? <PriorityChip level={priority} /> : null}
          </div>

          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Details</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Location" value={location || "—"} />
              <Field
                label={app.isTenant ? "Reported" : "Reported by"}
                value={`${app.isTenant ? "You" : reporter || "—"} · ${formatActivityStamp(order.created_at)}`}
              />
              <Field label="Category" value={order.category || "—"} />
              {(status === "Assigned" || status === "In progress" || app.isTenant) && (
                <Field
                  label="Assigned"
                  value={
                    // Stub: listWorkOrders does not join Staff names yet.
                    order.assigned_staff_id ? "Assigned (staff)" : "Not yet assigned"
                  }
                />
              )}
              <Field
                label="Scheduled"
                value={
                  order.scheduled_at
                    ? formatDate(order.scheduled_at, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })
                    : "—"
                }
              />
            </div>
            {order.description ? (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground">Description</p>
                <p className="mt-1 text-sm text-foreground">{order.description}</p>
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {!app.isLandlord && photos.length < MAX_MAINTENANCE_PHOTOS ? (
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    disabled={photoBusy}
                    onChange={(e) => {
                      void onAddPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex h-11 cursor-pointer items-center justify-center rounded-sm border border-border bg-secondary px-4 text-sm font-medium shadow-edge">
                    {photoBusy ? "Uploading…" : "Add photos"}
                  </span>
                </label>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {photos.length}/{MAX_MAINTENANCE_PHOTOS} photos
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {photos.map((p) =>
                p.url ? (
                  <a
                    key={p.id}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="size-[72px] overflow-hidden rounded-md bg-muted"
                  >
                    <img
                      src={p.url}
                      alt={p.caption || "Photo"}
                      className="size-full object-cover"
                    />
                  </a>
                ) : (
                  <div
                    key={p.id}
                    className="flex size-[72px] items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground"
                  >
                    —
                  </div>
                ),
              )}
              {photos.length === 0 ? (
                <p className="text-xs text-muted-foreground">No photos yet.</p>
              ) : null}
            </div>
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {timeline.map((row, i) => (
                  <li key={`${row.at}-${i}`}>
                    <p className="text-xs font-medium text-muted-foreground">
                      {row.who} · {row.when}
                    </p>
                    <p className="text-[13px] text-foreground">{row.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {!app.isLandlord ? (
              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                <Input
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Send a message…"
                  className="h-8 flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void postComment();
                    }
                  }}
                />
                <Button
                  size="header"
                  disabled={posting || !commentBody.trim()}
                  onClick={() => void postComment()}
                >
                  Send
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Read-only — tenant-visible messages only.
              </p>
            )}
          </section>
        </div>

        {(app.isAdmin || isWorker) && (
          <aside className="w-full shrink-0 space-y-3 rounded-md border border-border bg-card p-4 lg:w-[280px]">
            <h2 className="text-sm font-semibold text-foreground">Actions</h2>
            {app.isAdmin && (
              <>
                <Button
                  className="w-full"
                  disabled={actionBusy}
                  onClick={() => setEditOpen(true)}
                >
                  {status === "New" ? "Assign and schedule" : "Edit / assign"}
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => setEditOpen(true)}
                >
                  Change status
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => setEditOpen(true)}
                >
                  Vendor
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => setEditOpen(true)}
                >
                  Cost
                </Button>
                <Button
                  className="w-full"
                  variant="ghost"
                  disabled={actionBusy}
                  onClick={() => setEditOpen(true)}
                >
                  Edit details
                </Button>
                {/* Delete stays behind edit dialog confirm — no one-click destroy. */}
              </>
            )}
            {isWorker && (
              <>
                {(status === "Assigned" || status === "New") && (
                  <Button
                    className="h-11 w-full"
                    disabled={actionBusy}
                    onClick={() => void runStatus("in_progress")}
                  >
                    Start work
                  </Button>
                )}
                {status === "In progress" && (
                  <Button
                    className="h-11 w-full"
                    disabled={actionBusy}
                    onClick={() => void runStatus("closed")}
                  >
                    Complete
                  </Button>
                )}
                {status !== "On hold" && status !== "Completed" && (
                  <Button
                    className="h-11 w-full"
                    variant="secondary"
                    disabled={actionBusy}
                    onClick={() =>
                      void runStatus("on_hold", {
                        hold_reason: order.hold_reason || "On hold",
                      })
                    }
                  >
                    Put on hold
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Primary advances: Start work → Complete
                </p>
              </>
            )}
          </aside>
        )}
      </div>

      <WorkOrderDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setReloadKey((k) => k + 1);
        }}
        workOrder={order}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </PageShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "maintenance":
      return "Maintenance";
    case "tenant":
      return "Tenant";
    case "landlord":
      return "Landlord";
    case "system":
      return "System";
    default:
      return role;
  }
}

function commentAuthor(
  c: MaintenanceComment,
  isTenantViewer: boolean,
): string {
  if (c.author_role === "tenant") return isTenantViewer ? "You" : "Tenant";
  if (c.author_role === "admin") return "Admin";
  if (c.author_role === "maintenance") return "Maintenance";
  return c.author_role || "Staff";
}
