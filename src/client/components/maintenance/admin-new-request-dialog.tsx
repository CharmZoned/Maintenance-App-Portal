import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CircleAlert, Upload, X } from "lucide-react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
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
import { PRIORITY_OPTIONS } from "@/lib/request-status";
import { cn } from "@/lib/utils";
import {
  MAINTENANCE_CATEGORIES,
  type NewWorkOrder,
  type Property,
  type Tenant,
  type Unit,
  type WorkOrder,
  type WorkOrderPriority,
} from "@/types";
import { MAX_MAINTENANCE_PHOTOS, takePhotoFiles } from "./work-order-status";

// ── Pure helpers (unit-tested) ──────────────────────────────────────

/** Unit select value for "no specific unit". Stored as `unit_id = null`. */
export const COMMON_AREA = "common";
/** Tenant select value for "nobody reported it / not a tenant". */
export const NO_TENANT = "none";

export interface AdminNewRequestValues {
  title: string;
  /** Property id as a string, or "" when none is chosen yet. */
  propertyId: string;
  /** Unit id as a string, `COMMON_AREA`, or "" when none is chosen. */
  unitChoice: string;
  /** Tenant id as a string, or `NO_TENANT`. */
  tenantChoice: string;
  /** "" until a category is chosen. */
  category: string;
  priority: WorkOrderPriority;
  description: string;
}

export interface AdminNewRequestErrors {
  title?: string;
  property?: string;
  category?: string;
}

export const EMPTY_NEW_REQUEST: AdminNewRequestValues = {
  title: "",
  propertyId: "",
  unitChoice: "",
  tenantChoice: NO_TENANT,
  category: "",
  priority: "normal",
  description: "",
};

/** Field errors, in the copy from the design spec (§5). Empty object = valid. */
export function validateNewRequest(v: AdminNewRequestValues): AdminNewRequestErrors {
  const errors: AdminNewRequestErrors = {};
  if (!v.title.trim()) errors.title = "Enter a title.";
  if (!v.propertyId) errors.property = "Choose a property.";
  if (!v.category || !(MAINTENANCE_CATEGORIES as string[]).includes(v.category)) {
    errors.category = "Choose a category.";
  }
  return errors;
}

export function hasErrors(errors: AdminNewRequestErrors): boolean {
  return Boolean(errors.title || errors.property || errors.category);
}

/** The unit's current tenant (select value), or `NO_TENANT` when nobody lives there. */
export function tenantChoiceForUnit(
  tenants: readonly Pick<Tenant, "id" | "active_unit_id">[],
  unitChoice: string,
): string {
  const unitId = Number(unitChoice);
  if (!unitChoice || unitChoice === COMMON_AREA || !Number.isFinite(unitId)) return NO_TENANT;
  const match = tenants.find((t) => t.active_unit_id === unitId);
  return match ? String(match.id) : NO_TENANT;
}

/** What `createWorkOrder` receives. New requests always start Open, unassigned. */
export function newRequestPayload(v: AdminNewRequestValues): NewWorkOrder & { title: string } {
  const unitId =
    v.unitChoice && v.unitChoice !== COMMON_AREA ? Number(v.unitChoice) : null;
  const tenantId = v.tenantChoice && v.tenantChoice !== NO_TENANT ? Number(v.tenantChoice) : null;
  return {
    title: v.title.trim(),
    description: v.description.trim() || null,
    category: v.category,
    priority: v.priority,
    status: "open",
    property_id: v.propertyId ? Number(v.propertyId) : null,
    unit_id: unitId,
    tenant_id: tenantId,
  };
}

/** Photo counter beside the label: `0 of 5 · optional`. */
export function photoCounterLabel(count: number, max: number = MAX_MAINTENANCE_PHOTOS): string {
  return `${Math.min(count, max)} of ${max} · optional`;
}

export function tenantOptionLabel(
  t: Pick<Tenant, "first_name" | "last_name" | "active_unit_name">,
): string {
  const name = `${t.first_name} ${t.last_name}`.trim() || "Unnamed tenant";
  return t.active_unit_name ? `${name} · Unit ${t.active_unit_name}` : name;
}

/**
 * Success banner copy after the form closes. `failed` is how many photos could
 * not be added (or a plain yes / no); with `total`, a partial failure says how
 * many of them, so one notice covers every photo.
 */
export function createdNotice(failed: number | boolean, total?: number): string {
  const count = failed === true ? (total ?? 1) : failed === false ? 0 : failed;
  if (count <= 0) return "Request created.";
  if (total != null && count < total) {
    const them = count === 1 ? "it" : "them";
    return `Request created, but ${count} of ${total} photos couldn't be added. Add ${them} from the request.`;
  }
  return "Request created, but the photos couldn't be added. Add them from the request.";
}

// ── View (props-driven so it renders without the app context) ───────

const FIELD_CONTROL = "h-11 md:h-8";
const INVALID_CONTROL = "shadow-[inset_0_0_0_1px_var(--destructive)]";

export interface AdminNewRequestFieldsProps {
  values: AdminNewRequestValues;
  errors: AdminNewRequestErrors;
  properties: readonly Pick<Property, "id" | "name">[];
  units: readonly Pick<Unit, "id" | "name">[];
  unitsLoading?: boolean;
  tenants: readonly Pick<Tenant, "id" | "first_name" | "last_name" | "active_unit_name">[];
  photos: readonly { key: string; url: string; name: string }[];
  disabled?: boolean;
  onChange: (patch: Partial<AdminNewRequestValues>) => void;
  onAddPhotos: () => void;
  onRemovePhoto: (index: number) => void;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs leading-4 text-destructive">
      {message}
    </p>
  );
}

/** The Figma admin "New request" field list (§5), in order. */
export function AdminNewRequestFields({
  values,
  errors,
  properties,
  units,
  unitsLoading = false,
  tenants,
  photos,
  disabled = false,
  onChange,
  onAddPhotos,
  onRemovePhoto,
}: AdminNewRequestFieldsProps) {
  const canAddPhotos = photos.length < MAX_MAINTENANCE_PHOTOS;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="anr-title" className="leading-5">
          What's the problem?
        </Label>
        <Input
          id="anr-title"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Dishwasher not draining"
          disabled={disabled}
          aria-required="true"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "anr-title-error" : undefined}
          className={cn(FIELD_CONTROL, errors.title && INVALID_CONTROL)}
        />
        <FieldError id="anr-title-error" message={errors.title} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="anr-property" className="leading-5">
            Property
          </Label>
          <Select
            value={values.propertyId}
            onValueChange={(v) => onChange({ propertyId: v })}
            disabled={disabled}
          >
            <SelectTrigger
              id="anr-property"
              aria-required="true"
              aria-invalid={errors.property ? true : undefined}
              aria-describedby={errors.property ? "anr-property-error" : undefined}
              className={cn(FIELD_CONTROL, errors.property && INVALID_CONTROL)}
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
          <FieldError id="anr-property-error" message={errors.property} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="anr-unit" className="leading-5">
            Unit
          </Label>
          <Select
            value={values.unitChoice}
            onValueChange={(v) => onChange({ unitChoice: v })}
            disabled={disabled || !values.propertyId || unitsLoading}
          >
            <SelectTrigger id="anr-unit" className={FIELD_CONTROL}>
              <SelectValue
                placeholder={
                  !values.propertyId
                    ? "Choose a property first"
                    : unitsLoading
                      ? "Loading units…"
                      : "Choose a unit"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name}
                </SelectItem>
              ))}
              <SelectItem value={COMMON_AREA}>Common area</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="anr-tenant" className="leading-5">
          Tenant
        </Label>
        <Select
          value={values.tenantChoice}
          onValueChange={(v) => onChange({ tenantChoice: v })}
          disabled={disabled}
        >
          <SelectTrigger id="anr-tenant" aria-describedby="anr-tenant-hint" className={FIELD_CONTROL}>
            <SelectValue placeholder="No tenant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TENANT}>No tenant</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {tenantOptionLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id="anr-tenant-hint" className="text-xs leading-4 text-muted-foreground">
          Filled in from the unit. Change it if someone else reported this.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="anr-category" className="leading-5">
            Category
          </Label>
          <Select
            value={values.category}
            onValueChange={(v) => onChange({ category: v })}
            disabled={disabled}
          >
            <SelectTrigger
              id="anr-category"
              aria-required="true"
              aria-invalid={errors.category ? true : undefined}
              aria-describedby={errors.category ? "anr-category-error" : undefined}
              className={cn(FIELD_CONTROL, errors.category && INVALID_CONTROL)}
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
          <FieldError id="anr-category-error" message={errors.category} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="anr-priority" className="leading-5">
            Priority
          </Label>
          <Select
            value={values.priority}
            onValueChange={(v) => onChange({ priority: v as WorkOrderPriority })}
            disabled={disabled}
          >
            <SelectTrigger id="anr-priority" className={FIELD_CONTROL}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="anr-description" className="leading-5">
          Description
        </Label>
        <Textarea
          id="anr-description"
          rows={3}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What's wrong, and anything the technician should know"
          disabled={disabled}
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span id="anr-photos-label" className="text-sm font-medium leading-5">
            Photos
          </span>
          <span className="text-sm leading-5 text-muted-foreground">
            {photoCounterLabel(photos.length)}
          </span>
        </div>
        {photos.length > 0 ? (
          <ul aria-labelledby="anr-photos-label" className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <li
                key={p.key}
                className="relative size-16 overflow-hidden rounded-sm border border-border bg-muted"
              >
                <img src={p.url} alt={p.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemovePhoto(i)}
                  disabled={disabled}
                  aria-label={`Remove photo ${i + 1} of ${photos.length}`}
                  className="absolute right-0.5 top-0.5 inline-flex size-6 items-center justify-center rounded-sm bg-card/90 text-foreground outline-none shadow-raised focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {canAddPhotos ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              className="h-11 w-full md:h-7 md:w-auto"
              onClick={onAddPhotos}
              disabled={disabled}
            >
              <Upload aria-hidden />
              Add photos
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Dialog (container) ──────────────────────────────────────────────

export interface AdminNewRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a property / unit (e.g. opened from a property or unit page). */
  defaults?: { property_id?: number; unit_id?: number };
  /** Called after a successful create, before the dialog closes (same as WorkOrderDialog). */
  onSaved?: () => void;
  /** Receives the created request, e.g. to navigate to `/maintenance/:id`. */
  onCreated?: (created: WorkOrder) => void;
}

/**
 * Admin "New request" (Figma 28:58861, spec §5). Replaces the old 11-field
 * "New work order" create dialog. Unit first: choosing a unit fills in its
 * current tenant. Assigning, prices, vendor and notes happen on the request
 * page afterwards. Phone: full screen with a sticky "Create request" bar.
 */
export function AdminNewRequestDialog({
  open,
  onOpenChange,
  defaults,
  onSaved,
  onCreated,
}: AdminNewRequestDialogProps) {
  const app = useApp();
  const listUnits = app.listUnits;
  const listTenants = app.listTenants;
  const createWorkOrder = app.createWorkOrder;
  const uploadMaintenancePhoto = app.uploadMaintenancePhoto;
  const setNotice = app.setNotice;

  const [values, setValues] = useState<AdminNewRequestValues>(EMPTY_NEW_REQUEST);
  const [submitted, setSubmitted] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [lookupError, setLookupError] = useState(false);
  const [lookupKey, setLookupKey] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const savingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tenantsRef = useRef<Tenant[]>([]);
  tenantsRef.current = tenants;
  /** Unit to select once the default property's units arrive. */
  const pendingUnitRef = useRef<number | null>(null);

  const properties = useMemo(
    () => [...app.properties].sort((a, b) => a.name.localeCompare(b.name)),
    [app.properties],
  );

  // Reset when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setValues({
      ...EMPTY_NEW_REQUEST,
      propertyId: defaults?.property_id != null ? String(defaults.property_id) : "",
    });
    pendingUnitRef.current = defaults?.unit_id ?? null;
    setSubmitted(false);
    setSubmitError(false);
    setFiles([]);
    setLookupError(false);
  }, [open, defaults?.property_id, defaults?.unit_id]);

  // Tenants: once per open (and on Retry).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listTenants();
        if (cancelled) return;
        setTenants(
          [...rows].sort((a, b) =>
            `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`),
          ),
        );
      } catch {
        if (!cancelled) setLookupError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, lookupKey, listTenants]);

  // Units of the chosen property.
  const propertyId = values.propertyId;
  useEffect(() => {
    if (!open || !propertyId) {
      setUnits([]);
      return;
    }
    let cancelled = false;
    setUnitsLoading(true);
    (async () => {
      try {
        const rows = await listUnits(Number(propertyId));
        if (cancelled) return;
        const sorted = [...rows].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
        setUnits(sorted);
        const pending = pendingUnitRef.current;
        pendingUnitRef.current = null;
        if (pending != null && sorted.some((u) => u.id === pending)) {
          const unitChoice = String(pending);
          setValues((prev) => ({
            ...prev,
            unitChoice,
            tenantChoice: tenantChoiceForUnit(tenantsRef.current, unitChoice),
          }));
        }
      } catch {
        if (!cancelled) {
          setUnits([]);
          setLookupError(true);
        }
      } finally {
        if (!cancelled) setUnitsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, propertyId, lookupKey, listUnits]);

  // If tenants arrive after a unit was chosen and nobody picked a tenant yet, fill it in.
  useEffect(() => {
    if (!tenants.length) return;
    setValues((prev) =>
      prev.unitChoice && prev.tenantChoice === NO_TENANT
        ? { ...prev, tenantChoice: tenantChoiceForUnit(tenants, prev.unitChoice) }
        : prev,
    );
  }, [tenants]);

  const previews = useMemo(
    () =>
      files.map((f, i) => ({
        key: `${i}-${f.name}-${f.size}-${f.lastModified}`,
        name: f.name,
        url: URL.createObjectURL(f),
      })),
    [files],
  );
  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  const errors = submitted ? validateNewRequest(values) : {};

  function change(patch: Partial<AdminNewRequestValues>) {
    setSubmitError(false);
    setValues((prev) => {
      const next = { ...prev, ...patch };
      if (patch.propertyId !== undefined && patch.propertyId !== prev.propertyId) {
        next.unitChoice = "";
        next.tenantChoice = NO_TENANT;
      }
      if (patch.unitChoice !== undefined && patch.unitChoice !== prev.unitChoice) {
        next.tenantChoice = tenantChoiceForUnit(tenants, patch.unitChoice);
      }
      return next;
    });
  }

  function addFiles(list: FileList | null) {
    setFiles((prev) => [...prev, ...takePhotoFiles(list, MAX_MAINTENANCE_PHOTOS - prev.length)]);
  }

  function focusFirstInvalid(found: AdminNewRequestErrors) {
    const id = found.title
      ? "anr-title"
      : found.property
        ? "anr-property"
        : found.category
          ? "anr-category"
          : null;
    if (id) document.getElementById(id)?.focus();
  }

  function requestOpenChange(next: boolean) {
    // Never drop a create half way: the dialog stays until the request exists.
    if (!next && savingRef.current) return;
    onOpenChange(next);
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (savingRef.current) return;
    setSubmitted(true);
    const found = validateNewRequest(values);
    if (hasErrors(found)) {
      focusFirstInvalid(found);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSubmitError(false);
    try {
      const created = await createWorkOrder(newRequestPayload(values));
      // One at a time: parallel inserts race the per-request photo cap. A failed
      // photo does not stop the rest; one notice reports them all at the end.
      const toUpload = files.slice(0, MAX_MAINTENANCE_PHOTOS);
      let photosFailed = 0;
      for (const file of toUpload) {
        try {
          await uploadMaintenancePhoto(created.id, file);
        } catch {
          photosFailed += 1;
        }
      }
      setNotice(createdNotice(photosFailed, toUpload.length));
      onCreated?.(created);
      onSaved?.();
      onOpenChange(false);
    } catch {
      setSubmitError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={requestOpenChange}>
      <DialogPortal>
        {/* Phone: full screen below the staging ribbon (the offset is 0px outside staging / local). */}
        <DialogOverlay className="p-0 pt-[var(--staging-ribbon-offset,0px)] md:p-4">
          <div className="flex min-h-full items-stretch justify-center md:items-center">
            <DialogPrimitive.Content
              className={cn(
                "relative z-50 flex w-full flex-col bg-card text-card-foreground outline-none",
                "min-h-[calc(100dvh-var(--staging-ribbon-offset,0px))] md:min-h-0 md:max-w-[680px] md:rounded-lg md:shadow-float",
              )}
            >
              <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-1 flex-col">
                <div className="flex items-start gap-3 border-b border-border px-4 py-3 md:border-0 md:px-5 md:pb-0 md:pt-5">
                  <div className="min-w-0 flex-1 space-y-1 pt-2 md:pt-0">
                    <DialogPrimitive.Title className="text-[17px] font-semibold leading-[22px]">
                      New request
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="text-sm leading-5 text-muted-foreground">
                      For a problem reported by phone, by email or in person.
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="touch-icon"
                      className="-mr-2 md:mr-[-6px] md:mt-[-4px] md:size-7 md:[&_svg]:size-4"
                      aria-label="Close"
                      disabled={saving}
                    >
                      <X aria-hidden />
                    </Button>
                  </DialogPrimitive.Close>
                </div>

                <div className="flex-1 space-y-4 px-4 py-4 md:px-5 md:py-5">
                  {submitError ? (
                    <div
                      role="alert"
                      className="flex items-center gap-2 rounded-md bg-destructive-tint px-4 py-3 text-sm leading-5 text-destructive"
                    >
                      <CircleAlert className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">Couldn't create the request. Try again.</span>
                    </div>
                  ) : null}
                  {lookupError ? (
                    <div
                      role="alert"
                      className="flex items-center gap-2 rounded-md bg-destructive-tint px-4 py-3 text-sm leading-5 text-destructive"
                    >
                      <CircleAlert className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">Couldn't load units and tenants.</span>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 text-destructive hover:bg-transparent hover:text-destructive md:h-7"
                        onClick={() => {
                          setLookupError(false);
                          setLookupKey((k) => k + 1);
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  <AdminNewRequestFields
                    values={values}
                    errors={errors}
                    properties={properties}
                    units={units}
                    unitsLoading={unitsLoading}
                    tenants={tenants}
                    photos={previews}
                    disabled={saving}
                    onChange={change}
                    onAddPhotos={() => fileInputRef.current?.click()}
                    onRemovePhoto={(index) =>
                      setFiles((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>

                <div
                  className={cn(
                    "sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-card px-4 pt-3",
                    "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
                    "md:static md:border-0 md:px-5 md:pb-5 md:pt-0",
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-4 md:h-7 md:px-2"
                    onClick={() => requestOpenChange(false)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="h-11 flex-1 px-4 md:h-7 md:flex-none md:px-2"
                    disabled={saving}
                  >
                    {saving ? "Creating…" : "Create request"}
                  </Button>
                </div>
              </form>
            </DialogPrimitive.Content>
          </div>
        </DialogOverlay>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
