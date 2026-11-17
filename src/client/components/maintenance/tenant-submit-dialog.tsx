import { useEffect, useMemo, useRef, useState } from "react";
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
type PermissionChoice = "yes" | "no";

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
  const getTenantHomeContext = app.getTenantHomeContext;
  const setError = app.setError;
  const setNotice = app.setNotice;
  const submitTenantRequest = app.submitTenantRequest;
  const uploadMaintenancePhoto = app.uploadMaintenancePhoto;

  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [homeReady, setHomeReady] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory | "">("");
  const [priority, setPriority] = useState<UiPriority | null>(null);
  const [permission, setPermission] = useState<PermissionChoice | "">("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const openRef = useRef(open);
  openRef.current = open;
  const savingRef = useRef(false);
  const submitGenerationRef = useRef(0);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  // Reset + load home only when the dialog opens — not when `app` identity flips.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setCategory("");
    setPriority(null);
    setPermission("");
    setFiles([]);
    setHome(null);
    setHomeReady(false);
    setSaving(false);
    savingRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getTenantHomeContext();
        if (cancelled || !openRef.current) return;
        setHome(ctx);
      } catch (err) {
        if (!cancelled && openRef.current) setError((err as Error).message);
      } finally {
        if (!cancelled && openRef.current) setHomeReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, getTenantHomeContext, setError]);

  const homeLabel = !homeReady
    ? "Loading unit…"
    : home
      ? [home.unit_label ? `Unit ${home.unit_label}` : null, home.property_name]
          .filter(Boolean)
          .join(" · ") || "Your unit"
      : "Your unit";

  const noUnit = homeReady && home != null && home.unit_id == null;
  const canSubmit =
    homeReady &&
    !saving &&
    !noUnit &&
    home?.unit_id != null &&
    Boolean(title.trim()) &&
    Boolean(description.trim()) &&
    category !== "" &&
    priority != null &&
    permission !== "";

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_MAINTENANCE_PHOTOS));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function requestClose() {
    // Bump generation so an in-flight submit ignores its result.
    submitGenerationRef.current += 1;
    savingRef.current = false;
    setSaving(false);
    onOpenChange(false);
  }

  async function save() {
    if (!canSubmit || savingRef.current) return;
    const selectedCategory = category;
    const selectedPriority = priority;
    const selectedPermission = permission;
    if (
      !selectedCategory ||
      selectedPriority == null ||
      !selectedPermission
    ) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const generation = submitGenerationRef.current;
    try {
      const created = await submitTenantRequest({
        title: title.trim(),
        description: description.trim(),
        category: selectedCategory,
        permission_to_enter: selectedPermission === "yes",
        priority: PRIORITY_TO_DB[selectedPriority],
      });
      if (generation !== submitGenerationRef.current || !openRef.current) return;

      let photoFail = false;
      if (files.length) {
        try {
          await Promise.all(
            files
              .slice(0, MAX_MAINTENANCE_PHOTOS)
              .map((file) => uploadMaintenancePhoto(created.id, file)),
          );
        } catch (photoErr) {
          photoFail = true;
          if (generation === submitGenerationRef.current && openRef.current) {
            setError((photoErr as Error).message);
          }
        }
      }
      if (generation !== submitGenerationRef.current || !openRef.current) return;

      setNotice(
        photoFail
          ? "Request submitted, but photo upload failed — open the request to add photos."
          : files.length
            ? "Request submitted with photos. Staff will update status in the portal."
            : "Request submitted. Staff will update status in the portal.",
      );
      await onSaved?.(created);
      if (generation !== submitGenerationRef.current || !openRef.current) return;
      onOpenChange(false);
    } catch (err) {
      if (generation === submitGenerationRef.current && openRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (generation === submitGenerationRef.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
        else onOpenChange(true);
      }}
    >
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
              disabled={!homeReady || noUnit}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tenant-category" className="text-xs font-semibold">
              Category <span aria-hidden>*</span>
            </Label>
            <Select
              value={category || undefined}
              onValueChange={(v) => setCategory(v as MaintenanceCategory)}
              disabled={!homeReady || noUnit}
            >
              <SelectTrigger id="tenant-category" className="h-12 min-h-11 w-full">
                <SelectValue placeholder="Select a category" />
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
              disabled={!homeReady || noUnit}
              className="min-h-[100px] text-[0.9375rem]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tenant-photos" className="text-xs font-semibold">
              Photos
            </Label>
            <label
              htmlFor="tenant-photos"
              className={cn(
                "flex min-h-[86px] cursor-pointer flex-col justify-center rounded-sm border border-border bg-muted px-4 py-3",
                (!homeReady || noUnit || files.length >= MAX_MAINTENANCE_PHOTOS) &&
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
                id="tenant-photos"
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={!homeReady || noUnit || files.length >= MAX_MAINTENANCE_PHOTOS}
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
            <p id="tenant-priority-label" className="text-xs font-semibold text-foreground">
              Priority <span aria-hidden>*</span>
            </p>
            <div
              role="group"
              aria-labelledby="tenant-priority-label"
              className="grid grid-cols-3 gap-2"
            >
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
                  disabled={!homeReady || noUnit}
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
            <Label htmlFor="tenant-permission" className="text-xs font-semibold">
              Permission to enter <span aria-hidden>*</span>
            </Label>
            <Select
              value={permission || undefined}
              onValueChange={(v) => setPermission(v as PermissionChoice)}
              disabled={!homeReady || noUnit}
            >
              <SelectTrigger id="tenant-permission" className="h-12 min-h-11 w-full">
                <SelectValue placeholder="Select permission" />
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
              onClick={requestClose}
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
              {!homeReady ? "Loading…" : saving ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
