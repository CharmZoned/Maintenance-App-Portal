import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { SkeletonRow, StatusChip } from "@/components/patterns";
import {
  formatActivityStamp,
  priorityLevel,
  requestNextStep,
  toRequestStatus,
} from "@/lib/request-status";
import { formatDate } from "@/lib/utils";
import type { MaintenanceComment, MaintenancePhoto, MaintenanceStatusEvent, WorkOrder } from "@/types";

/**
 * Tenant request summary — text + chips (Figma Requests detail panel).
 * Prefer this over disabled inputs for read-only fields.
 */
export function TenantRequestDetailPanel({
  order,
  navigate,
  compact = false,
}: {
  order: WorkOrder;
  navigate: (to: string) => void;
  /** Inline panel on list page — lighter companion fetch. */
  compact?: boolean;
}) {
  const app = useApp();
  const [photos, setPhotos] = useState<MaintenancePhoto[]>([]);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [history, setHistory] = useState<MaintenanceStatusEvent[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(true);

  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingExtras(true);
      try {
        const [p, c, h] = await Promise.all([
          listPhotos(order.id),
          listComments(order.id),
          listHistory(order.id),
        ]);
        if (cancelled) return;
        setPhotos(p);
        setComments(c);
        setHistory(h);
      } catch {
        if (!cancelled) {
          setPhotos([]);
          setComments([]);
          setHistory([]);
        }
      } finally {
        if (!cancelled) setLoadingExtras(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.id, listPhotos, listComments, listHistory]);

  const status = toRequestStatus(order);
  const nextStep = requestNextStep(order);
  const priority = priorityLevel(order.priority);
  const reporter =
    [order.tenant_first_name, order.tenant_last_name].filter(Boolean).join(" ") || "You";
  const reportedWhen = formatActivityStamp(order.created_at);
  const assignedLabel = order.assigned_staff_id ? "Assigned (staff)" : "Not yet assigned";
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
          : order.description?.trim() || undefined,
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

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Request details
      </p>
      <h2 className="mt-2 text-2xl font-semibold leading-8 text-foreground">{order.title}</h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusChip status={status} />
        {priority ? (
          <span className="inline-flex items-center rounded-sm bg-warning-tint px-2.5 py-0.5 text-xs text-warning">
            {priority === "Emergency" ? "Emergency" : "High priority"}
          </span>
        ) : null}
      </div>

      <dl className="mt-6 space-y-3">
        <DetailRow label="Reported" value={`${reporter} · ${reportedWhen}`} />
        <DetailRow label="Assigned to" value={assignedLabel} />
        <DetailRow label="Scheduled" value={scheduledLabel} />
        {!compact && order.category ? (
          <DetailRow label="Category" value={order.category} />
        ) : null}
      </dl>

      {!compact && order.description ? (
        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground">Description</p>
          <p className="mt-1 text-sm text-foreground">{order.description}</p>
        </div>
      ) : null}

      <div className="my-5 h-px bg-border" />

      <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">Updates</h3>
      {loadingExtras ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <SkeletonRow />
        </div>
      ) : (
        <ul className="mt-3 space-y-4">
          {updates.map((row, i) => (
            <li key={`${row.at}-${i}`}>
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
                Photos and additional details appear here when available.
              </p>
            </li>
          )}
        </ul>
      )}

      <div className="mt-auto pt-6">
        {/* Messages / request conversation is mocked elsewhere — link only. */}
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
