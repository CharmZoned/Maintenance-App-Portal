import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StaffMember } from "@/lib/data";
import {
  MAINTENANCE_CATEGORIES,
  type CommentVisibility,
  type MaintenanceComment,
  type MaintenancePhoto,
  type MaintenanceStatusEvent,
  type Unit,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/types";
import { WorkOrderAcceptSchedule } from "./work-order-accept-schedule";
import { WorkOrderMediaPanel } from "./work-order-media-panel";
import {
  WorkOrderStaffFields,
  type WorkOrderStaffFormValues,
} from "./work-order-staff-fields";
import { WorkOrderTenantDetail } from "./work-order-tenant-detail";
import { MAX_MAINTENANCE_PHOTOS, takePhotoFiles } from "./work-order-status";

interface WorkOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder?: WorkOrder;
  defaults?: { property_id?: number; unit_id?: number };
  onSaved?: () => void;
}

/**
 * Role → panels / editability:
 * - Tenant / landlord (viewer): tenant detail + media (comments/photos per role); no Save.
 * - Maintenance staff: staff fields with readOnlyCore (title/location locked); can edit status/cost/notes/comments.
 * - Admin: full staff fields + Accept & schedule on Open; create/delete.
 *
 * Open→Scheduled writers: Accept Confirm (preferred intake) or Save with status Scheduled.
 */
export function WorkOrderDialog({ open, onOpenChange, workOrder, defaults, onSaved }: WorkOrderDialogProps) {
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
  const [permissionToEnter, setPermissionToEnter] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState<number | "">("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [photos, setPhotos] = useState<MaintenancePhoto[]>([]);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [history, setHistory] = useState<MaintenanceStatusEvent[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("tenant_visible");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  /** Open by default for Open WOs so admin intake is one visible flow. */
  const [acceptOpen, setAcceptOpen] = useState(true);

  const listUnits = app.listUnits;
  const setError = app.setError;
  const hasAssignee = Boolean(assignedStaffId || workOrder?.assigned_staff_id);
  const canStartWork = hasAssignee || status === "in_progress" || status === "scheduled";
  const isCreate = !workOrder;
  const readOnlyCore =
    app.isLandlord || app.isTenant || (Boolean(workOrder) && !app.isAdmin);
  const canEdit = app.canEditWorkOrders;
  const isViewer = app.isTenant || app.isLandlord;
  // Persisted Open + form still Open — hide when admin switches status dropdown
  // so Accept and Scheduled companion fields don't both bind assignee/date.
  const showAccept =
    Boolean(workOrder) &&
    app.canAcceptAndSchedule &&
    !isViewer &&
    workOrder?.status === "open" &&
    status === "open";

  useEffect(() => {
    if (!open || isViewer) return;
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
  }, [open, listUnits, setError, isViewer, app.isAdmin, app.listStaff]);

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
    setPermissionToEnter(workOrder?.permission_to_enter ?? false);
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
    // Expand Accept & schedule for open requests so assign + date is the primary intake path.
    setAcceptOpen(workOrder?.status === "open");
  }, [open, workOrder, defaults, app.isTenant]);

  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;
  const workOrderId = workOrder?.id;

  async function loadMedia(id: number) {
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
    // Clear prior WO media immediately so a slow response cannot flash stale rows.
    setPhotos([]);
    setComments([]);
    setHistory([]);
    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        const [p, c, h] = await Promise.all([
          listPhotos(workOrderId),
          listComments(workOrderId),
          listHistory(workOrderId),
        ]);
        if (cancelled) return;
        setPhotos(p);
        setComments(app.isLandlord ? c.filter((row) => row.visibility === "tenant_visible") : c);
        setHistory(h);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    workOrderId,
    listPhotos,
    listComments,
    listHistory,
    setError,
    app.isLandlord,
  ]);

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

  const staffFormValues: WorkOrderStaffFormValues = {
    propertyId,
    unitId,
    title,
    description,
    category,
    priority,
    status,
    vendorId,
    assignedStaffId,
    scheduledAt,
    holdReason,
    followUpDate,
    resolutionNotes,
    permissionToEnter,
    cost,
    notes,
  };

  function onStaffFormChange(patch: Partial<WorkOrderStaffFormValues>) {
    if (patch.propertyId !== undefined) setPropertyId(patch.propertyId);
    if (patch.unitId !== undefined) setUnitId(patch.unitId);
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.description !== undefined) setDescription(patch.description);
    if (patch.category !== undefined) setCategory(patch.category);
    if (patch.priority !== undefined) setPriority(patch.priority);
    if (patch.status !== undefined) setStatus(patch.status);
    if (patch.vendorId !== undefined) setVendorId(patch.vendorId);
    if (patch.assignedStaffId !== undefined) setAssignedStaffId(patch.assignedStaffId);
    if (patch.scheduledAt !== undefined) setScheduledAt(patch.scheduledAt);
    if (patch.holdReason !== undefined) setHoldReason(patch.holdReason);
    if (patch.followUpDate !== undefined) setFollowUpDate(patch.followUpDate);
    if (patch.resolutionNotes !== undefined) setResolutionNotes(patch.resolutionNotes);
    if (patch.permissionToEnter !== undefined) setPermissionToEnter(patch.permissionToEnter);
    if (patch.cost !== undefined) setCost(patch.cost);
    if (patch.notes !== undefined) setNotes(patch.notes);
  }

  /** Non-admin schedule policy for Save (Accept Confirm uses acceptAndSchedule only). */
  function scheduleWriteError(prevStatus: WorkOrderStatus | undefined): string | null {
    const enteringScheduled = status === "scheduled" && prevStatus !== "scheduled";
    if (enteringScheduled && !app.isAdmin) {
      return "Only admins can Accept & schedule.";
    }
    const prevSched = workOrder?.scheduled_at?.slice(0, 10) ?? "";
    if (!app.isAdmin && scheduledAt !== prevSched) {
      return "Only admins can set the scheduled date.";
    }
    return null;
  }

  function companionError(): string | null {
    const prev = workOrder?.status;
    const scheduleErr = scheduleWriteError(prev);
    if (scheduleErr) return scheduleErr;
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

  function beginSave(): boolean {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    return true;
  }

  function endSave() {
    savingRef.current = false;
    setSaving(false);
  }

  async function save() {
    if (!title.trim()) return;
    // Prefer Accept Confirm for Open + staff+date so Save does not assign without Scheduling.
    if (showAccept && assignedStaffId && scheduledAt) {
      app.setError("Use Confirm Accept & schedule to assign and set the date in one step.");
      return;
    }
    const err = companionError();
    if (err) {
      app.setError(err);
      return;
    }
    if (
      (app.isAdmin || !workOrder) &&
      !MAINTENANCE_CATEGORIES.includes(category.trim() as (typeof MAINTENANCE_CATEGORIES)[number])
    ) {
      app.setError("Pick a current maintenance category before saving (legacy value is not allowed).");
      return;
    }
    if (!beginSave()) return;
    const prevStatus = workOrder?.status;
    try {
      const payload: Parameters<typeof app.updateWorkOrder>[1] & { title: string } = {
        property_id: propertyId ? Number(propertyId) : null,
        unit_id: unitId ? Number(unitId) : null,
        vendor_id: vendorId ? Number(vendorId) : null,
        title: title.trim(),
        description: description.trim() || null,
        // Non-admins cannot change category (protect trigger); omit to avoid rejecting legacy rows.
        ...(app.isAdmin || !workOrder ? { category } : {}),
        priority,
        status,
        permission_to_enter: permissionToEnter,
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
            photoFiles
              .slice(0, MAX_MAINTENANCE_PHOTOS)
              .map((file) => app.uploadMaintenancePhoto(id!, file)),
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
      endSave();
    }
  }

  async function acceptAndSchedule() {
    if (!workOrder) return;
    if (!app.canAcceptAndSchedule) {
      app.setError("Only admins can Accept & schedule.");
      return;
    }
    if (!assignedStaffId || !scheduledAt) {
      app.setError("Pick a staff member and scheduled date.");
      return;
    }
    if (
      !MAINTENANCE_CATEGORIES.includes(category.trim() as (typeof MAINTENANCE_CATEGORIES)[number])
    ) {
      app.setError("Pick a current maintenance category before accepting.");
      return;
    }
    if (!beginSave()) return;
    try {
      // One intake confirm: schedule + keep in-dialog edits (title/notes/etc.) so Confirm
      // is not a silent discard when the Accept panel is default-open.
      await app.updateWorkOrder(
        workOrder.id,
        {
          status: "scheduled",
          assigned_staff_id: Number(assignedStaffId),
          scheduled_at: scheduledAt,
          property_id: propertyId ? Number(propertyId) : null,
          unit_id: unitId ? Number(unitId) : null,
          vendor_id: vendorId ? Number(vendorId) : null,
          title: title.trim() || workOrder.title,
          description: description.trim() || null,
          category,
          priority,
          permission_to_enter: permissionToEnter,
          cost: cost ? parseFloat(cost) : null,
          notes: notes.trim() || null,
        },
        { previousStatus: workOrder.status },
      );
      app.setNotice("Request accepted and scheduled.");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      endSave();
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
    const id = workOrder.id;
    try {
      const visibility: CommentVisibility = app.isTenant ? "tenant_visible" : commentVisibility;
      const row = await app.addMaintenanceComment(id, commentBody.trim(), visibility);
      if (workOrderId !== id) return;
      setComments((prev) => [...prev, row]);
      setCommentBody("");
      app.setNotice("Comment posted.");
    } catch (err) {
      if (workOrderId === id) app.setError((err as Error).message);
    }
  }

  async function uploadMorePhotos() {
    if (!workOrder || !photoFiles.length) return;
    const id = workOrder.id;
    try {
      await Promise.all(
        photoFiles
          .slice(0, MAX_MAINTENANCE_PHOTOS)
          .map((file) => app.uploadMaintenancePhoto(id, file)),
      );
      if (workOrderId !== id) return;
      setPhotoFiles([]);
      await loadMedia(id);
      if (workOrderId !== id) return;
      app.setNotice("Photos uploaded.");
    } catch (err) {
      if (workOrderId === id) app.setError((err as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {workOrder
                ? isViewer
                  ? "Request details"
                  : "Edit work order"
                : "New work order"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            {workOrder?.request_number && (
              <p className="text-xs text-muted-foreground">#{workOrder.request_number}</p>
            )}

            {showAccept && workOrder && (
              <WorkOrderAcceptSchedule
                workOrder={workOrder}
                expanded={acceptOpen}
                onExpandedChange={setAcceptOpen}
                staff={staff}
                assignedStaffId={assignedStaffId}
                onAssignedStaffIdChange={setAssignedStaffId}
                scheduledAt={scheduledAt}
                onScheduledAtChange={setScheduledAt}
                saving={saving}
                onConfirm={() => void acceptAndSchedule()}
              />
            )}

            {isViewer ? (
              <WorkOrderTenantDetail
                title={title}
                description={description}
                category={category}
                priority={priority}
                status={status}
                permissionToEnter={permissionToEnter}
              />
            ) : (
              <WorkOrderStaffFields
                isCreate={isCreate}
                isAdmin={app.isAdmin}
                readOnlyCore={readOnlyCore}
                canStartWork={canStartWork}
                properties={app.properties}
                filteredUnits={filteredUnits}
                vendors={app.vendors}
                staff={staff}
                values={staffFormValues}
                onChange={onStaffFormChange}
              />
            )}

            {workOrder && (
              <WorkOrderMediaPanel
                detailLoading={detailLoading}
                photos={photos}
                history={history}
                comments={comments}
                photoFiles={photoFiles}
                photoPreviews={photoPreviews}
                onPhotoFilesChange={setPhotoFiles}
                onUploadPhotos={() => void uploadMorePhotos()}
                commentBody={commentBody}
                onCommentBodyChange={setCommentBody}
                commentVisibility={commentVisibility}
                onCommentVisibilityChange={setCommentVisibility}
                onPostComment={() => void postComment()}
                isTenant={app.isTenant}
                isLandlord={app.isLandlord}
              />
            )}

            {isCreate && canEdit && (
              <div>
                <Label htmlFor="wo-photos-new">Photos (optional)</Label>
                <Input
                  id="wo-photos-new"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setPhotoFiles(takePhotoFiles(e.target.files))}
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
              {isViewer ? "Close" : "Cancel"}
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
