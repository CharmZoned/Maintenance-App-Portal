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
import { ChoiceGroup, ErrorRetry, FloatingBanner, type ChoiceOption } from "@/components/patterns";
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

const PRIORITY_CHOICES: readonly ChoiceOption<UiPriority>[] = [
  { value: "normal", label: "Normal" },
  // Stores DB 'high', so it reads "High" like everywhere else.
  { value: "urgent", label: "High" },
  { value: "emergency", label: "Emergency" },
];

const SAVE_ERROR = "We couldn’t send your request. Check your connection and try again.";

function newSubmissionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Where the draft is: being typed, being sent, or sent and failed (kept for Retry). */
type DraftPhase = "editing" | "saving" | "failed";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean, meta?: { skipReload?: boolean }) => void;
  /** Receives the created request so callers can select it immediately. */
  onSaved?: (created: WorkOrder) => void | Promise<void>;
}

/**
 * Tenant new-request form — drawer on md+, full-screen sheet on phone (Figma).
 * Submit stays live via `submitTenantMaintenanceRequest`.
 *
 * Closing mid-save does not cancel it: the request keeps sending, and when it
 * lands the success notice shows and `onSaved` refreshes the caller's list.
 * If it fails after close, an error banner with Retry shows; the draft (and
 * its submission id) is kept, so Retry reopens the form as typed and sends the
 * same request, which can never create a second one.
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
  const [phase, setPhase] = useState<DraftPhase>("editing");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The send failed after the form was closed: banner with Retry. */
  const [closedFailure, setClosedFailure] = useState<string | null>(null);
  /** Retry was pressed: send the kept draft as soon as the form is ready. */
  const retryPendingRef = useRef(false);
  const saving = phase === "saving";

  const openRef = useRef(open);
  openRef.current = open;
  const savingRef = useRef(false);
  /** Idempotency key for this draft; the same key on every send of it. */
  const submissionIdRef = useRef<string>(newSubmissionId());
  /** Start the next open on a blank form (first open, or after a sent request). */
  const resetOnOpenRef = useRef(true);
  const titleRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  // Load home when the dialog opens — not when `app` identity flips. A draft
  // that is still sending, or failed, is kept as typed; otherwise start blank.
  useEffect(() => {
    if (!open) return;
    if (resetOnOpenRef.current && !savingRef.current) {
      resetOnOpenRef.current = false;
      submissionIdRef.current = newSubmissionId();
      setTitle("");
      setDescription("");
      setCategory(DEFAULT_CATEGORY);
      setPriority(DEFAULT_PRIORITY);
      setPermission(DEFAULT_PERMISSION);
      setFiles([]);
      setPhase("editing");
      setSaveError(null);
    }
    setHome(null);
    setHomeStatus("loading");
    setHomeError(null);
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
  // Typing can start while the unit loads; only Submit waits for it.
  const fieldsDisabled = noUnit || saving;
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

  // Closing never cancels a send in flight: it finishes in the background.
  function requestClose() {
    // Cancel discards an unsent draft; one still sending, or one that failed
    // to send, is kept for when the form opens again.
    if (!savingRef.current && phase !== "failed") resetOnOpenRef.current = true;
    onOpenChange(false, { skipReload: savingRef.current });
  }

  const latest = useRef({ title, description, category, permission, priority, files, contextReady });
  latest.current = { title, description, category, permission, priority, files, contextReady };

  async function save() {
    const d = latest.current;
    if (!d.contextReady || !d.title.trim() || !d.description.trim() || savingRef.current) return;
    // Second guard: the submission id. A double tap, a retry or a lost
    // response all send the same id and get the same request back.
    savingRef.current = true;
    setPhase("saving");
    setSaveError(null);
    try {
      const created = await submitTenantRequest({
        title: d.title.trim(),
        description: d.description.trim(),
        category: d.category,
        permission_to_enter: d.permission === "yes",
        priority: PRIORITY_TO_DB[d.priority],
        client_submission_id: submissionIdRef.current,
      });

      let photoFail = false;
      if (d.files.length) {
        try {
          await Promise.all(
            d.files.slice(0, MAX_MAINTENANCE_PHOTOS).map((file) => uploadMaintenancePhoto(created.id, file)),
          );
        } catch {
          photoFail = true;
        }
      }

      if (photoFail) {
        setError("Request submitted, but the photos didn’t upload. Open the request to add them.");
      } else {
        setNotice(
          d.files.length
            ? "Request submitted with photos. Staff will update status in the portal."
            : "Request submitted. Staff will update status in the portal.",
        );
      }
      // The next open starts blank with a new submission id.
      resetOnOpenRef.current = true;
      setPhase("editing");
      savingRef.current = false;
      await onSaved?.(created);
      if (openRef.current) onOpenChange(false, { skipReload: true });
    } catch (err) {
      savingRef.current = false;
      const raw = (err as Error)?.message?.trim();
      const message = raw && !/fetch|network/i.test(raw) ? raw : SAVE_ERROR;
      setPhase("failed");
      setSaveError(message);
      if (!openRef.current) setClosedFailure(message);
    }
  }

  // An open form needs no closed-form banner.
  useEffect(() => {
    if (open) setClosedFailure(null);
  }, [open]);

  // Retry from the banner: the form reopens with the draft and sends it again
  // (same submission id) once the unit has loaded.
  useEffect(() => {
    if (!open || !contextReady || !retryPendingRef.current) return;
    retryPendingRef.current = false;
    if (phase === "failed") void save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contextReady]);

  function retryFromBanner() {
    setClosedFailure(null);
    retryPendingRef.current = true;
    onOpenChange(true);
  }

  return (
    <>
      {closedFailure && !open ? (
        <FloatingBanner
          tone="error"
          onDismiss={() => setClosedFailure(null)}
          message={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {closedFailure === SAVE_ERROR
                  ? "Your request wasn’t sent. Check your connection and try again."
                  : `Your request wasn’t sent: ${closedFailure}`}
              </span>
              <button
                type="button"
                onClick={retryFromBanner}
                className="font-semibold underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                Retry
              </button>
            </span>
          }
        />
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
          else onOpenChange(true);
        }}
      >
        <DialogContent
          // Open on the first field, not Cancel (unless it is disabled mid-send).
          onOpenAutoFocus={(e) => {
            const field = titleRef.current;
            if (field && !field.disabled) {
              e.preventDefault();
              field.focus();
            }
          }}
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
                ref={titleRef}
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

            {/* A disabled fieldset disables the native radios inside ChoiceGroup. */}
            <fieldset disabled={fieldsDisabled} className="m-0 min-w-0 border-0 p-0 disabled:opacity-60">
              <ChoiceGroup
                label="Priority"
                name="tenant-priority"
                value={priority}
                onChange={setPriority}
                options={PRIORITY_CHOICES}
              />
            </fieldset>

            <SupportContactNotice variant={priority === "emergency" ? "urgent" : "compact"} />

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

            {phase === "failed" && saveError ? (
              <p role="alert" className="rounded-sm bg-destructive-tint px-3 py-2 text-sm leading-5 text-destructive">
                {saveError} Your request is still here.
              </p>
            ) : null}

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="h-11 min-h-11 flex-1 text-sm text-brand-text sm:flex-none sm:w-[136px]"
                onClick={requestClose}
              >
                {saving ? "Close" : "Cancel"}
              </Button>
              <Button
                type="button"
                variant="brand"
                className="h-11 min-h-11 flex-[2] text-sm"
                onClick={() => void save()}
                disabled={!canSubmit}
                aria-describedby={saving ? "tenant-submit-status" : undefined}
              >
                {saving
                  ? "Submitting…"
                  : homeStatus === "loading"
                    ? "Loading…"
                    : phase === "failed"
                      ? "Try again"
                      : "Submit"}
              </Button>
            </div>
            <p id="tenant-submit-status" aria-live="polite" className="-mt-2 min-h-4 text-xs leading-4 text-muted-foreground">
              {saving ? "Sending your request. You can close this; we’ll tell you when it’s in." : ""}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
