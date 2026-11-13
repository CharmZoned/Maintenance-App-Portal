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

const STAFF_STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "closed", label: "Closed" },
];

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

  const listUnits = app.listUnits;
  const setError = app.setError;
  const statusOptions = app.isAdmin ? ADMIN_STATUSES : STAFF_STATUSES;
  const isCreate = !workOrder;
  const readOnlyCore = Boolean(workOrder) && !app.isAdmin;

  useEffect(() => {
    if (!open || app.isTenant) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await listUnits();
        if (!cancelled) setUnits(all);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, listUnits, setError, app.isTenant]);

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
    setCost(workOrder?.cost != null ? String(workOrder.cost) : "");
    setNotes(workOrder?.notes ?? "");
    setCommentBody("");
    setCommentVisibility("tenant_visible");
    setPhotoFiles([]);
  }, [open, workOrder, defaults]);

  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;
  const workOrderId = workOrder?.id;

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
        const [p, c, h] = await Promise.all([
          listPhotos(workOrderId),
          listComments(workOrderId),
          listHistory(workOrderId),
        ]);
        if (!cancelled) {
          setPhotos(p);
          setComments(c);
          setHistory(h);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  async function save() {
    if (!title.trim()) return;
    const prevStatus = workOrder?.status;
    const transitioningToScheduled = status === "scheduled" && prevStatus !== "scheduled";
    const prevSched = workOrder?.scheduled_at?.slice(0, 10) ?? "";
    const schedChanged = scheduledAt !== prevSched;
    if (!app.isAdmin && transitioningToScheduled) {
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
      };
      // Only admins send scheduled_at — avoids date-only rewrite tripping protect trigger for staff.
      if (app.isAdmin) {
        payload.scheduled_at = scheduledAt || null;
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
          for (const file of photoFiles.slice(0, 5)) {
            await app.uploadMaintenancePhoto(id, file);
          }
        } catch (photoErr) {
          photoFail = true;
          app.setError((photoErr as Error).message);
        }
      }
      app.setNotice(
        photoFail
          ? "Work order saved, but photo upload failed — retry from the request."
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
      const row = await app.addMaintenanceComment(workOrder.id, commentBody.trim(), commentVisibility);
      setComments((prev) => [...prev, row]);
      setCommentBody("");
      app.setNotice("Comment posted.");
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
                ? app.isTenant
                  ? "Request details"
                  : "Edit work order"
                : "New work order"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            {workOrder?.request_number && (
              <p className="text-xs text-muted-foreground">#{workOrder.request_number}</p>
            )}
            <div>
              <Label htmlFor="wo-title">Title</Label>
              <Input
                id="wo-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Leaking kitchen faucet"
                disabled={readOnlyCore || app.isTenant}
              />
            </div>
            {!app.isTenant && (
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
                disabled={readOnlyCore || app.isTenant}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={setCategory}
                  disabled={readOnlyCore || app.isTenant}
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
              <div>
                <Label>Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as WorkOrderPriority)}
                  disabled={app.isTenant}
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
            </div>
            {!app.isTenant && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as WorkOrderStatus)}>
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
                  {!app.isAdmin && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Accept &amp; schedule (Scheduled + date) is admin-only.
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
            )}
            {app.isTenant && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="capitalize">
                  {status.replace("_", " ")}
                </Badge>
                <span className="text-muted-foreground">{category}</span>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={permission}
                onChange={(e) => setPermission(e.target.checked)}
                className="size-4"
                disabled={readOnlyCore || app.isTenant}
              />
              Permission to enter
            </label>
            {!app.isTenant && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="wo-sched">Scheduled date</Label>
                  <Input
                    id="wo-sched"
                    type="date"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    disabled={!app.canAcceptAndSchedule}
                  />
                </div>
                <div>
                  <Label htmlFor="wo-cost">Cost</Label>
                  <Input id="wo-cost" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
              </div>
            )}
            {!app.isTenant && (
              <div>
                <Label htmlFor="wo-notes">Notes</Label>
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
                          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border">
                            <img src={p.url} alt={p.caption || "Maintenance photo"} className="aspect-square w-full object-cover" />
                          </a>
                        ) : (
                          <div key={p.id} className="aspect-square rounded border bg-muted text-xs text-muted-foreground flex items-center justify-center">
                            Unavailable
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  {!app.isTenant && (
                    <Input
                      className="mt-2"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => setPhotoFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                    />
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
                            <Badge variant="outline">{c.visibility === "internal" ? "Internal" : "Tenant visible"}</Badge>
                            <span>{formatDate(c.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{c.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!app.isTenant && (
                    <div className="mt-2 grid gap-2">
                      <Textarea
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        rows={2}
                        placeholder="Add a comment…"
                      />
                      <div className="flex flex-wrap items-center gap-2">
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
                        <Button type="button" size="sm" variant="outline" onClick={() => void postComment()} disabled={!commentBody.trim()}>
                          Post comment
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {isCreate && !app.isTenant && (
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
              {app.isTenant ? "Close" : "Cancel"}
            </Button>
            {!app.isTenant && (
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
