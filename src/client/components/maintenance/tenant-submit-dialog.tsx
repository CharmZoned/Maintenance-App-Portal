import { useEffect, useMemo, useRef, useState } from "react";
import { SupportContactNotice } from "@/components/patterns/support-contact-notice";
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
import { ErrorRetry } from "@/components/patterns";
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

const DEFAULT_CATEGORY: MaintenanceCategory = "General repair";
const DEFAULT_PRIORITY: UiPriority = "normal";
const DEFAULT_PERMISSION: PermissionChoice = "no";

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean, meta?: { skipReload?: boolean }) => void;
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
  const [homeStatus, setHomeStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeRetryKey, setHomeRetryKey] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory>(DEFAULT_CATEGORY);
  const [priority, setPriority] = useState<UiPriority>(DEFAULT_PRIORITY);
  const [permission, setPermission] =
    useState<PermissionChoice>(DEFAULT_PERMISSION);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const openRef = useRef(open);
  openRef.current = open;
  const savingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

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
    setCategory(DEFAULT_CATEGORY);
    setPriority(DEFAULT_PRIORITY);
    setPermission(DEFAULT_PERMISSION);
    setFiles([]);
    setHome(null);
    setHomeStatus("loading");
    setHomeError(null);
    // Do not clear savingRef here if a prior abort is still finishing.
    if (!savingRef.current) setSaving(false);
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getTenantHomeContext();
        if (cancelled || !openRef.current) return;
        if (ctx == null) {
          setHome(null);
          setHomeError("Couldn’t load your unit. Try again.");
          setHomeStatus("error");
          return;
        }
        setHome(ctx);
        setHomeError(null);
        setHomeStatus("ready");
      } catch (err) {
        if (!cancelled && openRef.current) {
          setHome(null);
          setHomeError((err as Error).message || "Couldn’t load your unit.");
          setHomeStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, homeRetryKey, getTenantHomeContext]);

  const homeLabel =
    homeStatus === "loading"
      ? "Loading unit…"
      : home
        ? [home.unit_label ? `Unit ${home.unit_label}` : null, home.property_name]
            .filter(Boolean)
            .join(" · ") || "Your unit"
        : "Your unit";

  const noUnit = homeStatus === "ready" && home != null && home.unit_id == null;
  const contextReady = homeStatus === "ready" && home?.unit_id != null;
  const fieldsDisabled = homeStatus !== "ready" || noUnit || saving;
  const canSubmit =
    contextReady &&
    !saving &&
    Boolean(title.trim()) &&
    Boolean(description.trim());

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_MAINTENANCE_PHOTOS));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function requestClose() {
    const wasSaving = savingRef.current;
    abortRef.current?.abort();
    // Keep savingRef set until save()'s finally runs so a reopen cannot double-submit.
    onOpenChange(false, { skipReload: wasSaving });
  }

  async function save() {
    if (!canSubmit || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const created = await submitTenantRequest(
        {
          title: title.trim(),
          description: description.trim(),
          category,
          permission_to_enter: permission === "yes",
          priority: PRIORITY_TO_DB[priority],
        },
        { signal: ac.signal },
      );
      ac.signal.throwIfAborted();

      let photoFail = false;
      if (files.length) {
        try {
          await Promise.all(
            files
              .slice(0, MAX_MAINTENANCE_PHOTOS)
              .map((file) =>
                uploadMaintenancePhoto(created.id, file, undefined, {
                  signal: ac.signal,
                }),
              ),
          );
        } catch (photoErr) {
          if (isAbortError(photoErr) || ac.signal.aborted) throw photoErr;
          photoFail = true;
          if (openRef.current) setError((photoErr as Error).message);
        }
      }
      ac.signal.throwIfAborted();

      setNotice(
        photoFail
          ? "Request submitted, but photo upload failed — open the request to add photos."
          : files.length
            ? "Request submitted with photos. Staff will update status in the portal."
            : "Request submitted. Staff will update status in the portal.",
      );
      await onSaved?.(created);
      if (!ac.signal.aborted && openRef.current) onOpenChange(false);
    } catch (err) {
      if (isAbortError(err) || ac.signal.aborted) {
        // Dismissed mid-submit — do not toast; skipReload already set.
        return;
      }
      if (openRef.current) setError((err as Error).message);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      savingRef.current = false;
      setSaving(false);
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

          {homeStatus === "error" ? (
            <ErrorRetry
              message={homeError || "Couldn’t load your unit."}
              onRetry={() => setHomeRetryKey((k) => k + 1)}
            />
          ) : null}

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
              disabled={fieldsDisabled}
              aria-required="true"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tenant-category" className="text-xs font-semibold">
              Category <span aria-hidden>*</span>
            </Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as MaintenanceCategory)}
              disabled={fieldsDisabled}
            >
              <SelectTrigger
                id="tenant-category"
                className="h-12 min-h-11 w-full"
                aria-required="true"
              >
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
              disabled={fieldsDisabled}
              className="min-h-[100px] text-[0.9375rem]"
              aria-required="true"
              required
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
                (fieldsDisabled || files.length >= MAX_MAINTENANCE_PHOTOS) &&
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
                disabled={fieldsDisabled || files.length >= MAX_MAINTENANCE_PHOTOS}
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
              aria-required="true"
              className="grid grid-cols-3 gap-2"
            >
              {(
                [
                  ["normal", "Normal"],
                  // Stores DB 'high', so it reads "High" like everywhere else.
                  ["urgent", "High"],
                  ["emergency", "Emergency"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={fieldsDisabled}
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

          <SupportContactNotice variant="urgent" />

          <div className="space-y-1.5">
            <Label htmlFor="tenant-permission" className="text-xs font-semibold">
              Permission to enter <span aria-hidden>*</span>
            </Label>
            <Select
              value={permission}
              onValueChange={(v) => setPermission(v as PermissionChoice)}
              disabled={fieldsDisabled}
            >
              <SelectTrigger
                id="tenant-permission"
                className="h-12 min-h-11 w-full"
                aria-required="true"
              >
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
              {homeStatus === "loading"
                ? "Loading…"
                : saving
                  ? "Submitting…"
                  : "Submit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
