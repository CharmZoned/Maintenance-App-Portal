import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import * as data from "@/lib/data";
import type { StaffMember } from "@/lib/data";
import {
  formatActivityStamp,
  PRIORITY_OPTIONS,
  priorityLevel,
  inProgressSince,
  requestNextStep,
  toRequestStatus,
  type RequestStatus,
} from "@/lib/request-status";
import { buildTimeline, type RequestViewerRole } from "@/lib/request-timeline";
import { cn, formatDate, toIsoDate } from "@/lib/utils";
import {
  MAINTENANCE_CATEGORIES,
  type MaintenanceComment,
  type MaintenancePhoto,
  type MaintenanceStatusEvent,
  type Vendor,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/types";
import {
  RequestActionsPanel,
  RequestStatusMenu,
  WORKER_ACTION_LABEL,
  WORKER_ACTION_TARGET,
  workerPrimaryAction,
} from "./request/request-actions-panel";
import { RequestHeader } from "./request/request-header";
import { RequestPhotosCard } from "./request/request-photos-card";
import {
  RequestBanner,
  RequestErrorState,
  RequestLoadingState,
  RequestNotAvailableState,
  type RequestBannerTone,
} from "./request/request-states";
import { RequestTimeline, type RequestTimelineComposer } from "./request/request-timeline";
import {
  backLinkFor,
  notAvailableActionFor,
  sectionsForRole,
  viewerRoleFrom,
  type RequestSectionVisibility,
} from "./request/role-visibility";
import {
  changedPriceFields,
  MAX_MAINTENANCE_PHOTOS,
  photoSlotsLeft,
  takePhotoFiles,
} from "./work-order-status";

/**
 * THE request page (route /maintenance/:id) for admin, worker (`maintenance`),
 * tenant and landlord. Follows the admin desktop frame of Figma
 * "UPGRADED — Request" (25:987) and shows / hides parts by role through
 * sectionsForRole() (spec §2.6). There is no per-role layout any more: the
 * tenant's narrow "Updates" card and the landlord's separate shell are retired.
 *
 * Layout: header title = request title with "#MR-…" beside it; content = request
 * head (back link, summary line, location line), then a two-column grid on
 * desktop (Details / Photos / Timeline | Actions). Roles without an actions
 * panel keep the same grid with an empty right track. Tablet: one column with
 * Actions before Details. Phone: one column, actions last, sticky primary bar.
 *
 * No "Landlord conversation" card: request messaging with the landlord is out
 * of scope per the SOW.
 */

// ── Pure helpers (exported for tests) ──────────────────────────────

/** "#MR-001000", or "#<id>" for rows without a request number. */
export function requestNumberLabel(order: Pick<WorkOrder, "id" | "request_number">): string {
  const raw = order.request_number?.trim();
  if (!raw) return `#${order.id}`;
  return raw.startsWith("#") ? raw : `#${raw}`;
}

export function personName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

type StaffLookup = ReadonlyMap<number, Pick<StaffMember, "first_name" | "last_name" | "job_title">>;

export function staffById(staff: readonly StaffMember[]): Map<number, StaffMember> {
  return new Map(staff.map((s) => [s.id, s]));
}

/** The assigned worker's real name, or null. Never "Assigned (staff)". */
export function assigneeName(order: Pick<WorkOrder, "assigned_staff_id">, staff: StaffLookup): string | null {
  if (order.assigned_staff_id == null) return null;
  const s = staff.get(order.assigned_staff_id);
  return s ? personName(s.first_name, s.last_name) || null : null;
}

/**
 * "Unit 1A · Maple Court"; "Common area · Maple Court" when the request has a
 * property but no unit; "" when neither is readable (e.g. a pooled job).
 */
export function placeLabel(order: Pick<WorkOrder, "unit_name" | "property_name">): string {
  const unit = order.unit_name?.trim();
  const property = order.property_name?.trim();
  if (unit && property) return `Unit ${unit} · ${property}`;
  if (unit) return `Unit ${unit}`;
  if (property) return `Common area · ${property}`;
  return "";
}

const NOON_UTC_DATE = /^\d{4}-\d{2}-\d{2}T12:00:00(?:\.\d+)?(?:Z|\+00:00)$/;

/** Day form: "Today", "Yesterday", or "Sat 14 Nov". Date-only values keep their calendar day. */
export function dayStamp(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso) || NOON_UTC_DATE.test(iso);
  const key = dateOnly ? iso.slice(0, 10) : null;
  const d = key ? new Date(`${key}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startToday - startThat) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return formatDate(key ?? iso, { weekday: "short", day: "numeric", month: "short" });
}

/** "$42.00". */
export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Cost value for the viewer (mirrors the price-table RLS):
 * admin "Worker $42.00 · Landlord $55.00" (only parts that are set);
 * worker "$42.00"; landlord "$55.00"; null when nothing is recorded.
 */
export function costLabelFor(
  order: Pick<WorkOrder, "worker_price" | "landlord_price">,
  cost: RequestSectionVisibility["cost"],
): string | null {
  if (cost === "worker") return order.worker_price != null ? formatPrice(order.worker_price) : null;
  if (cost === "landlord") return order.landlord_price != null ? formatPrice(order.landlord_price) : null;
  if (cost === "both") {
    const parts = [
      order.worker_price != null ? `Worker ${formatPrice(order.worker_price)}` : "",
      order.landlord_price != null ? `Landlord ${formatPrice(order.landlord_price)}` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

/** Who added a photo, by the uploader role stored on the row (lightbox caption). */
export function photoAuthor(
  photo: MaintenancePhoto,
  names: { tenant: string; assignee: string | null },
): string {
  switch (photo.uploaded_by_role) {
    case "tenant":
      return names.tenant || "Tenant";
    case "maintenance":
      return names.assignee || "Maintenance";
    case "landlord":
      return "Landlord";
    default:
      return "Landlord Gopher";
  }
}

const COMPLETION_PHOTO_ERROR = "Add at least one photo of the finished work before completing this job.";
const STATUS_ERROR = "Couldn't change the status. Try again.";
const SAVE_ERROR = "Couldn't save. Try again.";

// ── Presentational view ────────────────────────────────────────────

export interface RequestDetailViewProps {
  role: RequestViewerRole;
  order: WorkOrder;
  photos: MaintenancePhoto[];
  comments: MaintenanceComment[];
  history: MaintenanceStatusEvent[];
  staff: StaffMember[];
  viewerStaffId?: number | null;
  viewerTenantId?: number | null;
  /** Auth user id → display name, for status changes (history `changed_by_user_id`). */
  nameForUserId?: (userId: string) => string | null | undefined;
  busy?: boolean;
  uploading?: boolean;
  posting?: boolean;
  /** Photos are fetched on their own: a failure shows in the Photos card only. */
  photosError?: string | null;
  onRetryPhotos?: () => void;
  onBack: () => void;
  onAssign?: () => void;
  onChangeStatus?: (next: WorkOrderStatus) => void;
  onEditVendor?: () => void;
  onEditCost?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAddPhotos?: (files: FileList) => void;
  onSend?: (body: string, internal: boolean) => void | Promise<void>;
  /** Admin: Reopen on the completed strip. */
  onReopen?: () => void;
  /** Worker: accept a job offered to the pool. */
  onAcceptJob?: () => void;
  /** Extra nodes (dialogs, banners) rendered inside the page. */
  children?: ReactNode;
}

/**
 * The loaded request page, data in → markup out (no fetching), so every role's
 * frame can be rendered and tested from plain props.
 */
export function RequestDetailView({
  role,
  order,
  photos,
  comments,
  history,
  staff,
  viewerStaffId = null,
  viewerTenantId = null,
  nameForUserId,
  busy = false,
  uploading = false,
  posting = false,
  photosError = null,
  onRetryPhotos,
  onBack,
  onAssign,
  onChangeStatus,
  onEditVendor,
  onEditCost,
  onEdit,
  onDelete,
  onAddPhotos,
  onSend,
  onReopen,
  onAcceptJob,
  children,
}: RequestDetailViewProps) {
  const visibility = sectionsForRole(role);
  const back = backLinkFor(role);
  const staffMap = useMemo(() => staffById(staff), [staff]);
  const status = toRequestStatus(order);
  const assignee = assigneeName(order, staffMap);
  const assigneeStaff = order.assigned_staff_id != null ? staffMap.get(order.assigned_staff_id) : undefined;
  const reporter = personName(order.tenant_first_name, order.tenant_last_name);
  const reporterLabel =
    role === "tenant" && viewerTenantId != null && viewerTenantId === order.tenant_id
      ? "You"
      : reporter || (order.tenant_id == null ? "Landlord Gopher" : "");
  const number = requestNumberLabel(order);
  const completed = status === "Completed";
  const isWorker = role === "maintenance";

  const entries = useMemo(
    () =>
      buildTimeline(
        order,
        history,
        // Landlord: status events only (spec §2.4; request messaging out of scope).
        role === "landlord" ? [] : comments,
        {
          staffById: staffMap,
          tenantName: reporter || undefined,
          viewerStaffId,
          viewerTenantId,
          nameForUserId,
        },
        role,
      ),
    [order, history, comments, staffMap, reporter, viewerStaffId, viewerTenantId, nameForUserId, role],
  );

  const composer: RequestTimelineComposer | null =
    visibility.composer && !completed && onSend
      ? { showInternalToggle: visibility.internalToggle, posting, onSend }
      : null;

  const costLabel = costLabelFor(order, visibility.cost);
  const actions = visibility.actionsPanel ? (
    <RequestActionsPanel
      role={role}
      visibility={visibility}
      status={status}
      dbStatus={order.status}
      busy={busy}
      vendorLabel={visibility.vendor ? order.vendor_name?.trim() || null : undefined}
      costLabel={costLabel}
      onAssign={onAssign}
      onChangeStatus={onChangeStatus}
      onEditVendor={onEditVendor}
      onEditCost={onEditCost}
      onEdit={onEdit}
      onDelete={onDelete}
      onAcceptJob={onAcceptJob}
    />
  ) : null;

  return (
    <PageShell
      title={
        <>
          <span className="md:hidden">{back.label}</span>
          <span className="hidden md:inline">{order.title}</span>
          <span className="hidden pl-2 align-baseline text-sm font-normal tracking-normal text-muted-foreground md:inline">
            {number}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4 md:gap-6">
        <RequestHeader
          title={order.title}
          requestNumber={number}
          status={status}
          nextStep={requestNextStep(order, { assigneeName: assignee, startedAt: inProgressSince(history) })}
          priority={priorityLevel(order.priority)}
          location={placeLabel(order)}
          reportedBy={reporterLabel}
          reportedWhen={dayStamp(order.created_at)}
          assigneeName={assignee}
          backLabel={back.label}
          onBack={onBack}
        />

        <div className="flex flex-col gap-4 md:gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          {actions ? (
            // Tablet: before Details. Desktop: the right track.
            <div className="hidden md:block lg:col-start-2 lg:row-start-1">{actions}</div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-4 md:gap-6 lg:col-start-1 lg:row-start-1">
            <RequestDetailsCard
              order={order}
              assignee={assignee}
              assigneeRole={assigneeStaff?.job_title?.trim() || "Maintenance"}
              completed={completed}
              landlordCost={!visibility.actionsPanel && visibility.cost ? costLabel : null}
            />
            <RequestPhotosCard
              photos={photos}
              max={MAX_MAINTENANCE_PHOTOS}
              slotsLeft={photoSlotsLeft(photos, isWorker)}
              canAdd={visibility.addPhotos}
              uploading={uploading}
              onAdd={visibility.addPhotos ? onAddPhotos : undefined}
              uploaderName={(photo) => photoAuthor(photo, { tenant: reporter, assignee })}
              loadError={photosError}
              onRetry={onRetryPhotos}
            />
            <RequestTimeline
              entries={entries}
              formatWhen={formatActivityStamp}
              composer={composer}
              readOnlyNote={
                visibility.composer && completed ? "This request is completed. Messages are closed." : undefined
              }
              onReopen={completed ? onReopen : undefined}
              reopenBusy={busy}
            />
          </div>
          {actions ? <div className="md:hidden">{actions}</div> : null}
        </div>

        <PhoneActionBar
          role={role}
          visibility={visibility}
          status={status}
          busy={busy}
          onAssign={onAssign}
          onChangeStatus={onChangeStatus}
          onAcceptJob={onAcceptJob}
        />
      </div>
      {children}
    </PageShell>
  );
}

function ReadOnlyField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <p className="text-[13px] font-medium leading-[18px] text-muted-foreground">{label}</p>
      <div className="text-[15px] leading-[22px] text-foreground">{value}</div>
    </div>
  );
}

function RequestDetailsCard({
  order,
  assignee,
  assigneeRole,
  completed,
  landlordCost,
}: {
  order: WorkOrder;
  assignee: string | null;
  assigneeRole: string;
  completed: boolean;
  /** Landlord: their price, shown in Details (no actions panel). */
  landlordCost: string | null;
}) {
  return (
    <section
      aria-labelledby="request-details-heading"
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 md:p-5"
    >
      <h2 id="request-details-heading" className="text-[17px] font-semibold leading-[22px] text-foreground">
        Details
      </h2>
      <ReadOnlyField label="Category" value={order.category || "Not set"} />
      <ReadOnlyField
        label="Description"
        value={<p className="whitespace-pre-wrap break-words">{order.description?.trim() || "No description."}</p>}
      />
      <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:gap-6">
        <ReadOnlyField
          label="Entry"
          value={order.permission_to_enter ? "OK to enter if absent" : "Arrange a time with the tenant"}
        />
        <ReadOnlyField label="Assigned to" value={assignee ? `${assignee} · ${assigneeRole}` : "Not assigned yet"} />
        <ReadOnlyField label="Scheduled" value={dayStamp(order.scheduled_at) || "Not scheduled yet"} />
      </div>
      {completed ? (
        <ReadOnlyField
          label="What fixed it"
          value={<p className="whitespace-pre-wrap break-words">{order.resolution_notes?.trim() || "Not recorded"}</p>}
        />
      ) : null}
      {landlordCost ? <ReadOnlyField label="Cost" value={landlordCost} /> : null}
    </section>
  );
}

/** Phone sticky action bar: one full-width primary (spec §4). Admin and worker only. */
function PhoneActionBar({
  role,
  visibility,
  status,
  busy,
  onAssign,
  onChangeStatus,
  onAcceptJob,
}: {
  role: RequestViewerRole;
  visibility: RequestSectionVisibility;
  status: RequestStatus;
  busy: boolean;
  onAssign?: () => void;
  onChangeStatus?: (next: WorkOrderStatus) => void;
  onAcceptJob?: () => void;
}) {
  let control: ReactNode = null;
  if (visibility.changeStatus) {
    control =
      status === "New" && onAssign ? (
        <Button size="touch" className="w-full" disabled={busy} onClick={onAssign}>
          Assign and schedule
        </Button>
      ) : (
        <RequestStatusMenu current={status} disabled={busy} onChangeStatus={onChangeStatus}>
          <Button size="touch" className="w-full" disabled={busy}>
            Change status
            <ChevronDown aria-hidden />
          </Button>
        </RequestStatusMenu>
      );
  } else if (visibility.workerStatusActions && role === "maintenance") {
    const primary = workerPrimaryAction(status);
    if (status === "New" && onAcceptJob) {
      control = (
        <Button size="touch" className="w-full" disabled={busy} onClick={onAcceptJob}>
          Accept job
        </Button>
      );
    } else if (primary) {
      control = (
        <Button
          size="touch"
          className="w-full"
          disabled={busy}
          onClick={() => onChangeStatus?.(WORKER_ACTION_TARGET[primary])}
        >
          {WORKER_ACTION_LABEL[primary]}
        </Button>
      );
    }
  }
  if (!control) return null;
  return (
    <div
      className="sticky bottom-0 z-20 -mx-6 -mb-6 border-t border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:hidden"
    >
      {control}
    </div>
  );
}

// ── Short dialogs ──────────────────────────────────────────────────

function ShortDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  primaryLabel,
  primaryDisabled,
  busy,
  onPrimary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  primaryLabel: string;
  primaryDisabled?: boolean;
  busy?: boolean;
  onPrimary: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:max-w-none max-md:rounded-b-none">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!primaryDisabled && !busy) onPrimary();
          }}
        >
          {children}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              size="touch"
              className="w-full md:h-7 md:w-auto md:px-2"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="touch"
              className="w-full md:h-7 md:w-auto md:px-2"
              disabled={primaryDisabled || busy}
            >
              {primaryLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldHint({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <p className={cn("text-xs leading-4", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {children}
    </p>
  );
}

type DialogKind = "assign" | "hold" | "complete" | "vendor" | "cost" | "edit" | null;

// ── Container ──────────────────────────────────────────────────────

export function RequestDetailPage({
  id,
  navigate,
  viewerStaffId = null,
  viewerTenantId = null,
  viewerUserId = null,
}: {
  id: number;
  navigate: (to: string) => void;
  /** Viewer's own Staff id (admin / worker): their timeline entries read "You". */
  viewerStaffId?: number | null;
  /** Viewer's own Tenant id: their entries read "You". */
  viewerTenantId?: number | null;
  /** Viewer's own auth user id: their status changes read "You". */
  viewerUserId?: string | null;
}) {
  const app = useApp();
  const role = viewerRoleFrom(app);
  const isWorker = role === "maintenance";
  const isAdmin = role === "admin";
  const back = backLinkFor(role);

  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [photos, setPhotos] = useState<MaintenancePhoto[]>([]);
  const [comments, setComments] = useState<MaintenanceComment[]>([]);
  const [history, setHistory] = useState<MaintenanceStatusEvent[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  /** Admin only: auth user id → Staff / Tenant id (who changed a status). */
  const [accounts, setAccounts] = useState<data.UserAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [banner, setBanner] = useState<{ tone: RequestBannerTone; message: string } | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Dialog fields.
  const [assignStaffId, setAssignStaffId] = useState<string>("");
  const [assignDate, setAssignDate] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [vendorChoice, setVendorChoice] = useState("none");
  const [workerPriceText, setWorkerPriceText] = useState("");
  const [landlordPriceText, setLandlordPriceText] = useState("");
  const [costError, setCostError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPriority, setEditPriority] = useState<WorkOrderPriority>("normal");
  const [editDescription, setEditDescription] = useState("");
  const [editEntry, setEditEntry] = useState(false);
  const completionPhotoInput = useRef<HTMLInputElement>(null);

  const listWorkOrders = app.listWorkOrders;
  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;
  const listStaff = app.listStaff;
  const listJobLocations = app.listAvailableJobLocations;

  // No single-id API: listWorkOrders (RLS-trimmed per role) then find. A row the
  // viewer may not read is simply absent → "not available", not an error.
  const loadSeq = useRef(0);
  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const mine = ++loadSeq.current;
      if (!opts.silent) {
        setLoading(true);
        setLoadError(false);
      }
      try {
        const list = await listWorkOrders();
        if (loadSeq.current !== mine) return;
        let found = list.find((w) => w.id === id) ?? null;
        if (found && isWorker && found.status === "open" && found.assigned_staff_id == null && !found.property_name) {
          // Pooled job: Units/Properties stay closed until accepted; the RPC gives the address.
          const pooledId = found.id;
          try {
            const spot = (await listJobLocations()).find((l) => l.maintenance_request_id === pooledId);
            if (spot) {
              found = {
                ...found,
                property_name: spot.property_name ?? spot.street_address ?? null,
                unit_name: spot.unit_label ?? null,
              };
            }
          } catch {
            /* address is a nicety */
          }
          if (loadSeq.current !== mine) return;
        }
        if (!found) {
          setOrder(null);
          setPhotos([]);
          setComments([]);
          setHistory([]);
          return;
        }
        const [p, c, h, s, a] = await Promise.all([
          // Photos fail on their own (the Photos card shows Retry).
          listPhotos(id).then(
            (rows) => ({ ok: true as const, rows }),
            () => ({ ok: false as const, rows: [] as MaintenancePhoto[] }),
          ),
          listComments(id),
          listHistory(id),
          // Names are a nicety: never fail the page over them.
          listStaff().catch(() => [] as StaffMember[]),
          isAdmin ? data.listUserAccounts().catch(() => [] as data.UserAccountRow[]) : Promise.resolve([]),
        ]);
        if (loadSeq.current !== mine) return;
        setOrder(found);
        setPhotos(p.rows);
        setPhotosError(p.ok ? null : "We couldn't load the photos.");
        setComments(c);
        setHistory(h);
        setStaff(s);
        setAccounts(a);
      } catch {
        if (loadSeq.current !== mine) return;
        if (opts.silent) setBanner({ tone: "error", message: "We couldn't refresh this request. Try again." });
        else setLoadError(true);
      } finally {
        if (loadSeq.current === mine && !opts.silent) setLoading(false);
      }
    },
    [id, isAdmin, isWorker, listJobLocations, listWorkOrders, listPhotos, listComments, listHistory, listStaff],
  );

  const retryPhotos = useCallback(async () => {
    try {
      const rows = await listPhotos(id);
      setPhotos(rows);
      setPhotosError(null);
    } catch {
      setPhotosError("We couldn't load the photos.");
    }
  }, [id, listPhotos]);

  useEffect(() => {
    void load();
    return () => {
      loadSeq.current += 1;
    };
  }, [load]);

  const refresh = useCallback(() => void load({ silent: true }), [load]);
  const dismissBanner = useCallback(() => setBanner(null), []);
  const success = (message: string) => setBanner({ tone: "success", message });
  const failure = (message: string) => setBanner({ tone: "error", message });

  const staffMap = useMemo(() => staffById(staff), [staff]);
  const goBack = () => navigate(back.to);

  // Status changes carry the auth user id: "You" for the viewer; admins also
  // resolve other staff (and the reporting tenant) through the accounts list.
  const tenantIdOfOrder = order?.tenant_id ?? null;
  const tenantNameOfOrder = order ? personName(order.tenant_first_name, order.tenant_last_name) : "";
  const nameForUserId = useMemo(() => {
    const byUser = new Map(accounts.map((a) => [a.user_id, a]));
    return (userId: string): string | null => {
      if (viewerUserId && userId === viewerUserId) return "You";
      const account = byUser.get(userId);
      if (!account) return null;
      if (account.staff_id != null) return assigneeName({ assigned_staff_id: account.staff_id }, staffMap);
      if (account.tenant_id != null && account.tenant_id === tenantIdOfOrder) return tenantNameOfOrder || null;
      return null;
    };
  }, [accounts, viewerUserId, staffMap, tenantIdOfOrder, tenantNameOfOrder]);

  if (loading) {
    return (
      <PageShell title="Request">
        <RequestLoadingState withActionsPanel={sectionsForRole(role).actionsPanel} />
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell title="Request">
        <RequestErrorState backLabel={back.label} onBack={goBack} onRetry={() => void load()} />
      </PageShell>
    );
  }

  if (!order) {
    const action = notAvailableActionFor(role);
    return (
      <PageShell title="Request">
        <RequestNotAvailableState
          backLabel={back.label}
          onBack={goBack}
          actionLabel={action.label}
          onAction={() => navigate(action.to)}
        />
      </PageShell>
    );
  }

  const current = order;
  const location = placeLabel(current);
  const dialogContext = [current.title, location].filter(Boolean).join(" · ");
  const assignee = assigneeName(current, staffMap);
  const workerPhotoCount = photos.filter((p) => p.uploaded_by_role === "maintenance").length;
  const needsCompletionPhoto = isWorker && workerPhotoCount === 0;

  async function applyStatus(
    next: WorkOrderStatus,
    extra: Parameters<typeof app.updateWorkOrder>[1],
    message: string,
  ) {
    setBusy(true);
    try {
      await app.updateWorkOrder(current.id, { status: next, ...extra }, { previousStatus: current.status });
      setDialog(null);
      success(current.status === "closed" && next !== "closed" ? "Request reopened." : message);
      refresh();
    } catch (err) {
      const raw = (err as Error)?.message ?? "";
      failure(next === "closed" && /photo/i.test(raw) ? COMPLETION_PHOTO_ERROR : STATUS_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function openAssign() {
    setAssignStaffId(current.assigned_staff_id != null ? String(current.assigned_staff_id) : "");
    setAssignDate(current.scheduled_at?.slice(0, 10) || toIsoDate(new Date()));
    setDialog("assign");
  }

  function openHold() {
    setHoldReason(current.hold_reason?.trim() || "");
    setFollowUpDate(current.next_follow_up_date?.slice(0, 10) || "");
    setDialog("hold");
  }

  function openComplete() {
    setResolutionNotes(current.resolution_notes?.trim() || "");
    setDialog("complete");
  }

  function changeStatus(next: WorkOrderStatus) {
    if (busy) return;
    switch (next) {
      case "on_hold":
        openHold();
        return;
      case "closed":
        openComplete();
        return;
      case "scheduled":
        if (current.assigned_staff_id == null || !current.scheduled_at) {
          openAssign();
          return;
        }
        void applyStatus("scheduled", {}, `${assignee ?? "Worker"} assigned for ${dayStamp(current.scheduled_at)}.`);
        return;
      case "open":
        // "New" means not assigned yet (spec §1), so clear the assignee.
        void applyStatus("open", { assigned_staff_id: null }, "Moved back to New.");
        return;
      case "in_progress":
        void applyStatus("in_progress", {}, current.status === "on_hold" ? "Work resumed." : "Work started.");
        return;
    }
  }

  async function confirmAssign() {
    const staffId = Number(assignStaffId);
    if (!staffId || !assignDate) return;
    const name = assigneeName({ assigned_staff_id: staffId }, staffMap) ?? "Worker";
    await applyStatus(
      "scheduled",
      { assigned_staff_id: staffId, scheduled_at: assignDate },
      `${name} assigned for ${dayStamp(assignDate)}.`,
    );
  }

  async function confirmHold() {
    const reason = holdReason.trim();
    if (!reason || !followUpDate) return;
    await applyStatus(
      "on_hold",
      { hold_reason: reason, next_follow_up_date: followUpDate },
      `Put on hold until ${dayStamp(followUpDate)}.`,
    );
  }

  async function confirmComplete() {
    const notes = resolutionNotes.trim();
    if (!notes || needsCompletionPhoto) return;
    await applyStatus("closed", { resolution_notes: notes }, "Marked completed.");
  }

  async function addPhotos(files: FileList | File[]) {
    const picked = takePhotoFiles(files, photoSlotsLeft(photos, isWorker));
    if (picked.length === 0) return;
    setUploading(true);
    let added = 0;
    try {
      for (const file of picked) {
        await app.uploadMaintenancePhoto(current.id, file);
        added += 1;
      }
      success(added === 1 ? "Photo added." : `${added} photos added.`);
    } catch {
      failure("Couldn't add the photo. Try again.");
    } finally {
      setUploading(false);
      if (added > 0) refresh();
    }
  }

  async function send(body: string, internal: boolean) {
    setPosting(true);
    try {
      const staffViewer = role === "admin" || role === "maintenance";
      await app.addMaintenanceComment(current.id, body, staffViewer && internal ? "internal" : "tenant_visible");
      success("Message sent.");
      refresh();
    } catch (err) {
      failure("Couldn't send your message. Try again.");
      // Rethrow so the composer keeps the typed text.
      throw err;
    } finally {
      setPosting(false);
    }
  }

  function openVendor() {
    setVendorChoice(current.vendor_id != null ? String(current.vendor_id) : "none");
    setDialog("vendor");
  }

  async function saveVendor() {
    setBusy(true);
    try {
      await app.updateWorkOrder(current.id, { vendor_id: vendorChoice === "none" ? null : Number(vendorChoice) });
      setDialog(null);
      success("Vendor updated.");
      refresh();
    } catch {
      failure(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function openCost() {
    setWorkerPriceText(current.worker_price != null ? String(current.worker_price) : "");
    setLandlordPriceText(current.landlord_price != null ? String(current.landlord_price) : "");
    setCostError(null);
    setDialog("cost");
  }

  async function saveCost() {
    let patch: ReturnType<typeof changedPriceFields>;
    try {
      patch = changedPriceFields({ workerPrice: workerPriceText, landlordPrice: landlordPriceText }, current);
    } catch (err) {
      setCostError((err as Error).message);
      return;
    }
    if (Object.keys(patch).length === 0) {
      setDialog(null);
      return;
    }
    setBusy(true);
    try {
      await app.updateWorkOrder(current.id, patch);
      setDialog(null);
      success("Cost saved.");
      refresh();
    } catch {
      failure(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    setEditTitle(current.title);
    setEditCategory(current.category || "");
    setEditPriority(current.priority);
    setEditDescription(current.description ?? "");
    setEditEntry(current.permission_to_enter);
    setDialog("edit");
  }

  async function saveEdit() {
    const title = editTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      await app.updateWorkOrder(current.id, {
        title,
        category: editCategory || current.category,
        priority: editPriority,
        description: editDescription,
        permission_to_enter: editEntry,
      });
      setDialog(null);
      success("Details saved.");
      refresh();
    } catch {
      failure(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function acceptJob() {
    if (busy) return;
    setBusy(true);
    try {
      await app.acceptMaintenanceRequest(current.id);
      success("Job accepted.");
      refresh();
    } catch (err) {
      const raw = (err as Error)?.message ?? "";
      failure(/taken/i.test(raw) ? "Someone else has already taken this job." : "Couldn't accept the job. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function reopen() {
    if (busy) return;
    void applyStatus(current.assigned_staff_id != null ? "scheduled" : "open", {}, "Request reopened.");
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await app.deleteWorkOrder(current.id);
      app.setNotice("Request deleted.");
      navigate("/maintenance");
    } catch {
      failure("Couldn't delete the request. Try again.");
      setBusy(false);
    }
  }

  const visibility = sectionsForRole(role);
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const vendors: Vendor[] = app.vendors;

  return (
    <RequestDetailView
      role={role}
      order={current}
      photos={photos}
      comments={comments}
      history={history}
      staff={staff}
      viewerStaffId={viewerStaffId}
      viewerTenantId={viewerTenantId}
      busy={busy}
      uploading={uploading}
      posting={posting}
      onBack={goBack}
      onAssign={visibility.changeStatus && app.canAcceptAndSchedule ? openAssign : undefined}
      onChangeStatus={visibility.changeStatus || visibility.workerStatusActions ? changeStatus : undefined}
      onEditVendor={visibility.costVendorEditable ? openVendor : undefined}
      onEditCost={visibility.costVendorEditable ? openCost : undefined}
      onEdit={visibility.editAndDelete ? openEdit : undefined}
      onDelete={visibility.editAndDelete ? () => setDeleteOpen(true) : undefined}
      onAddPhotos={visibility.addPhotos ? (files) => void addPhotos(files) : undefined}
      onSend={visibility.composer ? send : undefined}
      onReopen={visibility.changeStatus ? reopen : undefined}
      onAcceptJob={
        isWorker && current.status === "open" && current.assigned_staff_id == null ? () => void acceptJob() : undefined
      }
      nameForUserId={nameForUserId}
      photosError={photosError}
      onRetryPhotos={() => void retryPhotos()}
    >

      <ShortDialog
        open={dialog === "assign"}
        onOpenChange={closeDialog}
        title="Assign and schedule"
        description={dialogContext}
        primaryLabel="Assign"
        primaryDisabled={!assignStaffId || !assignDate}
        busy={busy}
        onPrimary={() => void confirmAssign()}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="assign-staff">Assign to</Label>
          <Select value={assignStaffId} onValueChange={setAssignStaffId}>
            <SelectTrigger id="assign-staff" className="h-11 md:h-8">
              <SelectValue placeholder="Choose a person" />
            </SelectTrigger>
            <SelectContent>
              {staff.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {personName(s.first_name, s.last_name)} · {s.job_title?.trim() || "Maintenance"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="assign-date">Date</Label>
          <Input
            id="assign-date"
            type="date"
            className="h-11 md:h-8"
            value={assignDate}
            onChange={(e) => setAssignDate(e.target.value)}
          />
          <FieldHint>The tenant is told who is coming and when.</FieldHint>
        </div>
      </ShortDialog>

      <ShortDialog
        open={dialog === "hold"}
        onOpenChange={closeDialog}
        title="Put on hold"
        description="The tenant sees the reason and the follow-up date."
        primaryLabel="Put on hold"
        primaryDisabled={!holdReason.trim() || !followUpDate}
        busy={busy}
        onPrimary={() => void confirmHold()}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="hold-reason">Reason</Label>
          <Input
            id="hold-reason"
            className="h-11 md:h-8"
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder="e.g. Waiting for part"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hold-follow-up">Follow-up date</Label>
          <Input
            id="hold-follow-up"
            type="date"
            className="h-11 md:h-8"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
          />
        </div>
      </ShortDialog>

      <ShortDialog
        open={dialog === "complete"}
        onOpenChange={closeDialog}
        title="Mark completed"
        description={dialogContext}
        primaryLabel="Mark completed"
        primaryDisabled={!resolutionNotes.trim() || needsCompletionPhoto || uploading}
        busy={busy}
        onPrimary={() => void confirmComplete()}
      >
        {needsCompletionPhoto ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-muted px-3 py-2.5">
            <p className="text-sm leading-5 text-foreground">Add a photo of the finished work first.</p>
            <input
              ref={completionPhotoInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                if (e.target.files?.length) void addPhotos(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="touch"
              className="md:h-7 md:px-2"
              disabled={uploading}
              onClick={() => completionPhotoInput.current?.click()}
            >
              {uploading ? "Uploading…" : "Add photo"}
            </Button>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="resolution-notes">What fixed it?</Label>
          <Textarea
            id="resolution-notes"
            rows={3}
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
          />
          <FieldHint>Shown to the tenant and the landlord.</FieldHint>
        </div>
      </ShortDialog>

      <ShortDialog
        open={dialog === "vendor"}
        onOpenChange={closeDialog}
        title="Vendor"
        primaryLabel="Save"
        busy={busy}
        onPrimary={() => void saveVendor()}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="vendor-choice">Vendor</Label>
          <Select value={vendorChoice} onValueChange={setVendorChoice}>
            <SelectTrigger id="vendor-choice" className="h-11 md:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ShortDialog>

      <ShortDialog
        open={dialog === "cost"}
        onOpenChange={closeDialog}
        title="Cost"
        description="The worker never sees the landlord price, and the landlord never sees the worker price."
        primaryLabel="Save"
        busy={busy}
        onPrimary={() => void saveCost()}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cost-worker">Worker price</Label>
            <Input
              id="cost-worker"
              inputMode="decimal"
              className={cn("h-11 md:h-8", costError && "border-destructive")}
              value={workerPriceText}
              onChange={(e) => {
                setWorkerPriceText(e.target.value);
                setCostError(null);
              }}
              placeholder="0.00"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cost-landlord">Landlord price</Label>
            <Input
              id="cost-landlord"
              inputMode="decimal"
              className={cn("h-11 md:h-8", costError && "border-destructive")}
              value={landlordPriceText}
              onChange={(e) => {
                setLandlordPriceText(e.target.value);
                setCostError(null);
              }}
              placeholder="0.00"
            />
          </div>
        </div>
        {costError ? <FieldHint tone="error">{costError}</FieldHint> : null}
      </ShortDialog>

      <ShortDialog
        open={dialog === "edit"}
        onOpenChange={closeDialog}
        title="Edit details"
        primaryLabel="Save"
        primaryDisabled={!editTitle.trim()}
        busy={busy}
        onPrimary={() => void saveEdit()}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="edit-title">What's the problem?</Label>
          <Input
            id="edit-title"
            className={cn("h-11 md:h-8", !editTitle.trim() && "border-destructive")}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          {!editTitle.trim() ? <FieldHint tone="error">Enter a title.</FieldHint> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-category">Category</Label>
            <Select value={editCategory} onValueChange={setEditCategory}>
              <SelectTrigger id="edit-category" className="h-11 md:h-8">
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-priority">Priority</Label>
            <Select value={editPriority} onValueChange={(v) => setEditPriority(v as WorkOrderPriority)}>
              <SelectTrigger id="edit-priority" className="h-11 md:h-8">
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
          <Label htmlFor="edit-description">Description</Label>
          <Textarea
            id="edit-description"
            rows={3}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm leading-5 text-foreground md:min-h-7">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={editEntry}
            onChange={(e) => setEditEntry(e.target.checked)}
          />
          OK to enter if absent
        </label>
      </ShortDialog>

      <ConfirmDelete
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this request?"
        description={`This removes “${current.title}” (${requestNumberLabel(current)}) with its photos and timeline. This can’t be undone.`}
        confirmLabel="Delete request"
        onConfirm={() => void confirmDelete()}
      />

      {banner ? <RequestBanner tone={banner.tone} message={banner.message} onDismiss={dismissBanner} /> : null}
    </RequestDetailView>
  );
}
