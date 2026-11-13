import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { StaffMember } from "@/lib/data";
import {
  MAINTENANCE_CATEGORIES,
  type MaintenanceCategory,
  type MaintenanceComment,
  type MaintenancePhoto,
  type MaintenanceStatusEvent,
  type Unit,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
  type CommentVisibility,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder?: WorkOrder;
  defaults?: { property_id?: number; unit_id?: number };
  onSaved?: () => void;
}

const PRIORITIES: { value: WorkOrderPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function staffStatusOptions(hasAssignee: boolean): { value: WorkOrderStatus; label: string }[] {
  const base: { value: WorkOrderStatus; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "on_hold", label: "On hold" },
    { value: "closed", label: "Closed" },
  ];
  if (hasAssignee) {
    base.splice(1, 0, { value: "in_progress", label: "In progress" });
  }
  return base;
}

const ADMIN_STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "closed", label: "Closed" },
];

export function WorkOrderDialog({ open, onOpenChange, workOrder, defaults, onSaved }: Props) {
  const app = useApp();
  const [units, setUnits] = useState<Unit[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [propertyId, setPropertyId] = useState<number | "">("");
  const [unitId, setUnitId] = useState<number | "">("");
  const [vendorId, setVendorId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("General repair");
  const [priority, setPriority] = useState<WorkOrderPriority>("normal");
  const [status, setStatus] = useState<WorkOrderStatus>("open");
  const [permission, setPermission] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState<number | "">("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<MaintenancePhoto[]>([]);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [history, setHistory] = useState<MaintenanceStatusEvent[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("tenant_visible");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);

  const listUnits = app.listUnits;
  const setError = app.setError;
  const hasAssignee = Boolean(assignedStaffId || workOrder?.assigned_staff_id);
  const statusOptions = app.isAdmin
    ? ADMIN_STATUSES
    : staffStatusOptions(hasAssignee || status === "in_progress" || status === "scheduled");
  const isCreate = !workOrder;
  const readOnlyCore =
    app.isLandlord || app.isTenant || (Boolean(workOrder) && !app.isAdmin);
  const canEdit = app.canEditWorkOrders;
  const showAccept =
    Boolean(workOrder) &&
    app.canAcceptAndSchedule &&
    !app.isTenant &&
    !app.isLandlord &&
    workOrder?.status === "open";

  useEffect(() => {
    if (!open || app.isTenant || app.isLandlord) return;
    let cancelled = false;
    (async () => {
      try {
        const [allUnits, staffRows] = await Promise.all([
          listUnits(),
          app.isAdmin ? app.listStaff() : Promise.resolve([] as StaffMember[]),
        ]);
        if (!cancelled) {
          setUnits(allUnits);
          setStaff(staffRows);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, listUnits, setError, app.isTenant, app.isLandlord, app.isAdmin, app.listStaff]);

  useEffect(() => {
    if (!open) return;
    setPropertyId(workOrder?.property_id ?? defaults?.property_id ?? "");
    setUnitId(workOrder?.unit_id ?? defaults?.unit_id ?? "");
    setVendorId(workOrder?.vendor_id ?? "");
    setTitle(workOrder?.title ?? "");
    setDescription(workOrder?.description ?? "");
    setCategory(workOrder?.category ?? "General repair");
    setPriority(workOrder?.priority ?? "normal");
    setStatus(workOrder?.status ?? "open");
    setPermission(workOrder?.permission_to_enter ?? false);
    setScheduledAt(workOrder?.scheduled_at?.slice(0, 10) ?? "");
    setAssignedStaffId(workOrder?.assigned_staff_id ?? "");
    setResolutionNotes(workOrder?.resolution_notes ?? "");
    setHoldReason(workOrder?.hold_reason ?? "");
    setFollowUpDate(workOrder?.next_follow_up_date?.slice(0, 10) ?? "");
    setCost(workOrder?.cost != null ? String(workOrder.cost) : "");
    setNotes(workOrder?.notes ?? "");
    setCommentBody("");
    setCommentVisibility(app.isTenant ? "tenant_visible" : "internal");
    setPhotoFiles([]);
    setAcceptOpen(false);
  }, [open, workOrder, defaults, app.isTenant]);

  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;
  const workOrderId = workOrder?.id;

  async function refreshMedia(id: number) {
    const [p, c, h] = await Promise.all([listPhotos(id), listComments(id), listHistory(id)]);
    setPhotos(p);
    // Landlords: tenant_visible only (also enforced by maintenance_comments_select RLS).
    setComments(app.isLandlord ? c.filter((row) => row.visibility === "tenant_visible") : c);
    setHistory(h);
  }

  useEffect(() => {
    if (!open || workOrderId == null) {
      setPhotos([]);
      setComments([]);
      setHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        await refreshMedia(workOrderId);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workOrderId, listPhotos, listComments, listHistory, setError]);

  const filteredUnits = useMemo(() => {
    if (!propertyId) return units;
    return units.filter((u) => u.property_id === Number(propertyId));
  }, [units, propertyId]);

  useEffect(() => {
    if (!unitId) return;
    const u = units.find((x) => x.id === Number(unitId));
    if (u && propertyId !== u.property_id) setPropertyId(u.property_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const photoPreviews = useMemo(
    () => photoFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [photoFiles],
  );
  useEffect(() => {
    return () => {
      for (const p of photoPreviews) URL.revokeObjectURL(p.url);
    };
  }, [photoPreviews]);

  function companionError(): string | null {
    const prev = workOrder?.status;
    const enteringScheduled = status === "scheduled" && prev !== "scheduled";
    if (enteringScheduled && !app.isAdmin) {
      return "Only admins can Accept & schedule.";
    }
    if (status === "scheduled" && app.isAdmin) {
      if (!assignedStaffId) return "Scheduled requests need an assigned staff member.";
      if (!scheduledAt) return "Scheduled requests need a date.";
    }
    if (status === "in_progress") {
      const staffId = assignedStaffId || workOrder?.assigned_staff_id;
      if (!staffId) return "In progress requires an assigned staff member (Accept & schedule first).";
    }
    if (status === "on_hold") {
      if (!holdReason.trim()) return "On hold requires a reason.";
      if (!followUpDate) return "On hold requires a follow-up date.";
    }
    if (status === "closed") {
      if (!resolutionNotes.trim()) return "Closing requires resolution notes.";
    }
    return null;
  }

  async function save() {
    if (!title.trim()) return;
    const err = companionError();
    if (err) {
      app.setError(err);
      return;
    }
    const prevStatus = workOrder?.status;
    const prevSched = workOrder?.scheduled_at?.slice(0, 10) ?? "";
    const schedChanged = scheduledAt !== prevSched;
    if (!app.isAdmin && status === "scheduled" && prevStatus !== "scheduled") {
      app.setError("Only admins can Accept & schedule.");
      return;
    }
    if (!app.isAdmin && schedChanged) {
      app.setError("Only admins can set the scheduled date.");
      return;
    }
    setSaving(true);
    try {
      const payload: Parameters<typeof app.updateWorkOrder>[1] & { title: string } = {
        property_id: propertyId ? Number(propertyId) : null,
        unit_id: unitId ? Number(unitId) : null,
        vendor_id: vendorId ? Number(vendorId) : null,
        title: title.trim(),
        description: description.trim() || null,
        category,
        priority,
        status,
        permission_to_enter: permission,
        cost: cost ? parseFloat(cost) : null,
        notes: notes.trim() || null,
        resolution_notes: status === "closed" ? resolutionNotes.trim() : resolutionNotes.trim() || null,
        hold_reason: status === "on_hold" ? holdReason.trim() : holdReason.trim() || null,
        next_follow_up_date: status === "on_hold" ? followUpDate : followUpDate || null,
      };
      if (app.isAdmin) {
        payload.scheduled_at = scheduledAt || null;
        payload.assigned_staff_id = assignedStaffId ? Number(assignedStaffId) : null;
      } else if (workOrder?.assigned_staff_id != null) {
        // Keep existing assignment for In Progress CHECK (staff cannot change assignee)
        payload.assigned_staff_id = workOrder.assigned_staff_id;
      }
      let id = workOrder?.id;
      if (workOrder) {
        await app.updateWorkOrder(workOrder.id, payload, { previousStatus: prevStatus });
      } else {
        const created = await app.createWorkOrder(payload);
        id = created.id;
      }
      let photoFail = false;
      if (id != null && photoFiles.length) {
        try {
          await Promise.all(
            photoFiles.slice(0, 5).map((file) => app.uploadMaintenancePhoto(id!, file)),
          );
        } catch (photoErr) {
          photoFail = true;
          app.setError((photoErr as Error).message);
        }
      }
      app.setNotice(
        photoFail
          ? "Saved, but photo upload failed — add photos from the request."
          : workOrder
            ? "Work order saved."
            : "Work order created.",
      );
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function acceptAndSchedule() {
    if (!workOrder) return;
    if (!assignedStaffId || !scheduledAt) {
      app.setError("Pick a staff member and scheduled date.");
      return;
    }
    setSaving(true);
    try {
      await app.updateWorkOrder(
        workOrder.id,
        {
          status: "scheduled",
          assigned_staff_id: Number(assignedStaffId),
          scheduled_at: scheduledAt,
        },
        { previousStatus: workOrder.status },
      );
      app.setNotice("Request accepted and scheduled.");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!workOrder) return;
    try {
      await app.deleteWorkOrder(workOrder.id);
      app.setNotice("Work order deleted.");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  async function postComment() {
    if (!workOrder || !commentBody.trim()) return;
    try {
      const visibility: CommentVisibility = app.isTenant ? "tenant_visible" : commentVisibility;
      const row = await app.addMaintenanceComment(workOrder.id, commentBody.trim(), visibility);
      setComments((prev) => [...prev, row]);
      setCommentBody("");
      app.setNotice("Comment posted.");
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  async function uploadMorePhotos() {
    if (!workOrder || !photoFiles.length) return;
    try {
      await Promise.all(
        photoFiles.slice(0, 5).map((file) => app.uploadMaintenancePhoto(workOrder.id, file)),
      );
      setPhotoFiles([]);
      await refreshMedia(workOrder.id);
      app.setNotice("Photos uploaded.");
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {workOrder
                ? app.isTenant || app.isLandlord
                  ? "Request details"
                  : "Edit work order"
                : "New work order"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            {workOrder?.request_number && (
              <p className="text-xs text-muted-foreground">#{workOrder.request_number}</p>
            )}

            {showAccept && (
              <div className="rounded border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-950/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Accept &amp; schedule</p>
                    <p className="text-xs text-muted-foreground">
                      Assign staff and a date (admin only). Sets status to Scheduled.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={acceptOpen ? "secondary" : "default"}
                    onClick={() => setAcceptOpen((v) => !v)}
                  >
                    {acceptOpen ? "Hide" : "Accept & schedule"}
                  </Button>
                </div>
                {acceptOpen && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label>Staff</Label>
                      <Select
                        value={String(assignedStaffId || "")}
                        onValueChange={(v) => setAssignedStaffId(v ? Number(v) : "")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Assign staff" />
                        </SelectTrigger>
                        <SelectContent>
                          {staff.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.last_name}, {s.first_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      className="sm:col-span-2"
                      disabled={saving || !assignedStaffId || !scheduledAt}
                      onClick={() => void acceptAndSchedule()}
                    >
                      Confirm Accept &amp; schedule
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="wo-title">Title</Label>
              <Input
                id="wo-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Leaking kitchen faucet"
                disabled={readOnlyCore || app.isTenant || app.isLandlord}
              />
            </div>
            {!app.isTenant && !app.isLandlord && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Property</Label>
                  <Select
                    value={String(propertyId || "")}
                    onValueChange={(v) => {
                      setPropertyId(v ? Number(v) : "");
                      setUnitId("");
                    }}
                    disabled={readOnlyCore}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {app.properties.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Unit</Label>
                  <Select
                    value={String(unitId || "")}
                    onValueChange={(v) => setUnitId(v ? Number(v) : "")}
                    disabled={readOnlyCore}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredUnits.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="wo-desc">Description</Label>
              <Textarea
                id="wo-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={readOnlyCore || app.isTenant || app.isLandlord}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={setCategory}
                  disabled={readOnlyCore || app.isTenant || app.isLandlord}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAINTENANCE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    {!MAINTENANCE_CATEGORIES.includes(category as MaintenanceCategory) && (
                      <SelectItem value={category}>{category}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {!app.isTenant && !app.isLandlord && (
                <div>
                  <Label>Priority</Label>
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as WorkOrderPriority)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!app.isTenant && !app.isLandlord && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <Select
                      value={isCreate ? "open" : status}
                      onValueChange={(v) => setStatus(v as WorkOrderStatus)}
                      disabled={isCreate}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                        {status === "scheduled" && !app.isAdmin && (
                          <SelectItem value="scheduled">Scheduled</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {isCreate && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        New requests start Open — use Accept &amp; schedule after create.
                      </p>
                    )}
                    {!app.isAdmin && !hasAssignee && !isCreate && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        In progress unlocks after an admin assigns staff.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>Vendor</Label>
                    <Select
                      value={String(vendorId || "")}
                      onValueChange={(v) => setVendorId(v ? Number(v) : "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {app.vendors.map((v) => (
                          <SelectItem key={v.id} value={String(v.id)}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Status companion fields — only when needed */}
                {(status === "scheduled" || status === "in_progress") && app.isAdmin && (
                  <div className="grid grid-cols-2 gap-3 rounded border p-3">
                    <div className="sm:col-span-2 text-xs font-medium text-muted-foreground">
                      Required for {status === "scheduled" ? "Scheduled" : "In progress"}
                    </div>
                    <div>
                      <Label>Assigned staff</Label>
                      <Select
                        value={String(assignedStaffId || "")}
                        onValueChange={(v) => setAssignedStaffId(v ? Number(v) : "")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Staff" />
                        </SelectTrigger>
                        <SelectContent>
                          {staff.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.last_name}, {s.first_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {status === "scheduled" && (
                      <div>
                        <Label>Scheduled date</Label>
                        <Input
                          type="date"
                          value={scheduledAt}
                          onChange={(e) => setScheduledAt(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}
                {status === "on_hold" && (
                  <div className="grid gap-2 rounded border p-3">
                    <p className="text-xs font-medium text-muted-foreground">Required for On hold</p>
                    <div>
                      <Label>Hold reason</Label>
                      <Input
                        value={holdReason}
                        onChange={(e) => setHoldReason(e.target.value)}
                        placeholder="Waiting on parts…"
                      />
                    </div>
                    <div>
                      <Label>Follow-up date</Label>
                      <Input
                        type="date"
                        value={followUpDate}
                        onChange={(e) => setFollowUpDate(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {status === "closed" && (
                  <div className="grid gap-2 rounded border p-3">
                    <p className="text-xs font-medium text-muted-foreground">Required to close</p>
                    <div>
                      <Label>Resolution notes</Label>
                      <Textarea
                        value={resolutionNotes}
                        onChange={(e) => setResolutionNotes(e.target.value)}
                        rows={2}
                        placeholder="What fixed it?"
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {(app.isTenant || app.isLandlord) && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="capitalize">
                  {status.replace("_", " ")}
                </Badge>
                <span className="text-muted-foreground">{category}</span>
                {priority === "urgent" && <Badge variant="destructive">Emergency</Badge>}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={permission}
                onChange={(e) => setPermission(e.target.checked)}
                className="size-4"
                disabled={readOnlyCore || app.isTenant || app.isLandlord}
              />
              Permission to enter
            </label>

            {!app.isTenant && !app.isLandlord && (
              <div className="grid grid-cols-2 gap-3">
                {!app.isAdmin && (
                  <div>
                    <Label>Scheduled date</Label>
                    <Input type="date" value={scheduledAt} disabled />
                  </div>
                )}
                <div className={app.isAdmin ? "col-span-2 sm:col-span-1" : ""}>
                  <Label htmlFor="wo-cost">Cost</Label>
                  <Input id="wo-cost" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
              </div>
            )}
            {!app.isTenant && !app.isLandlord && (
              <div>
                <Label htmlFor="wo-notes">Internal notes</Label>
                <Textarea id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            )}

            {workOrder && (
              <>
                <div className="border-t pt-3">
                  <Label>Photos</Label>
                  {detailLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : photos.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No photos yet.</p>
                  ) : (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {photos.map((p) =>
                        p.url ? (
                          <a
                            key={p.id}
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block overflow-hidden rounded border"
                          >
                            <img
                              src={p.url}
                              alt={p.caption || "Maintenance photo"}
                              className="aspect-square w-full object-cover"
                            />
                          </a>
                        ) : (
                          <div
                            key={p.id}
                            className="flex aspect-square items-center justify-center rounded border bg-muted text-xs text-muted-foreground"
                          >
                            Unavailable
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  {!app.isLandlord && (
                    <div className="mt-2 space-y-2">
                      <Input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) =>
                          setPhotoFiles(Array.from(e.target.files ?? []).slice(0, 5))
                        }
                      />
                      {photoPreviews.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {photoPreviews.map((p) => (
                            <img
                              key={p.url}
                              src={p.url}
                              alt={p.file.name}
                              className="aspect-square rounded border object-cover"
                            />
                          ))}
                        </div>
                      )}
                      {photoFiles.length > 0 && (
                        <Button type="button" size="sm" variant="outline" onClick={() => void uploadMorePhotos()}>
                          Upload {photoFiles.length} photo{photoFiles.length === 1 ? "" : "s"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t pt-3">
                  <Label>Status history</Label>
                  {history.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No status changes yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5 text-xs">
                      {history.map((h) => (
                        <li key={h.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}
                          </span>
                          <span>{formatDate(h.created_at)}</span>
                          {h.changed_by_role && <span>· {h.changed_by_role}</span>}
                          {h.note && <span>· {h.note}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border-t pt-3">
                  <Label>Comments</Label>
                  {comments.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">No comments yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                      {comments.map((c) => (
                        <li key={c.id} className="rounded border px-3 py-2">
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{c.author_role ?? "user"}</span>
                            {!app.isTenant && (
                              <Badge variant="outline">
                                {c.visibility === "internal" ? "Internal" : "Tenant visible"}
                              </Badge>
                            )}
                            <span>{formatDate(c.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{c.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!app.isLandlord && (
                    <div className="mt-2 grid gap-2">
                      <Textarea
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        rows={2}
                        placeholder={app.isTenant ? "Message staff…" : "Add a comment…"}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {!app.isTenant && (
                          <Select
                            value={commentVisibility}
                            onValueChange={(v) => setCommentVisibility(v as CommentVisibility)}
                          >
                            <SelectTrigger className="w-[180px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tenant_visible">Tenant visible</SelectItem>
                              <SelectItem value="internal">Internal</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void postComment()}
                          disabled={!commentBody.trim()}
                        >
                          {app.isTenant ? "Send message" : "Post comment"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {isCreate && canEdit && (
              <div>
                <Label htmlFor="wo-photos-new">Photos (optional)</Label>
                <Input
                  id="wo-photos-new"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setPhotoFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                />
              </div>
            )}
          </div>

          <DialogFooter className="mt-2">
            {workOrder && app.canDeleteWorkOrders && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {app.isTenant || app.isLandlord ? "Close" : "Cancel"}
            </Button>
            {canEdit && (
              <Button
                type="button"
                onClick={() => void save()}
                disabled={saving || !title.trim() || (isCreate && !app.canCreateWorkOrders)}
              >
                {workOrder ? "Save changes" : "Create work order"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this work order?"
        description="Its history, photos, and notes go with it. This cannot be undone."
        onConfirm={remove}
      />
    </>
  );
}
