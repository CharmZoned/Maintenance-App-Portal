import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/context";
import { LandlordPageIntro, LandlordPropertyHeading } from "@/components/landlord";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageShell } from "@/components/page-shell";
import {
  ErrorRetry,
  PriorityChip,
  SkeletonRow,
  StatusChip,
  type RequestStatus,
} from "@/components/patterns";
import { formatDocumentDate } from "@/lib/landlord-documents";
import { workOrderStatusFromDb } from "@/lib/mappers";
import {
  formatActivityStamp,
  priorityLevel,
  requestNextStep,
  toRequestStatus,
  unitPropertyLabel,
} from "@/lib/request-status";
import { cn, formatDate, toIsoDate } from "@/lib/utils";
import type {
  CommentVisibility,
  MaintenanceComment,
  MaintenancePhoto,
  MaintenanceStatusEvent,
  WorkOrder,
  WorkOrderStatus,
} from "@/types";
import { WorkOrderDialog } from "./work-order-dialog";
import { TenantRequestDetailPanel } from "./tenant-request-detail-panel";
import { photoSlotsLeft, takePhotoFiles } from "./work-order-status";

type CompanionKind = "complete" | "hold" | null;

/**
 * N3 Request detail — full page (Figma 03 Request). Role chrome differs:
 * admin actions panel, worker sticky Start→Complete, tenant message + photos,
 * landlord read-only detail (Figma LRQ). Landlord comments stay tenant_visible.
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
  const [commentVisibleToTenant, setCommentVisibleToTenant] = useState(false);
  const [posting, setPosting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [companion, setCompanion] = useState<CompanionKind>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");

  const listWorkOrders = app.listWorkOrders;
  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;
  const setError = app.setError;
  const isLandlord = app.isLandlord;

  // Still uses listWorkOrders (no single-id API); ignore stale results if id changes mid-flight.
  useEffect(() => {
    let cancelled = false;
    const loadId = id;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await listWorkOrders();
        if (cancelled) return;
        const found = list.find((w) => w.id === loadId) ?? null;
        if (!found) {
          setOrder(null);
          setPhotos([]);
          setComments([]);
          setHistory([]);
          return;
        }
        const [p, c, h] = await Promise.all([
          listPhotos(loadId),
          listComments(loadId),
          listHistory(loadId),
        ]);
        if (cancelled) return;
        setOrder(found);
        setPhotos(p);
        setComments(
          isLandlord ? c.filter((row) => row.visibility === "tenant_visible") : c,
        );
        setHistory(h);
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message;
        setLoadError(message);
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    id,
    reloadKey,
    listWorkOrders,
    listPhotos,
    listComments,
    listHistory,
    setError,
    isLandlord,
  ]);

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
    ? unitPropertyLabel(order.unit_name, order.property_name) ||
      (app.isTenant ? "Your home" : "—")
    : "";
  // unitPropertyLabel returns "Your home" for empty — override for staff/landlord.
  const locationDisplay =
    order &&
    !order.unit_name?.trim() &&
    !order.property_name?.trim() &&
    !app.isTenant
      ? "—"
      : location;
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
    type TimelineRow = {
      who: string;
      when: string;
      body: string;
      at: string;
      visibility?: CommentVisibility;
    };
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
        visibility: c.visibility,
      });
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [order, history, comments, app.isTenant, reporter]);

  async function runStatus(
    next: WorkOrder["status"],
    extra?: Parameters<typeof app.updateWorkOrder>[1],
  ) {
    if (!order) return;
    setActionBusy(true);
    try {
      await app.updateWorkOrder(
        order.id,
        { status: next, ...extra },
        { previousStatus: order.status },
      );
      setCompanion(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  function openComplete() {
    setResolutionNotes(order?.resolution_notes?.trim() || "");
    setCompanion("complete");
  }

  function openHold() {
    setHoldReason(order?.hold_reason?.trim() || "");
    setFollowUpDate(
      order?.next_follow_up_date?.slice(0, 10) || toIsoDate(new Date()),
    );
    setCompanion("hold");
  }

  async function confirmCompanion() {
    if (companion === "complete") {
      const notes = resolutionNotes.trim();
      if (!notes) {
        setError("Closing requires resolution notes.");
        return;
      }
      await runStatus("closed", { resolution_notes: notes });
      return;
    }
    if (companion === "hold") {
      const reason = holdReason.trim();
      if (!reason) {
        setError("On hold requires a reason.");
        return;
      }
      if (!followUpDate) {
        setError("On hold requires a follow-up date.");
        return;
      }
      await runStatus("on_hold", {
        hold_reason: reason,
        next_follow_up_date: followUpDate,
      });
    }
  }

  async function postComment() {
    if (!order || !commentBody.trim() || app.isLandlord) return;
    setPosting(true);
    try {
      const visibility: CommentVisibility = app.isTenant
        ? "tenant_visible"
        : commentVisibleToTenant
          ? "tenant_visible"
          : "internal";
      await app.addMaintenanceComment(order.id, commentBody.trim(), visibility);
      setCommentBody("");
      if (!app.isTenant) setCommentVisibleToTenant(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPosting(false);
    }
  }

  async function onAddPhotos(files: FileList | null) {
    if (!order || app.isLandlord || !files?.length) return;
    const picked = takePhotoFiles(files, photoSlotsLeft(photos, isWorker));
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

  if (app.isLandlord) {
    return (
      <LandlordRequestDetail
        loading={loading}
        loadError={loadError}
        order={order}
        photos={photos}
        comments={comments}
        history={history}
        onRetry={() => setReloadKey((k) => k + 1)}
        navigate={navigate}
      />
    );
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

  // Tenant full-page detail — text + chips panel (Figma Requests detail).
  if (app.isTenant) {
    return (
      <PageShell
        title={requestLabel}
        meta={[order.title, order.unit_name ? `Unit ${order.unit_name}` : null, order.property_name]
          .filter(Boolean)
          .join(" · ")}
        width="max-w-3xl"
      >
        <button
          type="button"
          onClick={() => navigate("/maintenance")}
          className="text-[13px] font-medium text-brand-text hover:underline"
        >
          ← Requests
        </button>
        <div className="mt-4">
          <TenantRequestDetailPanel
            order={order}
            navigate={navigate}
            extras={{ photos, comments, history }}
          />
        </div>
        <aside
          className="mt-6 rounded-sm bg-warning-tint px-5 py-4 text-sm text-warning"
          role="note"
        >
          Immediate danger? Contact local emergency services. Do not wait for a portal
          response.
        </aside>
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
              if (primaryAdminAction === "Assign and schedule") {
                setEditOpen(true);
              } else if (primaryAdminAction === "Complete") {
                openComplete();
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
              <Field label="Location" value={locationDisplay || "—"} />
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
              {!app.isLandlord && photoSlotsLeft(photos, isWorker) > 0 ? (
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
                {photos.length} {photos.length === 1 ? "photo" : "photos"}
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
                    <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                      <span>
                        {row.who} · {row.when}
                      </span>
                      {!app.isTenant && row.visibility ? (
                        <Badge variant="outline">
                          {row.visibility === "internal"
                            ? "Internal"
                            : "Tenant visible"}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-[13px] text-foreground">{row.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {!app.isLandlord ? (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-2">
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
                {!app.isTenant ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={commentVisibleToTenant}
                      onChange={(e) => setCommentVisibleToTenant(e.target.checked)}
                    />
                    Visible to tenant
                  </label>
                ) : null}
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
                    onClick={openComplete}
                  >
                    Complete
                  </Button>
                )}
                {status === "On hold" && (
                  <Button
                    className="h-11 w-full"
                    disabled={actionBusy}
                    onClick={() => void runStatus("in_progress")}
                  >
                    Resume
                  </Button>
                )}
                {status !== "On hold" && status !== "Completed" && (
                  <Button
                    className="h-11 w-full"
                    variant="secondary"
                    disabled={actionBusy}
                    onClick={openHold}
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
          // Single refresh path on close — picks up dialog comments/photos
          // (those don't call onSaved) without double-loading after Save.
          if (!o) setReloadKey((k) => k + 1);
        }}
        workOrder={order}
      />

      <Dialog
        open={companion != null}
        onOpenChange={(o) => {
          if (!o) setCompanion(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {companion === "complete" ? "Complete request" : "Put on hold"}
            </DialogTitle>
          </DialogHeader>
          {companion === "complete" ? (
            <div className="grid gap-2">
              <Label htmlFor="resolution-notes">Resolution notes</Label>
              <Textarea
                id="resolution-notes"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={3}
                placeholder="What fixed it?"
              />
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="hold-reason">Hold reason</Label>
                <Input
                  id="hold-reason"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="Waiting on parts…"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="follow-up-date">Follow-up date</Label>
                <Input
                  id="follow-up-date"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCompanion(null)} disabled={actionBusy}>
              Cancel
            </Button>
            <Button
              disabled={
                actionBusy ||
                (companion === "complete"
                  ? !resolutionNotes.trim()
                  : !holdReason.trim() || !followUpDate)
              }
              onClick={() => void confirmCompanion()}
            >
              {companion === "complete" ? "Complete" : "Put on hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

/**
 * Landlord request detail (Figma LRQ 2048:4352 desktop, 2048:4464 completed,
 * 2048:4581 phone, plus loading 2048:7074 and not-available 2048:7148).
 *
 * Read-only. The timeline is the public status trail plus tenant_visible
 * comments. The landlord–staff thread and its composer stay off this screen.
 */
export function LandlordRequestDetail({
  loading,
  loadError,
  order,
  photos,
  comments,
  history,
  onRetry,
  navigate,
}: {
  loading: boolean;
  loadError: string | null;
  order: WorkOrder | null;
  photos: MaintenancePhoto[];
  comments: MaintenanceComment[];
  history: MaintenanceStatusEvent[];
  onRetry: () => void;
  navigate: (to: string) => void;
}) {
  const requestNumber = order ? requestNumberLabel(order) : undefined;

  if (loading) {
    return (
      <LandlordRequestShell requestNumber={requestNumber}>
        <BackToMaintenance navigate={navigate} />
        <div className="flex flex-col gap-3" aria-busy="true">
          <Bone className="h-3 w-24" />
          <Bone className="h-8 w-full max-w-md md:h-9" />
          <Bone className="h-6 w-28" />
          <Bone className="h-3 w-full max-w-sm" />
        </div>
        <div className="rounded-md border border-border bg-card p-4 md:p-6">
          <Bone className="h-4 w-28" />
          <div className="mt-4 space-y-4">
            {Array.from({ length: 7 }, (_, index) => (
              <div
                key={index}
                className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-3 md:grid-cols-[9.25rem_minmax(0,1fr)]"
              >
                <Bone className="h-2.5 w-16" />
                <Bone className="h-2.5 max-w-xs" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card p-4 md:p-6">
          <Bone className="h-4 w-24" />
          <div className="mt-4 flex gap-3">
            <Bone className="size-24 md:size-[7.5rem]" />
            <Bone className="size-24 md:size-[7.5rem]" />
          </div>
        </div>
      </LandlordRequestShell>
    );
  }

  if (loadError) {
    return (
      <LandlordRequestShell>
        <BackToMaintenance navigate={navigate} />
        <section className="rounded-md border border-border bg-card p-5 md:p-8" role="alert">
          <h2 className="lg-heading text-foreground">Couldn’t load this request</h2>
          <p className="mt-2 lg-body text-muted-foreground">{loadError}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button className="h-11 w-full sm:w-auto" onClick={onRetry}>
              Retry
            </Button>
            <Button
              variant="secondary"
              className="h-11 w-full sm:w-auto"
              onClick={() => navigate("/maintenance")}
            >
              Back to Maintenance
            </Button>
          </div>
        </section>
      </LandlordRequestShell>
    );
  }

  if (!order) {
    return (
      <LandlordRequestShell>
        <BackToMaintenance navigate={navigate} />
        <section className="rounded-md border border-border bg-card p-5 md:p-8">
          <div
            className="flex size-12 items-center justify-center rounded-xl bg-muted lg-section text-muted-foreground"
            aria-hidden
          >
            ?
          </div>
          <h2 className="mt-4 lg-heading text-foreground">This request isn’t available</h2>
          <p className="mt-2 max-w-xl lg-body text-muted-foreground">
            It may have been removed, or it’s no longer linked to one of your properties. If you
            think this is a mistake, message Landlord Gopher.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button className="h-11 w-full sm:w-auto" onClick={() => navigate("/maintenance")}>
              Back to Maintenance
            </Button>
            <Button
              variant="secondary"
              className="h-11 w-full sm:w-auto"
              onClick={() => navigate("/messages")}
            >
              Message Landlord Gopher
            </Button>
          </div>
        </section>
      </LandlordRequestShell>
    );
  }

  const status = toRequestStatus(order);
  const reporter = personName(order.tenant_first_name, order.tenant_last_name);
  const caption = landlordStatusCaption(order);
  const priority = priorityLevel(order.priority);
  const completed = status === "Completed";
  const priceLine = costLine(order);
  const showCost = completed && priceLine.length > 0;
  const completedWhen = order.completed_at ? formatDocumentDate(order.completed_at) : "";
  const timeline = landlordTimeline(order, history, comments, reporter);
  const rows = detailRows(order, reporter, completed);

  return (
    <LandlordRequestShell requestNumber={requestNumber}>
      <div className="flex flex-col gap-3">
        <BackToMaintenance navigate={navigate} />
        <div className="flex flex-col gap-2">
          <LandlordPageIntro eyebrow={requestNumber ?? "Request"} title={order.title} />
          <div className="flex flex-col items-start gap-2 md:flex-row md:gap-4">
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span
                className={cn(
                  "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium",
                  HEADER_CHIP[status],
                )}
              >
                {status}
              </span>
              {caption ? <p className="lg-caption text-muted-foreground">{caption}</p> : null}
            </div>
            {priority ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  priority === "Emergency"
                    ? "bg-destructive-tint text-destructive"
                    : "bg-warning-tint text-warning",
                )}
              >
                {priority === "Emergency" ? "Emergency" : "High priority"}
              </span>
            ) : null}
          </div>
          <p className="lg-body text-muted-foreground">{contextLine(order, reporter)}</p>
        </div>
      </div>

      <section className="rounded-md border border-border bg-card p-4 md:p-6">
        <LandlordPropertyHeading name="Details" />
        {showCost ? (
          <div className="mt-4 rounded-sm bg-success-tint px-4 py-3">
            <p className="lg-label uppercase text-muted-foreground">
              {completedWhen ? `Cost · Completed ${completedWhen}` : "Cost · Completed"}
            </p>
            <p className="lg-section text-foreground">{priceLine}</p>
          </div>
        ) : null}
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-baseline gap-x-3 md:grid-cols-[9.25rem_minmax(0,1fr)]"
            >
              <p className="lg-caption text-muted-foreground">{row.label}</p>
              <p className="lg-body min-w-0 text-foreground">{row.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4 md:p-6">
        <LandlordPropertyHeading name={`Photos · ${photos.length}`} />
        {photos.length === 0 ? (
          <p className="mt-4 lg-body text-muted-foreground">No photos yet.</p>
        ) : (
          <>
            <ul className="mt-4 flex flex-wrap gap-3">
              {photos.map((photo, index) => (
                <li key={photo.id}>
                  {photo.url ? (
                    <a
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block size-24 overflow-hidden rounded-sm border border-border bg-muted md:size-[7.5rem]"
                    >
                      <img
                        src={photo.url}
                        alt={photo.caption?.trim() || `Photo ${index + 1}`}
                        className="size-full object-cover"
                      />
                    </a>
                  ) : (
                    <div className="flex size-24 items-center justify-center rounded-sm border border-border bg-muted lg-caption text-muted-foreground md:size-[7.5rem]">
                      Photo {index + 1}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {photos.some((photo) => photo.url) ? (
              <p className="mt-3 lg-caption text-muted-foreground">Tap a photo to see it full size.</p>
            ) : null}
          </>
        )}
      </section>

      <section className="rounded-md border border-border bg-card p-4 md:p-6">
        <LandlordPropertyHeading name="Status timeline" />
        {timeline.length === 0 ? (
          <p className="mt-4 lg-body text-muted-foreground">No updates on this request yet.</p>
        ) : (
          <ol className="mt-4">
            {timeline.map((item, index) => {
              const last = index === timeline.length - 1;
              return (
                <li key={item.key} className="relative flex gap-4">
                  {last ? null : (
                    <span className="absolute bottom-0 left-[5px] top-3 w-0.5 bg-border" aria-hidden />
                  )}
                  <span
                    className={cn(
                      "relative z-10 mt-1.5 size-3 shrink-0 rounded-full",
                      last ? "bg-brand" : "bg-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <div className={cn("min-w-0", last ? "" : "pb-4")}>
                    {item.status ? (
                      <Badge variant={timelineBadgeVariant(item.status)}>{item.status}</Badge>
                    ) : null}
                    <p className={cn("lg-body-medium text-foreground", item.status ? "mt-1.5" : "")}>
                      {item.body}
                    </p>
                    <p className="lg-caption text-muted-foreground">{item.when}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </LandlordRequestShell>
  );
}

function LandlordRequestShell({
  requestNumber,
  children,
}: {
  requestNumber?: string;
  children: ReactNode;
}) {
  const crumb = requestNumber
    ? `Landlord portal / Maintenance / ${requestNumber}`
    : "Landlord portal / Maintenance";
  return (
    <PageShell
      title={
        <>
          <span className="lg-body font-medium md:hidden">{requestNumber ?? "Maintenance"}</span>
          <span className="lg-body hidden font-medium md:inline">{crumb}</span>
        </>
      }
      width="max-w-[45rem]"
    >
      <div className="flex flex-col gap-5">{children}</div>
    </PageShell>
  );
}

function BackToMaintenance({ navigate }: { navigate: (to: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => navigate("/maintenance")}
      className="-ml-2 inline-flex h-11 items-center rounded-sm px-2 text-sm font-medium text-brand-text hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      ‹ Maintenance
    </button>
  );
}

function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-xs bg-muted motion-safe:animate-pulse", className)} aria-hidden />;
}

const HEADER_CHIP: Record<RequestStatus, string> = {
  New: "bg-info-tint text-info",
  Assigned: "bg-brand-tint text-brand-text",
  "In progress": "bg-warning-tint text-warning",
  "On hold": "bg-muted text-muted-foreground shadow-edge",
  Completed: "bg-success-tint text-success",
};

function timelineBadgeVariant(
  status: RequestStatus,
): "info" | "warning" | "success" | "neutral" {
  switch (status) {
    case "In progress":
      return "warning";
    case "On hold":
      return "neutral";
    case "Completed":
      return "success";
    default:
      return "info";
  }
}

type LandlordTimelineItem = {
  key: string;
  at: string;
  seq: number;
  status?: RequestStatus;
  body: string;
  when: string;
};

function landlordTimeline(
  order: WorkOrder,
  history: MaintenanceStatusEvent[],
  comments: MaintenanceComment[],
  reporter: string,
): LandlordTimelineItem[] {
  const items: LandlordTimelineItem[] = [
    {
      key: "reported",
      at: order.created_at,
      seq: 0,
      status: "New",
      body: reporter ? `${reporter} reported this` : "Request reported",
      when: timelineWhen(order.created_at),
    },
  ];

  for (const ev of history) {
    if (ev.from_status == null || ev.note?.trim().toLowerCase() === "created") continue;
    const db = workOrderStatusFromDb(ev.to_status);
    const actor = roleLabel(ev.changed_by_role || "") || "Landlord Gopher";
    const stamp = timelineWhen(ev.created_at);
    items.push({
      key: `status-${ev.id}`,
      at: ev.created_at,
      seq: 1,
      status: historyBadge(db, order),
      body: historyBody(db, order, actor),
      when: db === "scheduled" ? `${actor} · ${stamp}` : stamp,
    });
  }

  for (const comment of comments) {
    if (comment.visibility !== "tenant_visible") continue;
    items.push({
      key: `comment-${comment.id}`,
      at: comment.created_at,
      seq: 2,
      body: comment.body,
      when: `${commentWho(comment, reporter)} · ${timelineWhen(comment.created_at)}`,
    });
  }

  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
}

function historyBadge(db: WorkOrderStatus, order: WorkOrder): RequestStatus {
  switch (db) {
    case "closed":
      return "Completed";
    case "on_hold":
      return "On hold";
    case "in_progress":
      return "In progress";
    case "scheduled":
      return "Assigned";
    default:
      return order.assigned_staff_id ? "Assigned" : "New";
  }
}

function historyBody(db: WorkOrderStatus, order: WorkOrder, actor: string): string {
  const vendor = order.vendor_name?.trim() ?? "";
  switch (db) {
    case "scheduled": {
      const when = order.scheduled_at ? formatDocumentDate(order.scheduled_at) : "";
      if (when) return `Visit scheduled for ${when}`;
      return vendor ? `${actor} assigned ${vendor}` : "Scheduled";
    }
    case "in_progress":
      return vendor ? `${vendor} started work` : "Work started";
    case "on_hold":
      return order.hold_reason?.trim() || "Put on hold";
    case "closed": {
      const parts = [
        order.resolution_notes?.trim(),
        order.landlord_price != null ? formatLandlordPrice(order.landlord_price) : "",
        vendor,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : "Completed";
    }
    default:
      if (vendor) return `${actor} assigned ${vendor}`;
      if (order.assigned_staff_id) return `${actor} assigned this request`;
      return "Opened again";
  }
}

function detailRows(
  order: WorkOrder,
  reporter: string,
  completed: boolean,
): { label: string; value: string }[] {
  const where = placeLine(order) || "—";
  const rows: { label: string; value: string }[] = [
    { label: "Category", value: order.category?.trim() || "—" },
    { label: "Where", value: where },
    { label: "Description", value: order.description?.trim() || "—" },
    { label: "Priority", value: priorityWord(order.priority) },
  ];
  if (!completed) rows.push({ label: "Entry", value: entryValue(order) });
  rows.push({ label: "Assigned to", value: assignedValue(order) });
  if (completed) {
    rows.push({
      label: "Completed",
      value: order.completed_at ? formatDocumentDate(order.completed_at) || "—" : "—",
    });
    const price = costLine(order);
    if (price) rows.push({ label: "Cost", value: price });
  } else {
    rows.push({
      label: "Scheduled",
      value: order.scheduled_at ? formatDocumentDate(order.scheduled_at) || "—" : "—",
    });
  }
  rows.push({ label: "Reported by", value: reportedValue(reporter, order.created_at) });
  return rows;
}

function landlordStatusCaption(order: WorkOrder): string | undefined {
  const status = toRequestStatus(order);
  const vendor = order.vendor_name?.trim() ?? "";
  if (status === "New") return "Needs assignment";
  if (status === "Assigned") {
    const when = order.scheduled_at ? formatDocumentDate(order.scheduled_at) : "";
    if (vendor && when) return `${vendor} · visit ${when}`;
    if (vendor) return vendor;
    if (when) return `Visit ${when}`;
    if (order.assigned_staff_id) return "Assigned to maintenance";
    return "Assigned";
  }
  if (status === "In progress") return "Work in progress";
  if (status === "On hold") return requestNextStep(order);
  const when = order.completed_at ? formatDocumentDate(order.completed_at) : "";
  const tail = costLine(order);
  if (when && tail) return `Completed ${when} · ${tail}`;
  if (when) return `Completed ${when}`;
  if (tail) return tail;
  return "Completed";
}

function requestNumberLabel(order: WorkOrder): string {
  const raw = order.request_number?.trim();
  if (!raw) return `#${order.id}`;
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function personName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Vendor name when the request has one. Staff display names are not on the work order. */
function assigneeLabel(order: WorkOrder): string {
  const vendor = order.vendor_name?.trim();
  if (vendor) return vendor;
  if (order.assigned_staff_id) return "Maintenance";
  return "";
}

function assignedValue(order: WorkOrder): string {
  return assigneeLabel(order) || "Not yet assigned";
}

function entryValue(order: WorkOrder): string {
  if (!order.permission_to_enter) return "Please schedule first";
  const first = order.tenant_first_name?.trim();
  if (first) return `OK to enter if ${first} isn’t home`;
  return "OK to enter if no one is home";
}

function placeLine(order: WorkOrder): string {
  if (!order.unit_name?.trim() && !order.property_name?.trim()) return "";
  const place = unitPropertyLabel(order.unit_name, order.property_name);
  return place === "Your home" ? "" : place;
}

function contextLine(order: WorkOrder, reporter: string): string {
  const place = placeLine(order);
  const when = formatDocumentDate(order.created_at);
  const reported = reporter
    ? when
      ? `Reported by ${reporter}, ${when}`
      : `Reported by ${reporter}`
    : "";
  return [place, reported].filter(Boolean).join(" · ") || "—";
}

function reportedValue(reporter: string, iso: string): string {
  const when = detailWhen(iso);
  if (reporter && when) return `${reporter} · ${when}`;
  return reporter || when || "—";
}

function costLine(order: WorkOrder): string {
  const price = order.landlord_price != null ? formatLandlordPrice(order.landlord_price) : "";
  const vendor = order.vendor_name?.trim() ?? "";
  return [price, vendor].filter(Boolean).join(" · ");
}

function priorityWord(priority: WorkOrder["priority"]): string {
  switch (priority) {
    case "low":
      return "Low";
    case "high":
      return "High";
    case "urgent":
      return "Urgent";
    default:
      return "Normal";
  }
}

function formatLandlordPrice(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100) % 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents === 0 ? 0 : 2,
    maximumFractionDigits: cents === 0 ? 0 : 2,
  }).format(amount);
}

const NOON_UTC_DATE = /^\d{4}-\d{2}-\d{2}T12:00:00(?:\.\d+)?(?:Z|\+00:00)$/;

function hasClock(iso: string): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(iso) && !NOON_UTC_DATE.test(iso);
}

function clockLabel(iso: string): string {
  if (!hasClock(iso)) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(" AM", " am")
    .replace(" PM", " pm");
}

function isTodayIso(iso: string): boolean {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function timelineWhen(iso: string): string {
  const time = clockLabel(iso);
  if (isTodayIso(iso)) return time ? `Today ${time}` : "Today";
  const date = formatDocumentDate(iso);
  if (time && date) return `${date} · ${time}`;
  return date || time;
}

function detailWhen(iso: string): string {
  const date = formatDocumentDate(iso);
  const time = clockLabel(iso);
  if (date && time) return `${date}, ${time}`;
  return date || time;
}

function commentWho(comment: MaintenanceComment, reporter: string): string {
  if (comment.author_role === "tenant") return reporter || "Tenant";
  if (comment.author_role === "landlord") return "You";
  return roleLabel(comment.author_role || "") || "Landlord Gopher";
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
