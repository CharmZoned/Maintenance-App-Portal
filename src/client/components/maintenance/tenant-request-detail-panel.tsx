import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ErrorRetry, SkeletonRow, StatusChip } from "@/components/patterns";
import {
  formatActivityStamp,
  priorityLevel,
  requestNextStep,
  toRequestStatus,
} from "@/lib/request-status";
import { formatDate } from "@/lib/utils";
import {
  isReportedByOther,
  tenantReporterLabel,
  useRequestReporterNames,
} from "@/lib/request-reporters";
import type {
  MaintenanceComment,
  MaintenancePhoto,
  MaintenanceStatusEvent,
  WorkOrder,
} from "@/types";

export type TenantRequestExtras = {
  photos: MaintenancePhoto[];
  comments: MaintenanceComment[];
  history: MaintenanceStatusEvent[];
};

/**
 * Tenant request summary — text + chips (Figma Requests detail panel).
 * Prefer this over disabled inputs for read-only fields.
 *
 * Pass `extras` when the parent already loaded companions (full detail page)
 * so we do not double-fetch. Omit on the list inline panel to load once here.
 */
export function TenantRequestDetailPanel({
  order,
  navigate,
  compact = false,
  extras,
  onOpenFullDetail,
  reporterName,
}: {
  order: WorkOrder;
  navigate: (to: string) => void;
  /** Inline panel on list page — lighter companion fetch. */
  compact?: boolean;
  /** Preloaded companions — skips the panel fetch when provided. */
  extras?: TenantRequestExtras;
  /** Keyboard-accessible path to the full detail route (desktop + compact). */
  onOpenFullDetail?: () => void;
  /**
   * Landlord's display name for a landlord-filed request, when the parent has
   * already loaded it. Omitted: the panel looks it up itself.
   */
  reporterName?: string | null;
}) {
  const app = useApp();
  const [photos, setPhotos] = useState<MaintenancePhoto[]>(extras?.photos ?? []);
  const [comments, setComments] = useState<MaintenanceComment[]>(
    extras?.comments ?? [],
  );
  const [history, setHistory] = useState<MaintenanceStatusEvent[]>(
    extras?.history ?? [],
  );
  const [loadingExtras, setLoadingExtras] = useState(!extras);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;

  // Sync when parent-provided extras change (full page reload).
  useEffect(() => {
    if (!extras) return;
    setPhotos(extras.photos);
    setComments(extras.comments);
    setHistory(extras.history);
    setLoadingExtras(false);
    setExtrasError(null);
  }, [extras]);

  useEffect(() => {
    if (extras) return;
    let cancelled = false;
    // Clear previous request's timeline immediately on switch.
    setPhotos([]);
    setComments([]);
    setHistory([]);
    setExtrasError(null);
    setLoadingExtras(true);
    const loadId = order.id;
    (async () => {
      try {
        const [p, c, h] = await Promise.all([
          listPhotos(loadId),
          listComments(loadId),
          listHistory(loadId),
        ]);
        if (cancelled) return;
        setPhotos(p);
        setComments(c);
        setHistory(h);
      } catch (err) {
        if (!cancelled) {
          setPhotos([]);
          setComments([]);
          setHistory([]);
          setExtrasError((err as Error).message || "Couldn’t load updates.");
        }
      } finally {
        if (!cancelled) setLoadingExtras(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.id, extras, listPhotos, listComments, listHistory, reloadKey]);

  const status = toRequestStatus(order);
  const nextStep = requestNextStep(order);
  const priority = priorityLevel(order.priority);
  // Landlord-filed request on the tenant's unit (D3): view only.
  const viewOnly = isReportedByOther(order);
  const lookupOrders = useMemo(
    () => (reporterName === undefined ? [order] : []),
    [order, reporterName],
  );
  const lookedUpNames = useRequestReporterNames(lookupOrders);
  const reporter = tenantReporterLabel(
    order,
    reporterName === undefined ? lookedUpNames.get(order.id) : reporterName,
  );
  const reportedWhen = formatActivityStamp(order.created_at);
  const assignedLabel = order.assigned_staff_id
    ? "Assigned (staff)"
    : "Not yet assigned";
  const scheduledLabel = order.scheduled_at
    ? formatDate(order.scheduled_at, {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "Not scheduled";

  const updates = useMemo(() => {
    type Row = { when: string; title: string; body?: string; at: string };
    const rows: Row[] = [];
    rows.push({
      when: formatActivityStamp(order.created_at),
      title:
        status === "New"
          ? "Request received · awaiting assignment"
          : nextStep
            ? `Status · ${status}`
            : `Request received`,
      body:
        status === "New"
          ? "Awaiting assignment. Photos and additional details appear when available."
          : undefined,
      at: order.created_at,
    });
    for (const ev of history) {
      rows.push({
        when: formatActivityStamp(ev.created_at),
        title: ev.note?.trim() || `Status → ${ev.to_status}`,
        at: ev.created_at,
      });
    }
    for (const c of comments) {
      rows.push({
        when: formatActivityStamp(c.created_at),
        title: c.body,
        at: c.created_at,
      });
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, compact ? 3 : 12);
  }, [order, history, comments, status, nextStep, compact]);

  const openFull = onOpenFullDetail ?? (() => navigate(`/maintenance/${order.id}`));

  return (
    <div
      key={order.id}
      className="flex h-full flex-col rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Request details
      </p>
      <h2 className="mt-2 text-2xl font-semibold leading-8 text-foreground">
        {order.title}
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusChip status={status} />
        {priority ? (
          <span className="inline-flex items-center rounded-sm bg-warning-tint px-2.5 py-0.5 text-xs text-warning">
            {priority === "Emergency" ? "Emergency" : "High priority"}
          </span>
        ) : null}
      </div>

      <dl className="mt-6 space-y-3">
        <DetailRow
          label={viewOnly ? "Reported by" : "Reported"}
          value={`${reporter} · ${reportedWhen}`}
        />
        <DetailRow label="Assigned to" value={assignedLabel} />
        <DetailRow label="Scheduled" value={scheduledLabel} />
        {order.category ? <DetailRow label="Category" value={order.category} /> : null}
      </dl>

      {order.description ? (
        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground">Description</p>
          <p
            className={
              compact
                ? "mt-1 line-clamp-3 text-sm text-foreground"
                : "mt-1 text-sm text-foreground"
            }
          >
            {order.description}
          </p>
          {compact ? (
            <button
              type="button"
              className="mt-2 min-h-11 text-sm font-medium text-brand-text hover:underline"
              onClick={openFull}
            >
              View full details
            </button>
          ) : null}
        </div>
      ) : compact ? (
        <button
          type="button"
          className="mt-5 min-h-11 self-start text-sm font-medium text-brand-text hover:underline"
          onClick={openFull}
        >
          View full details
        </button>
      ) : null}

      <div className="my-5 h-px bg-border" />

      <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">
        Updates
      </h3>
      {loadingExtras ? (
        <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading updates">
          <SkeletonRow />
        </div>
      ) : extrasError ? (
        <div className="mt-3">
          <ErrorRetry
            message={extrasError}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      ) : (
        <ul className="mt-3 space-y-4">
          {updates.map((row, i) => (
            <li key={`${order.id}-${row.at}-${i}`}>
              <p className="text-xs text-muted-foreground">{row.when}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{row.title}</p>
              {row.body ? (
                <p className="mt-1 text-sm text-muted-foreground">{row.body}</p>
              ) : null}
            </li>
          ))}
          {photos.length > 0 ? (
            <li>
              <div className="flex flex-wrap gap-2">
                {photos.slice(0, compact ? 3 : 8).map((p) =>
                  p.url ? (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="size-16 overflow-hidden rounded-md bg-muted"
                    >
                      <img
                        src={p.url}
                        alt={p.caption || "Photo"}
                        className="size-full object-cover"
                      />
                    </a>
                  ) : null,
                )}
              </div>
            </li>
          ) : (
            <li>
              <p className="text-sm text-muted-foreground">
                No photos yet. Photos appear here when attached to this request.
              </p>
            </li>
          )}
        </ul>
      )}

      {viewOnly ? (
        // Landlord-filed: no conversation, photo or fix-confirmation controls.
        <div className="mt-auto pt-6">
          <p
            className="rounded-sm bg-muted px-4 py-3 text-sm text-muted-foreground"
            role="note"
          >
            Your landlord reported this repair for your home. You can follow its
            progress here, but you can’t reply to it or add photos.
          </p>
        </div>
      ) : (
        <div className="mt-auto pt-6">
          {/*
            TODO(data-gap): full messages↔WO join still needs the messages backend.
            Messages accepts `?request=` (demo WO id map / soft-open for unknowns).
          */}
          <Button
            type="button"
            variant="secondary"
            className="h-11 w-full min-h-11 text-sm text-brand-text"
            onClick={() => navigate(`/messages?request=${order.id}`)}
          >
            Open request conversation
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            {compact
              ? "Only conversation members can read or reply."
              : "Conversation members only."}
          </p>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-[7.5rem] shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
