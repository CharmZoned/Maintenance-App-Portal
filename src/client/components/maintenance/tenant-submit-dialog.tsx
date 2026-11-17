import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAINTENANCE_CATEGORIES,
  type MaintenanceCategory,
  type TenantHomeContext,
  type WorkOrder,
  type WorkOrderPriority,
} from "@/types";
import { cn } from "@/lib/utils";
import { MAX_MAINTENANCE_PHOTOS } from "./work-order-status";

type UiPriority = "normal" | "urgent" | "emergency";

const PRIORITY_TO_DB: Record<UiPriority, WorkOrderPriority> = {
  normal: "normal",
  urgent: "high",
  emergency: "urgent",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the created request so callers can select it immediately. */
  onSaved?: (created: WorkOrder) => void | Promise<void>;
}

/**
 * Tenant new-request form — drawer on md+, full-screen sheet on phone (Figma).
 * Submit stays live via `submitTenantMaintenanceRequest`.
 */
export function TenantSubmitDialog({ open, onOpenChange, onSaved }: Props) {
  const app = useApp();
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory>("Plumbing");
  const [priority, setPriority] = useState<UiPriority>("normal");
  const [permission, setPermission] = useState<"yes" | "no">("yes");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setCategory("Plumbing");
    setPriority("normal");
    setPermission("yes");
    setFiles([]);
    let cancelled = false;
    (async () => {
      try {
        const ctx = await app.getTenantHomeContext();
        if (!cancelled) setHome(ctx);
      } catch (err) {
        if (!cancelled) app.setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, app]);

  const homeLabel = home
    ? [home.unit_label ? `Unit ${home.unit_label}` : null, home.property_name]
        .filter(Boolean)
        .join(" · ") || "Your unit"
    : "Loading unit…";

  const noUnit = home != null && home.unit_id == null;
  const canSubmit =
    !saving && !noUnit && Boolean(title.trim()) && Boolean(description.trim());

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_MAINTENANCE_PHOTOS));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const created = await app.submitTenantRequest({
        title: title.trim(),
        description: description.trim(),
        category,
        permission_to_enter: permission === "yes",
        priority: PRIORITY_TO_DB[priority],
      });
      let photoFail = false;
      if (files.length) {
        try {
          await Promise.all(
            files
              .slice(0, MAX_MAINTENANCE_PHOTOS)
              .map((file) => app.uploadMaintenancePhoto(created.id, file)),
          );
        } catch (photoErr) {
          photoFail = true;
          app.setError((photoErr as Error).message);
        }
      }
      app.setNotice(
        photoFail
          ? "Request submitted, but photo upload failed — open the request to add photos."
          : files.length
            ? "Request submitted with photos. Staff will update status in the portal."
            : "Request submitted. Staff will update status in the portal.",
      );
      await onSaved?.(created);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[min(100dvh,100%)] gap-0 overflow-y-auto p-0 sm:max-h-[90dvh]",
          // Phone: near full-screen sheet. md+: drawer-width panel (~480).
          "max-w-[100vw] rounded-none sm:max-w-md sm:rounded-lg md:max-w-[480px]",
        )}
      >
        <div className="space-y-5 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Requests / New request
            </p>
            <DialogTitle className="mt-2 text-2xl font-semibold leading-8">
              Request maintenance
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-muted-foreground">
              {homeLabel}
            </DialogDescription>
          </div>

          {noUnit ? (
            <p className="text-sm text-destructive">
              Your account isn’t linked to a unit yet. Ask staff to assign a unit
              before submitting.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="tenant-title" className="text-xs font-semibold">
              Issue title <span aria-hidden>*</span>
            </Label>
            <Input
              id="tenant-title"
              className="h-12 min-h-11 shadow-none ring-1 ring-border focus:shadow-[inset_0_0_0_1px_var(--ring),0_0_0_3px_var(--brand-tint)]"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Kitchen tap dripping"
              disabled={noUnit}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Category <span aria-hidden>*</span>
            </Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as MaintenanceCategory)}
              disabled={noUnit}
            >
              <SelectTrigger className="h-12 min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINTENANCE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tenant-desc" className="text-xs font-semibold">
              Description <span aria-hidden>*</span>
            </Label>
            <Textarea
              id="tenant-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Drips constantly from cold side…"
              disabled={noUnit}
              className="min-h-[100px] text-[0.9375rem]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Photos</Label>
            <label
              className={cn(
                "flex min-h-[86px] cursor-pointer flex-col justify-center rounded-sm border border-border bg-muted px-4 py-3",
                (noUnit || files.length >= MAX_MAINTENANCE_PHOTOS) &&
                  "cursor-not-allowed opacity-60",
              )}
            >
              <span className="text-sm font-medium text-brand-text">
                Add up to {MAX_MAINTENANCE_PHOTOS} photos
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                Only the request’s authorized members can view them.
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={noUnit || files.length >= MAX_MAINTENANCE_PHOTOS}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {previews.length > 0 ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {previews.map((p, i) => (
                  <div key={p.url} className="relative overflow-hidden rounded-sm border border-border">
                    <img
                      src={p.url}
                      alt={p.file.name}
                      className="aspect-square w-full object-cover"
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded-sm bg-background/90 p-1"
                      onClick={() => removeFile(i)}
                      aria-label="Remove photo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Priority <span aria-hidden>*</span>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["normal", "Normal"],
                  ["urgent", "Urgent"],
                  ["emergency", "Emergency"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={noUnit}
                  aria-pressed={priority === value}
                  onClick={() => setPriority(value)}
                  className={cn(
                    "flex h-11 min-h-11 items-center justify-center rounded-sm border border-border text-sm",
                    priority === value
                      ? "bg-brand-tint font-medium text-brand-text"
                      : "bg-card text-foreground hover:bg-muted/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <aside
            className="rounded-sm border border-border bg-warning-tint px-4 py-3 text-warning"
            role="note"
          >
            <p className="text-sm font-medium">
              Immediate danger? Contact local emergency services.
            </p>
            <p className="mt-1 text-xs">
              Do not wait for a response here. Manager emergency contact is not
              configured.
            </p>
          </aside>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Permission to enter</Label>
            <Select
              value={permission}
              onValueChange={(v) => setPermission(v as "yes" | "no")}
              disabled={noUnit}
            >
              <SelectTrigger className="h-12 min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes, if no one home</SelectItem>
                <SelectItem value="no">No — please schedule first</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              className="h-11 min-h-11 flex-1 text-sm text-brand-text sm:flex-none sm:w-[136px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              className="h-11 min-h-11 flex-[2] text-sm"
              onClick={() => void save()}
              disabled={!canSubmit}
            >
              {saving ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
