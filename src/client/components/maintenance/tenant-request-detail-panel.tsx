import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { PriorityChip, StatusChip } from "@/components/patterns";
import type { StaffMember } from "@/lib/data";
import { priorityLevel, requestNextStep, toRequestStatus } from "@/lib/request-status";
import type { MaintenanceComment, MaintenancePhoto, MaintenanceStatusEvent, WorkOrder } from "@/types";
import {
  assigneeName,
  dayStamp,
  placeLabel,
  requestNumberLabel,
  staffById,
} from "./request-detail-page";

/** @deprecated Companions are loaded by the request page now. Kept for type compatibility. */
export type TenantRequestExtras = {
  photos: MaintenancePhoto[];
  comments: MaintenanceComment[];
  history: MaintenanceStatusEvent[];
};

/**
 * @deprecated RETIRED. The tenant's narrow "Updates" card (and its "Open request
 * conversation" button) is gone: tenants use the one request page at
 * /maintenance/:id (RequestDetailPage), which has the timeline, photos and an
 * on-page message box. The tenant list should open that page in one click and
 * drop this preview panel (spec §6.2). Delete this file once
 * tenant-requests-page.tsx no longer imports it.
 *
 * Until then it renders a short summary using the shared status mapping and
 * the worker's real name (never "Assigned (staff)"), with one way forward:
 * "Open request".
 */
export function TenantRequestDetailPanel({
  order,
  navigate,
  onOpenFullDetail,
}: {
  order: WorkOrder;
  navigate: (to: string) => void;
  /** Ignored (kept for older callers). */
  compact?: boolean;
  /** Ignored (kept for older callers). */
  extras?: TenantRequestExtras;
  onOpenFullDetail?: () => void;
}) {
  const app = useApp();
  const listStaff = app.listStaff;
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    if (order.assigned_staff_id == null) return;
    let cancelled = false;
    listStaff()
      .then((rows) => {
        if (!cancelled) setStaff(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [order.assigned_staff_id, listStaff]);

  const name = assigneeName(order, staffById(staff));
  const status = toRequestStatus(order);
  const priority = priorityLevel(order.priority);
  const open = onOpenFullDetail ?? (() => navigate(`/maintenance/${order.id}`));
  const place = placeLabel(order);

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-[17px] font-semibold leading-[22px] text-foreground">{order.title}</h2>
        <span className="text-sm text-muted-foreground">{requestNumberLabel(order)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <StatusChip status={status} />
        <span className="text-sm text-muted-foreground">{requestNextStep(order, { assigneeName: name })}</span>
        {priority ? <PriorityChip level={priority} /> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {[place, `Reported ${dayStamp(order.created_at)}`].filter(Boolean).join(" · ")}
      </p>
      <p className="text-sm text-foreground">
        <span className="text-muted-foreground">Assigned to </span>
        {name ?? "Not assigned yet"}
      </p>
      <Button size="touch" variant="secondary" className="self-start md:h-7 md:px-2" onClick={open}>
        Open request
      </Button>
    </div>
  );
}
