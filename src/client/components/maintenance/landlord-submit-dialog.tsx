import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Upload,
  X,
} from "lucide-react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
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
  createLandlordRequest,
  MAX_LANDLORD_REQUEST_PHOTOS,
} from "@/lib/landlord-requests";
import { priorityLabel } from "@/lib/request-status";
import { cn } from "@/lib/utils";
import {
  MAINTENANCE_CATEGORIES,
  type MaintenanceCategory,
  type Unit,
  type WorkOrderPriority,
} from "@/types";

/** Priority choices on the form (owner decision D5: Normal / High / Emergency). */
const PRIORITIES: WorkOrderPriority[] = ["normal", "high", "urgent"];

/** Select value for "no unit". Radix Select cannot use an empty string as an item value. */
const COMMON_AREA = "common";

export interface LandlordSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open with this property chosen (property page). */
  presetPropertyId?: number;
  /** Open with this unit (and its property) chosen (unit page). */
  presetUnitId?: number;
  /** Called once the request row exists, before the success view shows. */
  onCreated?: (id: number) => void;
}

type FieldErrors = Partial<Record<"property" | "title" | "category", string>>;

type Phase =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string }
  | { kind: "success"; requestNumber: string | null; photoNote: string | null };

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** "1A" → "Unit 1A"; a name that already says "Unit …" is kept as is. */
export function unitDisplayName(name: string): string {
  const trimmed = name.trim();
  return /^unit\b/i.test(trimmed) ? trimmed : `Unit ${trimmed}`;
}

/**
 * Who will see the request, in one line (owner decision D3). The current
 * tenant of a unit sees a landlord-filed request on it, view only; nobody but
 * the landlord and the office sees a common-area request.
 */
export function landlordRequestAudienceNote(unit: Pick<Unit, "name"> | null): string {
  if (!unit) return "Leave empty for a common area. Tenants won’t see common-area requests.";
  return `The tenant of ${unitDisplayName(unit.name)} will see this request.`;
}

/**
 * Landlord "Report an issue" form (Figma U10 · Submit request form · Landlord).
 * Centered dialog on sm+, full-screen sheet with a pinned submit on phone.
 * Landlord wave LG-C.
 */
export function LandlordSubmitDialog({
  open,
  onOpenChange,
  presetPropertyId,
  presetUnitId,
  onCreated,
}: LandlordSubmitDialogProps) {
  const app = useApp();
  const properties = app.properties;
  const listUnits = app.listUnits;

  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsStatus, setUnitsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [propertyId, setPropertyId] = useState<string>("");
  const [unitValue, setUnitValue] = useState<string>("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory | "">("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState<WorkOrderPriority>("normal");
  const [permission, setPermission] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const openRef = useRef(open);
  openRef.current = open;
  const abortRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );
  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  // Reset the form and load the landlord's units each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setCategory("");
    setDetails("");
    setPriority("normal");
    setPermission(false);
    setFiles([]);
    setErrors({});
    setPhase({ kind: "form" });
    setUnitValue(presetUnitId != null ? String(presetUnitId) : "");
    setPropertyId(presetPropertyId != null ? String(presetPropertyId) : "");
    setUnitsStatus("loading");
    let cancelled = false;
    (async () => {
      try {
        const rows = await listUnits();
        if (cancelled) return;
        setUnits(rows);
        setUnitsStatus("ready");
        if (presetUnitId != null) {
          const unit = rows.find((u) => u.id === presetUnitId);
          if (unit) setPropertyId(String(unit.property_id));
        }
      } catch {
        if (!cancelled) {
          setUnits([]);
          setUnitsStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, presetPropertyId, presetUnitId, listUnits]);

  // One property: choose it for the landlord.
  useEffect(() => {
    if (!open || propertyId || properties.length !== 1) return;
    setPropertyId(String(properties[0].id));
  }, [open, propertyId, properties]);

  const propertyUnits = useMemo(
    () =>
      units
        .filter((u) => String(u.property_id) === propertyId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [units, propertyId],
  );
  const selectedUnit =
    unitValue && unitValue !== COMMON_AREA
      ? (propertyUnits.find((u) => String(u.id) === unitValue) ?? null)
      : null;

  const submitting = phase.kind === "submitting";
  const noProperties = !app.loading && properties.length === 0;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_LANDLORD_REQUEST_PHOTOS));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function close() {
    abortRef.current?.abort();
    onOpenChange(false);
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!propertyId) next.property = "Choose a property.";
    if (!title.trim()) next.title = "Describe the problem in a few words.";
    if (!category) next.category = "Choose a category.";
    return next;
  }

  async function submit() {
    if (submittingRef.current) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = found.property
        ? "landlord-request-property"
        : found.title
          ? "landlord-request-title"
          : "landlord-request-category";
      document.getElementById(first)?.focus();
      return;
    }
    submittingRef.current = true;
    setPhase({ kind: "submitting" });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const result = await createLandlordRequest(
        {
          property_id: Number(propertyId),
          unit_id: selectedUnit ? selectedUnit.id : null,
          title,
          description: details,
          category: category as MaintenanceCategory,
          priority,
          permission_to_enter: permission,
          photos: files,
        },
        { signal: ac.signal },
      );
      if (ac.signal.aborted || !openRef.current) return;
      onCreated?.(result.request.id);
      const missing = files.length - result.photosUploaded;
      setPhase({
        kind: "success",
        requestNumber: result.request.request_number ?? null,
        photoNote:
          missing > 0
            ? `${missing === 1 ? "One photo" : `${missing} photos`} didn’t upload. Send them to the office from Messages.`
            : null,
      });
    } catch (err) {
      if (isAbortError(err) || ac.signal.aborted) return;
      if (openRef.current) {
        setPhase({
          kind: "failed",
          message: (err as Error).message || "Something went wrong.",
        });
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      submittingRef.current = false;
    }
  }

  const photoCount = `${files.length} of ${MAX_LANDLORD_REQUEST_PHOTOS} · optional`;
  const photosFull = files.length >= MAX_LANDLORD_REQUEST_PHOTOS;
  const photoInputProps = {
    type: "file" as const,
    accept: "image/*",
    className: "sr-only",
    disabled: submitting || photosFull,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(e.target.files);
      e.target.value = "";
    },
  };
  const photoButtonClass = cn(
    "inline-flex h-11 min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-secondary px-2 text-sm font-medium text-foreground shadow-raised hover:bg-muted sm:h-8 sm:min-h-0",
    (submitting || photosFull) && "cursor-not-allowed opacity-50",
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogPortal>
        <DialogOverlay className="p-0 sm:p-4">
          {/* Keep the phone sheet's header clear of the fixed staging ribbon. */}
          <div
            className="flex min-h-full items-stretch justify-center sm:items-center"
            style={{ paddingTop: "var(--staging-ribbon-offset, 0px)" }}
          >
            <DialogPrimitive.Content
              aria-describedby="landlord-request-description"
              className={cn(
                "relative z-50 flex w-full flex-col bg-card text-card-foreground outline-none",
                "min-h-[calc(100dvh-var(--staging-ribbon-offset,0px))] sm:min-h-0 sm:max-w-[700px] sm:rounded-lg sm:shadow-float",
              )}
            >
              <header className="flex items-start gap-3 border-b border-border px-4 py-3.5 sm:border-b-0 sm:px-8 sm:pb-0 sm:pt-7">
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="text-[1.0625rem] font-semibold leading-tight">
                    Report an issue
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description
                    id="landlord-request-description"
                    className="sr-only text-sm text-muted-foreground sm:not-sr-only sm:mt-1.5 sm:block"
                  >
                    Landlord Gopher will assign someone and keep you posted.
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close
                  className="order-first -m-1 rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:order-last"
                  aria-label="Close"
                >
                  <X className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />
                </DialogPrimitive.Close>
              </header>

              {phase.kind === "success" ? (
                <div
                  className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center sm:px-8"
                  role="status"
                >
                  <CheckCircle2 className="size-7 text-success" aria-hidden />
                  <p className="text-base font-semibold">Request submitted</p>
                  <p className="max-w-[26rem] text-sm text-muted-foreground">
                    {phase.requestNumber ? `${phase.requestNumber} is in. ` : ""}
                    Landlord Gopher will assign someone and keep you posted. Track it
                    from Maintenance.
                  </p>
                  {phase.photoNote ? (
                    <p className="max-w-[26rem] rounded-sm bg-warning-tint px-3 py-2 text-sm text-warning">
                      {phase.photoNote}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="default"
                    size="lg"
                    className="mt-2 h-11 min-w-[8rem] sm:h-8"
                    onClick={() => onOpenChange(false)}
                  >
                    Done
                  </Button>
                </div>
              ) : (
                <form
                  className="flex flex-1 flex-col"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <fieldset
                    disabled={submitting}
                    className="flex-1 space-y-5 px-4 py-5 sm:px-8 sm:pb-6 sm:pt-5"
                  >
                    {noProperties ? (
                      <p className="rounded-sm bg-warning-tint px-3 py-2 text-sm text-warning">
                        No properties are linked to your account yet. Message Landlord
                        Gopher to get set up.
                      </p>
                    ) : null}

                    <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="landlord-request-property">Property</Label>
                        <Select
                          value={propertyId}
                          onValueChange={(v) => {
                            setPropertyId(v);
                            setUnitValue("");
                            setErrors((e) => ({ ...e, property: undefined }));
                          }}
                        >
                          <SelectTrigger
                            id="landlord-request-property"
                            className="h-11 w-full sm:h-8"
                            aria-invalid={errors.property ? true : undefined}
                            aria-describedby={errors.property ? "landlord-request-property-error" : undefined}
                          >
                            <SelectValue placeholder="Choose a property" />
                          </SelectTrigger>
                          <SelectContent>
                            {properties.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors.property ? (
                          <p id="landlord-request-property-error" className="text-xs text-destructive">
                            {errors.property}
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="landlord-request-unit">Unit (optional)</Label>
                        <Select
                          value={unitValue}
                          onValueChange={setUnitValue}
                          disabled={!propertyId || unitsStatus === "loading"}
                        >
                          <SelectTrigger
                            id="landlord-request-unit"
                            className="h-11 w-full sm:h-8"
                            aria-describedby="landlord-request-unit-note"
                          >
                            <SelectValue
                              placeholder={
                                unitsStatus === "loading" && propertyId ? "Loading units…" : "Choose a unit"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={COMMON_AREA}>Common area</SelectItem>
                            {propertyUnits.map((u) => (
                              <SelectItem key={u.id} value={String(u.id)}>
                                {unitDisplayName(u.name)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p
                          id="landlord-request-unit-note"
                          className="text-xs text-muted-foreground"
                          data-audience={selectedUnit ? "unit-tenant" : "common-area"}
                        >
                          {unitsStatus === "error"
                            ? "Couldn’t load your units. You can still file for a common area."
                            : landlordRequestAudienceNote(selectedUnit)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="landlord-request-title">What’s the problem?</Label>
                      <Input
                        id="landlord-request-title"
                        className={cn(
                          "h-11 sm:h-8",
                          errors.title && "shadow-[inset_0_0_0_1px_var(--destructive-solid)]",
                        )}
                        value={title}
                        maxLength={120}
                        onChange={(e) => {
                          setTitle(e.target.value);
                          if (errors.title) setErrors((x) => ({ ...x, title: undefined }));
                        }}
                        placeholder="Short summary, e.g. Kitchen tap dripping"
                        aria-invalid={errors.title ? true : undefined}
                        aria-describedby={errors.title ? "landlord-request-title-error" : undefined}
                      />
                      {errors.title ? (
                        <p id="landlord-request-title-error" className="text-xs text-destructive">
                          {errors.title}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="landlord-request-category">Category</Label>
                      <Select
                        value={category}
                        onValueChange={(v) => {
                          setCategory(v as MaintenanceCategory);
                          setErrors((x) => ({ ...x, category: undefined }));
                        }}
                      >
                        <SelectTrigger
                          id="landlord-request-category"
                          className={cn(
                            "h-11 w-full sm:h-8",
                            errors.category && "shadow-[inset_0_0_0_1px_var(--destructive-solid)]",
                          )}
                          aria-invalid={errors.category ? true : undefined}
                          aria-describedby={errors.category ? "landlord-request-category-error" : undefined}
                        >
                          <SelectValue placeholder="Choose a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {MAINTENANCE_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.category ? (
                        <p id="landlord-request-category-error" className="text-xs text-destructive">
                          {errors.category}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="landlord-request-details">Details</Label>
                      <Textarea
                        id="landlord-request-details"
                        value={details}
                        onChange={(e) => setDetails(e.target.value)}
                        rows={3}
                        placeholder="What’s happening, and where?"
                        className="min-h-[104px] sm:min-h-[78px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium" id="landlord-request-photos-label">
                          Photos
                        </p>
                        <p className="text-xs text-muted-foreground" aria-live="polite">
                          {photoCount}
                        </p>
                      </div>
                      <div
                        className="grid grid-cols-2 gap-2 sm:flex"
                        role="group"
                        aria-labelledby="landlord-request-photos-label"
                      >
                        <label className={cn(photoButtonClass, "hidden sm:inline-flex")}>
                          <Upload aria-hidden className="size-4" />
                          Add photos
                          <input {...photoInputProps} multiple />
                        </label>
                        <label className={cn(photoButtonClass, "sm:hidden")}>
                          <Camera aria-hidden className="size-4" />
                          Take photo
                          <input {...photoInputProps} capture="environment" />
                        </label>
                        <label className={cn(photoButtonClass, "sm:hidden")}>
                          <ImageIcon aria-hidden className="size-4" />
                          Choose from library
                          <input {...photoInputProps} multiple />
                        </label>
                      </div>
                      {previews.length > 0 ? (
                        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {previews.map((p, i) => (
                            <li
                              key={p.url}
                              className="relative overflow-hidden rounded-sm border border-border"
                            >
                              <img
                                src={p.url}
                                alt={p.file.name}
                                className="aspect-square w-full object-cover"
                              />
                              <button
                                type="button"
                                className="absolute right-1 top-1 rounded-sm bg-background/90 p-1"
                                onClick={() => removeFile(i)}
                                aria-label={`Remove ${p.file.name}`}
                              >
                                <X className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-sm font-medium" id="landlord-request-priority-label">
                        Priority
                      </p>
                      <div
                        role="radiogroup"
                        aria-labelledby="landlord-request-priority-label"
                        className="grid grid-cols-3 gap-2"
                      >
                        {PRIORITIES.map((p) => (
                          <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={priority === p}
                            onClick={() => setPriority(p)}
                            className={cn(
                              "flex h-11 items-center justify-center rounded-sm border text-sm sm:h-8",
                              priority === p
                                ? p === "urgent"
                                  ? "border-destructive/40 bg-destructive-tint font-medium text-destructive"
                                  : "border-transparent bg-brand-tint font-medium text-brand-text"
                                : "border-border bg-card text-foreground hover:bg-muted",
                            )}
                          >
                            {priorityLabel(p)}
                          </button>
                        ))}
                      </div>
                      {priority === "urgent" ? (
                        <p
                          role="note"
                          className="rounded-sm bg-destructive-tint px-3 py-2 text-sm text-destructive"
                        >
                          For fire, gas or flooding call 911 first. Then submit this so
                          Landlord Gopher can follow up.
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-sm font-medium" id="landlord-request-permission-label">
                        Permission to enter
                      </p>
                      <div
                        role="radiogroup"
                        aria-labelledby="landlord-request-permission-label"
                        aria-describedby="landlord-request-permission-note"
                        className="grid grid-cols-2 gap-2"
                      >
                        {(
                          [
                            [false, "No, arrange a time"],
                            [true, "Yes, they can enter"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={String(value)}
                            type="button"
                            role="radio"
                            aria-checked={permission === value}
                            onClick={() => setPermission(value)}
                            className={cn(
                              "flex h-11 items-center justify-center rounded-sm border px-2 text-sm sm:h-8",
                              permission === value
                                ? "border-transparent bg-brand-tint font-medium text-brand-text"
                                : "border-border bg-card text-foreground hover:bg-muted",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p id="landlord-request-permission-note" className="text-xs text-muted-foreground">
                        {permission
                          ? "A worker may go in if no one is home."
                          : "Landlord Gopher will arrange a time before anyone goes in."}
                      </p>
                    </div>
                  </fieldset>

                  {phase.kind === "failed" ? (
                    <div
                      role="alert"
                      className="mx-4 mb-3 flex items-start gap-2 rounded-sm bg-destructive-tint px-3 py-2.5 text-sm text-destructive sm:mx-8"
                    >
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Request wasn’t submitted. Your details are kept.</p>
                        <p className="mt-0.5 break-words text-xs">{phase.message}</p>
                      </div>
                      <button
                        type="button"
                        className="rounded-sm p-0.5 hover:bg-destructive/10"
                        onClick={() => setPhase({ kind: "form" })}
                        aria-label="Dismiss"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                  ) : null}

                  <footer
                    className={cn(
                      "sticky bottom-0 flex items-center gap-3 border-t border-border bg-card px-4 py-3",
                      "sm:static sm:justify-end sm:border-t-0 sm:px-8 sm:pb-7 sm:pt-0",
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="hidden sm:inline-flex"
                      onClick={close}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="default"
                      className="h-12 w-full text-[0.9375rem] sm:h-7 sm:w-auto sm:px-3 sm:text-sm"
                      disabled={submitting || noProperties}
                    >
                      {submitting ? "Submitting…" : "Submit request"}
                    </Button>
                  </footer>
                </form>
              )}
            </DialogPrimitive.Content>
          </div>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  );
}
