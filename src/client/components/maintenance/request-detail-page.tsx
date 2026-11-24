import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, MessageSquare } from "lucide-react";
import { useApp } from "@/context";
import { LandlordPortalTitle } from "@/components/landlord";
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
import { FEATURES } from "@/lib/feature-flags";
import { officeMessageHref } from "@/lib/messages";
import {
  formatActivityStamp,
  formatVisit,
  requestDayInSentence,
  PRIORITY_OPTIONS,
  priorityLevel,
  inProgressSince,
  requestDayWord,
  requestNextStep,
  toRequestStatus,
  visitChoiceFrom,
  type RequestStatus,
  type VisitChoice,
} from "@/lib/request-status";
import { VisitWindowFields, visitPatchFor } from "./visit-window-fields";
import { buildTimeline, type RequestViewerRole } from "@/lib/request-timeline";
import { cn } from "@/lib/utils";
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
import { CompleteJobDialog } from "./request/complete-job-dialog";
import { completionProof, lastReopenedAt } from "./request/completion-proof";
import { NoteDialog } from "./request/note-dialog";
import type { PendingPhoto } from "./request/photo-tiles";
import { TenantFixCheck, tenantFixState, tenantFixSummary } from "./request/tenant-fix-check";
import {
  RequestBanner,
  RequestErrorState,
  RequestLoadingState,
  RequestNotAvailableState,
  type RequestBannerTone,
} from "./request/request-states";
import { RequestComposer, RequestTimeline, type RequestTimelineComposer } from "./request/request-timeline";
import {
  backLinkFor,
  backLinkFromSearch,
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

/**
 * Landlord toolbar title (#101): breadcrumb on desktop, request number on phone.
 * Matches LandlordRequestShell from the pre-unify landlord detail page.
 */
export function landlordRequestShellTitle(requestNumber?: string) {
  const crumb = requestNumber
    ? `Landlord portal / Maintenance / ${requestNumber}`
    : "Landlord portal / Maintenance";
  return <LandlordPortalTitle crumb={crumb} mobileLabel={requestNumber ?? "Maintenance"} />;
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

/** Day form: "Today", "Yesterday", or "Sat 14 Nov" — the one shared day word (requestDayWord). */
export function dayStamp(iso: string | null | undefined, now: Date = new Date()): string {
  return requestDayWord(iso, now);
}

/**
 * Who can be picked in "Assign to": staff whose login is an APPROVED worker
 * account, plus staff with no login at all. Pending / rejected / suspended
 * accounts (e.g. a worker still in the approval queue) and admin logins are
 * left out. The current assignee always stays in the list. Without the
 * accounts list (it failed to load) every staff record is offered.
 */
export function assignableStaff(
  staff: readonly StaffMember[],
  accounts: readonly Pick<data.UserAccountRow, "staff_id" | "email" | "role" | "account_status">[],
  currentAssigneeId: number | null | undefined,
): StaffMember[] {
  if (accounts.length === 0) return [...staff];
  return staff.filter((s) => {
    if (s.id === currentAssigneeId) return true;
    const email = s.email?.trim().toLowerCase();
    const linked = accounts.filter(
      (a) => a.staff_id === s.id || (email && a.email?.trim().toLowerCase() === email),
    );
    if (linked.length === 0) return true;
    return linked.some((a) => a.role === "maintenance" && a.account_status === "approved");
  });
}

/** Staff record behind a login: user_roles.staff_id, else the Staff row with the same email. */
export function staffIdForAccount(
  account: Pick<data.UserAccountRow, "staff_id" | "email">,
  staff: readonly Pick<StaffMember, "id" | "email">[],
): number | null {
  if (account.staff_id != null) return account.staff_id;
  const email = account.email?.trim().toLowerCase();
  if (!email) return null;
  return staff.find((s) => s.email?.trim().toLowerCase() === email)?.id ?? null;
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
 * The landlord's value is shown only once it is a real bill (landlordBilledLabel).
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

/**
 * Landlord "Billed $55.00": the landlord price is what Landlord Gopher bills,
 * but until the job is completed it is only the office's estimate (set when
 * the job is offered or assigned), so a New or in-progress request shows no
 * cost at all rather than a number that may change.
 */
export function landlordBilledLabel(
  order: Pick<WorkOrder, "status" | "landlord_price">,
): string | null {
  if (order.status !== "closed" || order.landlord_price == null) return null;
  return formatPrice(order.landlord_price);
}

/** "MR-001000" (no "#"), for the office message's About line. */
function plainRequestNumber(order: Pick<WorkOrder, "id" | "request_number">): string {
  return requestNumberLabel(order).replace(/^#/, "");
}

/** Office thread link with "About: Maple Court · Unit 1A · MR-001000 · Kitchen faucet leaking". */
export function officeHrefForRequest(
  order: Pick<WorkOrder, "id" | "request_number" | "title" | "property_name" | "unit_name">,
): string {
  const unit = order.unit_name?.trim();
  return officeMessageHref({
    about: [order.property_name, unit ? `Unit ${unit}` : null, plainRequestNumber(order), order.title],
  });
}

/**
 * A worker looking at a job they do not hold (a pool offer, or one assigned to
 * someone else): RLS refuses messages and photos from them, so the page hides
 * the controls that could only fail, and leaves out the tenant's name.
 */
export function workerHoldsJob(
  order: Pick<WorkOrder, "assigned_staff_id">,
  viewerStaffId: number | null | undefined,
): boolean {
  if (order.assigned_staff_id == null) return false;
  return viewerStaffId == null || order.assigned_staff_id === viewerStaffId;
}

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
  /** The viewer's auth user id: their own status changes read "You". */
  viewerUserId?: string | null;
  /** Auth user id → real name, for status changes (history `changed_by_user_id`). */
  nameForUserId?: (userId: string) => string | null | undefined;
  /** Staff id of the only admin login, for admin messages without an author_staff_id. */
  soleAdminStaffId?: number | null;
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
  onAddPhotos?: (files: File[]) => void;
  /** This session's uploads in flight or failed (Photos card "Upload failed — Retry"). */
  pendingPhotos?: PendingPhoto[];
  onRetryPendingPhoto?: (key: string) => void;
  onDiscardPendingPhoto?: (key: string) => void;
  /** Saved photo whose file never arrived: may the viewer upload it again? */
  canRetryMissingPhoto?: (photo: MaintenancePhoto) => boolean;
  onRetryMissingPhoto?: (photo: MaintenancePhoto, file: File) => void;
  onSend?: (body: string, internal: boolean) => void | Promise<void>;
  /** Admin: Reopen on the completed strip. */
  onReopen?: () => void;
  /** Worker: accept a job offered to the pool (FEATURES.workerSelfClaim only). */
  onAcceptJob?: () => void;
  /** Worker: hand a job they hold back to the office (FEATURES.workerSelfClaim only). */
  onReleaseJob?: () => void;
  /** Tenant, completed request: "Yes, it's fixed". */
  onConfirmFixed?: () => void;
  /** Tenant, completed request: "Still a problem" (opens the note dialog). */
  onStillProblem?: () => void;
  /** Landlord: "Message the office about this request". */
  onMessageOffice?: () => void;
  /** Back label when the page was opened from somewhere else (`?from=`). */
  backLabel?: string;
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
  viewerUserId = null,
  nameForUserId,
  soleAdminStaffId = null,
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
  pendingPhotos = [],
  onRetryPendingPhoto,
  onDiscardPendingPhoto,
  canRetryMissingPhoto,
  onRetryMissingPhoto,
  onSend,
  onReopen,
  onAcceptJob,
  onReleaseJob,
  onConfirmFixed,
  onStillProblem,
  onMessageOffice,
  backLabel,
  children,
}: RequestDetailViewProps) {
  const roleVisibility = sectionsForRole(role);
  const isWorker = role === "maintenance";
  // A worker who does not hold this job cannot message on it or add photos.
  const outsider = isWorker && !workerHoldsJob(order, viewerStaffId);
  const visibility: RequestSectionVisibility = outsider
    ? { ...roleVisibility, composer: false, addPhotos: false, internalNotes: false }
    : roleVisibility;
  const back = { ...backLinkFor(role), ...(backLabel ? { label: backLabel } : {}) };
  const staffMap = useMemo(() => staffById(staff), [staff]);
  const status = toRequestStatus(order);
  const assignee = assigneeName(order, staffMap);
  const assigneeStaff = order.assigned_staff_id != null ? staffMap.get(order.assigned_staff_id) : undefined;
  // The tenant's name stays off a job the worker has not taken.
  const reporter = outsider ? "" : personName(order.tenant_first_name, order.tenant_last_name);
  const number = requestNumberLabel(order);
  const completed = status === "Completed";
  const fixState = role === "tenant" ? tenantFixState(order) : null;

  const entries = useMemo(
    () =>
      buildTimeline(
        order,
        history,
        // Landlord (and the read-only viewer): status events only (spec §2.4;
        // request messaging out of scope).
        role === "landlord" || role === "viewer" ? [] : comments,
        {
          staffById: staffMap,
          tenantName: reporter || undefined,
          viewerStaffId,
          viewerTenantId,
          viewerUserId,
          nameForUserId,
          soleAdminStaffId,
        },
        role,
      ),
    [
      order,
      history,
      comments,
      staffMap,
      reporter,
      viewerStaffId,
      viewerTenantId,
      viewerUserId,
      nameForUserId,
      soleAdminStaffId,
      role,
    ],
  );
  // "Reported by" uses the same person as the timeline's first entry, so the
  // page never names the reporter two different ways.
  const reporterLabel = outsider ? "" : (entries.find((e) => e.kind === "reported")?.actor.name ?? reporter);

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
      onReleaseJob={onReleaseJob}
    />
  ) : null;

  // Landlord keeps #101's portal crumb / mobileLabel in the chrome; other roles
  // keep the unified phone back + desktop title treatment from this PR.
  const shellTitle =
    role === "landlord" ? (
      landlordRequestShellTitle(number)
    ) : (
      <>
        {/* Phone (Header / Phone, Type = Back): back icon + parent label. The number sits by the title below. */}
        <span className="flex items-center gap-1 md:hidden">
          <button
            type="button"
            onClick={onBack}
            aria-label={`Back to ${back.label}`}
            className="-ml-3 flex size-11 shrink-0 items-center justify-center rounded-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <span className="min-w-0 flex-1 truncate text-[17px] leading-[22px]">{back.label}</span>
        </span>
        <span className="hidden md:inline">{order.title}</span>
        <span className="hidden pl-2 align-baseline text-sm font-normal tracking-normal text-muted-foreground md:inline">
          {number}
        </span>
      </>
    );

  return (
    <PageShell title={shellTitle} titleIsPageHeading={role !== "landlord"}>
      {/* Phone content is p-4 (16px): pull the shell's 24px padding in by 8px. */}
      <div className="flex flex-col gap-4 max-md:-mx-2 max-md:-mt-2 md:gap-6">
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
          phoneBackInHeader={role !== "landlord"}
          titleIsPageHeading={role === "landlord"}
          actions={
            onMessageOffice ? (
              <Button variant="secondary" size="touch" className="md:h-8 md:px-3" onClick={onMessageOffice}>
                <MessageSquare aria-hidden />
                Message the office about this request
              </Button>
            ) : null
          }
        />

        <div className="flex flex-col gap-4 md:gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          {actions ? (
            // Tablet: before Details. Desktop: the right track.
            <div className="hidden md:block lg:col-start-2 lg:row-start-1">{actions}</div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-4 md:gap-6 lg:col-start-1 lg:row-start-1">
            {fixState && (fixState !== "ask" || (onConfirmFixed && onStillProblem)) ? (
              <TenantFixCheck
                state={fixState}
                completedBy={assignee}
                completedWhen={order.completed_at ? requestDayInSentence(order.completed_at) : ""}
                respondedWhen={order.tenant_fix_responded_at ? requestDayInSentence(order.tenant_fix_responded_at) : ""}
                busy={busy}
                onConfirm={() => onConfirmFixed?.()}
                onStillProblem={() => onStillProblem?.()}
              />
            ) : null}
            <RequestDetailsCard
              order={order}
              assignee={assignee}
              assigneeRole={assigneeStaff?.job_title?.trim() || "Maintenance"}
              status={status}
              completed={completed}
              billed={role === "landlord" ? landlordBilledLabel(order) : null}
              tenantCheck={role !== "tenant" ? tenantFixSummary(order, requestDayInSentence) : null}
            />
            <RequestPhotosCard
              photos={photos}
              max={MAX_MAINTENANCE_PHOTOS}
              slotsLeft={photoSlotsLeft(photos, isWorker)}
              canAdd={visibility.addPhotos}
              uploading={uploading}
              onAdd={visibility.addPhotos ? onAddPhotos : undefined}
              pending={pendingPhotos}
              onRetryPending={onRetryPendingPhoto}
              onDiscardPending={onDiscardPendingPhoto}
              canRetryMissing={visibility.addPhotos ? canRetryMissingPhoto : undefined}
              onRetryMissing={onRetryMissingPhoto}
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
              composerOnPhone={false}
            />
          </div>
          {actions ? <div className="md:hidden">{actions}</div> : null}
        </div>

        <PhoneActionBar
          role={role}
          visibility={visibility}
          status={status}
          dbStatus={order.status}
          composer={composer}
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
  status,
  completed,
  billed,
  tenantCheck,
}: {
  order: WorkOrder;
  assignee: string | null;
  assigneeRole: string;
  status: RequestStatus;
  completed: boolean;
  /** Landlord: what they are billed, once the job is completed (landlordBilledLabel). */
  billed: string | null;
  /** Staff / landlord on a completed request: what the tenant said (tenantFixSummary). */
  tenantCheck: string | null;
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
        <ReadOnlyField
          label="Scheduled"
          // New = open with nobody assigned: never "scheduled", whatever scheduled_at holds (spec §1).
          value={(status !== "New" && formatVisit(order)) || "Not scheduled yet"}
        />
      </div>
      {completed ? (
        <ReadOnlyField
          label="What fixed it"
          value={<p className="whitespace-pre-wrap break-words">{order.resolution_notes?.trim() || "Not recorded"}</p>}
        />
      ) : null}
      {completed && tenantCheck ? <ReadOnlyField label="Tenant check" value={tenantCheck} /> : null}
      {billed ? <ReadOnlyField label="Billed" value={billed} /> : null}
    </section>
  );
}

/**
 * Phone sticky bottom (spec §4): the message box (staff and tenant), then one
 * full-width primary (admin and worker). Landlord: nothing sticky.
 */
function PhoneActionBar({
  role,
  visibility,
  status,
  dbStatus,
  composer,
  busy,
  onAssign,
  onChangeStatus,
  onAcceptJob,
}: {
  role: RequestViewerRole;
  visibility: RequestSectionVisibility;
  status: RequestStatus;
  /** Stored status: the Change status menu ticks this, not the display label. */
  dbStatus: WorkOrderStatus;
  /** Phone: the message box sits in this sticky bar, above the primary action. */
  composer: RequestTimelineComposer | null;
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
        <RequestStatusMenu current={dbStatus} disabled={busy} onChangeStatus={onChangeStatus}>
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
  if (!control && !composer) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-4 -mb-6 flex flex-col gap-3 border-t border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:hidden">
      {composer ? <RequestComposer composer={composer} variant="bar" /> : null}
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

type DialogKind = "assign" | "hold" | "complete" | "vendor" | "cost" | "edit" | "release" | "not-fixed" | null;

/**
 * "What fixed it?" drafts by request id, kept while the app is open, so a
 * worker who cancels the Complete dialog to go take a photo finds their notes
 * again. Cleared once the job is completed.
 */
const completionNotesDrafts = new Map<number, string>();

let pendingSeq = 0;

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
  // `?from=` (maintenance list, calendar): Back returns to that view.
  const back = useMemo(
    () =>
      typeof window === "undefined"
        ? backLinkFor(role)
        : backLinkFromSearch(role, window.location.search, window.location.origin),
    // Read once per request page (`id` re-reads it); the query does not change while it is open.
    [role, id],
  );

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
  const [assignVisit, setAssignVisit] = useState<VisitChoice>(() => visitChoiceFrom({ scheduled_at: null }));
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
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [notFixedNote, setNotFixedNote] = useState("");
  const [notFixedError, setNotFixedError] = useState<string | null>(null);
  /** Uploads picked in this session that are in flight or failed. */
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const pendingFiles = useRef(new Map<string, File>());

  // Free the previews' object URLs when the page goes away.
  useEffect(() => {
    const files = pendingFiles.current;
    return () => {
      setPending((items) => {
        for (const item of items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        return [];
      });
      files.clear();
    };
  }, [id]);

  const getWorkOrder = app.getWorkOrder;
  const listPhotos = app.listMaintenancePhotos;
  const listComments = app.listMaintenanceComments;
  const listHistory = app.listMaintenanceStatusHistory;
  const listStaff = app.listStaff;
  const getJobLocation = app.getAvailableJobLocation;

  // One request by id (RLS-trimmed per role). A row the viewer may not read
  // comes back null → "not available", not an error.
  const loadSeq = useRef(0);
  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const mine = ++loadSeq.current;
      if (!opts.silent) {
        setLoading(true);
        setLoadError(false);
      }
      try {
        let found = await getWorkOrder(id);
        if (loadSeq.current !== mine) return;
        if (found && isWorker && found.status === "open" && found.assigned_staff_id == null && !found.property_name) {
          // Pooled job: Units/Properties stay closed until accepted; the RPC gives the address.
          try {
            const spot = await getJobLocation(found.id);
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
    [id, isAdmin, isWorker, getJobLocation, getWorkOrder, listPhotos, listComments, listHistory, listStaff],
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

  // The viewer's own Staff record. An admin login is usually not linked to a
  // Staff row by id, so match it by email through the accounts list.
  const viewerAccount = useMemo(
    () => (viewerUserId ? accounts.find((a) => a.user_id === viewerUserId) ?? null : null),
    [accounts, viewerUserId],
  );
  const myStaffId = viewerStaffId ?? (viewerAccount ? staffIdForAccount(viewerAccount, staff) : null);
  // Admin messages saved without an author_staff_id: name them when there is one admin.
  const soleAdminStaffId = useMemo(() => {
    const admins = accounts.filter((a) => a.role === "admin" && a.account_status === "approved");
    return admins.length === 1 ? staffIdForAccount(admins[0], staff) : null;
  }, [accounts, staff]);

  // Status changes carry the auth user id. The timeline shows the viewer's own
  // as "You" (with their real initials); admins also resolve other staff and
  // the reporting tenant through the accounts list.
  const tenantIdOfOrder = order?.tenant_id ?? null;
  const tenantNameOfOrder = order ? personName(order.tenant_first_name, order.tenant_last_name) : "";
  const nameForUserId = useMemo(() => {
    const byUser = new Map(accounts.map((a) => [a.user_id, a]));
    const myName =
      role === "tenant"
        ? tenantNameOfOrder || null
        : myStaffId != null
          ? assigneeName({ assigned_staff_id: myStaffId }, staffMap)
          : null;
    return (userId: string): string | null => {
      if (viewerUserId && userId === viewerUserId) return myName;
      const account = byUser.get(userId);
      if (!account) return null;
      const staffId = staffIdForAccount(account, staff);
      if (staffId != null) return assigneeName({ assigned_staff_id: staffId }, staffMap);
      if (account.tenant_id != null && account.tenant_id === tenantIdOfOrder) return tenantNameOfOrder || null;
      return null;
    };
  }, [accounts, viewerUserId, staff, staffMap, tenantIdOfOrder, tenantNameOfOrder, role, myStaffId]);

  const unresolvedTitle = role === "landlord" ? landlordRequestShellTitle() : "Request";
  const unresolvedHeading = role !== "landlord";

  if (loading) {
    return (
      <PageShell title={unresolvedTitle} titleIsPageHeading={unresolvedHeading}>
        <RequestLoadingState withActionsPanel={sectionsForRole(role).actionsPanel} />
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell title={unresolvedTitle} titleIsPageHeading={unresolvedHeading}>
        <RequestErrorState backLabel={back.label} onBack={goBack} onRetry={() => void load()} />
      </PageShell>
    );
  }

  if (!order) {
    const action = notAvailableActionFor(role);
    return (
      <PageShell title={unresolvedTitle} titleIsPageHeading={unresolvedHeading}>
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
  const holdsJob = isWorker && workerHoldsJob(current, myStaffId);
  // Same rule as the server: this worker's own stored photo since they took
  // the job and since it was last reopened.
  const proof = completionProof({ order: current, history, photos, viewerUserId });
  const needsCompletionPhoto = isWorker && proof.need !== "none";

  async function applyStatus(
    next: WorkOrderStatus,
    extra: Parameters<typeof app.updateWorkOrder>[1],
    message: string,
  ) {
    setBusy(true);
    try {
      await app.updateWorkOrder(current.id, { status: next, ...extra }, { previousStatus: current.status });
      setDialog(null);
      if (next === "closed") completionNotesDrafts.delete(current.id);
      success(current.status === "closed" && next !== "closed" ? "Request reopened." : message);
      refresh();
    } catch (err) {
      const raw = (err as Error)?.message ?? "";
      if (next === "closed" && dialog === "complete") {
        // Said where the worker is looking; the banner would sit on top of the dialog.
        if (/photo/i.test(raw)) {
          setCompleteError(`${COMPLETION_PHOTO_ERROR} Add one above, then try again.`);
          void retryPhotos(); // a photo may have lost its file: show it as failed
        } else {
          setCompleteError("Couldn't mark it completed. Check your connection and try again.");
        }
      } else {
        failure(next === "closed" && /photo/i.test(raw) ? COMPLETION_PHOTO_ERROR : STATUS_ERROR);
      }
    } finally {
      setBusy(false);
    }
  }

  function openAssign() {
    setAssignStaffId(current.assigned_staff_id != null ? String(current.assigned_staff_id) : "");
    setAssignVisit(visitChoiceFrom(current));
    setDialog("assign");
  }

  function openHold() {
    setHoldReason(current.hold_reason?.trim() || "");
    setFollowUpDate(current.next_follow_up_date?.slice(0, 10) || "");
    setDialog("hold");
  }

  function openComplete() {
    // After a reopen the old "what fixed it" describes the fix that did not hold: start fresh.
    const previous = lastReopenedAt(history) == null ? current.resolution_notes?.trim() || "" : "";
    setResolutionNotes(completionNotesDrafts.get(current.id) ?? previous);
    setCompleteError(null);
    setDialog("complete");
  }

  function changeCompletionNotes(notes: string) {
    setResolutionNotes(notes);
    completionNotesDrafts.set(current.id, notes);
    setCompleteError(null);
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
        void applyStatus("scheduled", {}, `${assignee ?? "Worker"} assigned for ${formatVisit(current)}.`);
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
    const visit = visitPatchFor(assignVisit);
    if (!staffId || !visit) return;
    const name = assigneeName({ assigned_staff_id: staffId }, staffMap) ?? "Worker";
    await applyStatus(
      "scheduled",
      { assigned_staff_id: staffId, ...visit },
      `${name} assigned for ${formatVisit({ ...visit, status: "scheduled", assigned_staff_id: staffId })}.`,
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
    setCompleteError(null);
    await applyStatus("closed", { resolution_notes: notes }, "Marked completed.");
  }

  // Photo uploads: each picked file shows as a tile (uploading → photo, or
  // "Upload failed — Retry"). The data layer removes the row when the file
  // does not make it, so a failed upload never counts as proof.
  function setPendingStatus(key: string, status: PendingPhoto["status"]) {
    setPending((items) => items.map((item) => (item.key === key ? { ...item, status } : item)));
  }

  function dropPending(key: string) {
    pendingFiles.current.delete(key);
    setPending((items) => {
      const gone = items.find((item) => item.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return items.filter((item) => item.key !== key);
    });
  }

  /** Upload the files behind these pending keys, one after another. True when all made it. */
  async function uploadPending(keys: string[]): Promise<boolean> {
    setUploading(true);
    let added = 0;
    let failed = 0;
    try {
      for (const key of keys) {
        const file = pendingFiles.current.get(key);
        if (!file) continue;
        setPendingStatus(key, "uploading");
        try {
          const saved = await app.uploadMaintenancePhoto(current.id, file);
          added += 1;
          dropPending(key);
          // Show (and count) it at once; the silent reload below confirms it.
          setPhotos((list) => (list.some((p) => p.id === saved.id) ? list : [...list, saved]));
        } catch {
          failed += 1;
          setPendingStatus(key, "failed");
        }
      }
    } finally {
      setUploading(false);
      if (added > 0) refresh();
    }
    // In the Complete dialog the tiles say it all; elsewhere confirm with the banner.
    if (dialog !== "complete") {
      if (failed > 0) failure(failed === 1 ? "A photo didn't upload. Use Retry on it." : `${failed} photos didn't upload. Use Retry on them.`);
      else if (added > 0) success(added === 1 ? "Photo added." : `${added} photos added.`);
    }
    return failed === 0;
  }

  function addPhotos(files: FileList | File[]) {
    const inFlight = isWorker ? pending.length : 0;
    const picked = takePhotoFiles(files, Math.max(0, photoSlotsLeft(photos, isWorker) - inFlight));
    if (picked.length === 0) return;
    const items: PendingPhoto[] = picked.map((file) => {
      const key = `pending-${++pendingSeq}`;
      pendingFiles.current.set(key, file);
      return {
        key,
        name: file.name || "Photo",
        previewUrl: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
        status: "uploading",
      };
    });
    setPending((list) => [...list, ...items]);
    void uploadPending(items.map((item) => item.key));
  }

  function retryPending(key: string) {
    if (uploading) return;
    void uploadPending([key]);
  }

  /** A saved photo whose file never arrived: upload a file into the same photo. */
  async function retryMissing(photo: MaintenancePhoto, file: File) {
    setUploading(true);
    try {
      await data.retryMissingMaintenancePhoto(photo, file);
      await retryPhotos();
      if (dialog !== "complete") success("Photo added.");
    } catch {
      failure("That photo still didn't upload. Try again.");
    } finally {
      setUploading(false);
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
      // Keep `busy` until the reload lands: otherwise Accept job is clickable
      // again on the stale (still pooled) row and a second accept fails.
      await load({ silent: true });
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

  function openRelease() {
    setReleaseReason("");
    setReleaseError(null);
    setDialog("release");
  }

  async function confirmRelease() {
    const reason = releaseReason.trim();
    if (!reason || busy) return;
    setBusy(true);
    setReleaseError(null);
    try {
      await data.releaseMaintenanceRequest(current.id, reason);
      setDialog(null);
      // The job is no longer this worker's: it leaves their list (and this page).
      app.setNotice("Job released. The office will reassign it.");
      navigate(backLinkFor(role).to);
    } catch {
      setReleaseError("Couldn't release the job. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function confirmFixed() {
    if (busy) return;
    setBusy(true);
    try {
      await data.confirmMaintenanceRequestFixed(current.id);
      success("Thanks for confirming it's fixed.");
      await load({ silent: true });
    } catch {
      failure("Couldn't save your answer. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function openNotFixed() {
    setNotFixedNote("");
    setNotFixedError(null);
    setDialog("not-fixed");
  }

  async function confirmNotFixed() {
    const note = notFixedNote.trim();
    if (!note || busy) return;
    setBusy(true);
    setNotFixedError(null);
    try {
      await data.reopenMaintenanceRequestNotFixed(current.id, note);
      setDialog(null);
      success("Request reopened. We've let the office know.");
      await load({ silent: true });
    } catch (err) {
      const raw = (err as Error)?.message ?? "";
      setNotFixedError(
        /already confirmed/i.test(raw)
          ? "You already confirmed this is fixed. Report a new request instead."
          : "Couldn't reopen the request. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const selfClaim = FEATURES.workerSelfClaim;

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
      viewerStaffId={myStaffId}
      viewerTenantId={viewerTenantId}
      viewerUserId={viewerUserId}
      soleAdminStaffId={soleAdminStaffId}
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
      onAddPhotos={visibility.addPhotos ? addPhotos : undefined}
      pendingPhotos={pending}
      onRetryPendingPhoto={retryPending}
      onDiscardPendingPhoto={dropPending}
      canRetryMissingPhoto={(photo) => Boolean(viewerUserId) && photo.uploaded_by_user_id === viewerUserId}
      onRetryMissingPhoto={(photo, file) => void retryMissing(photo, file)}
      onSend={visibility.composer ? send : undefined}
      onReopen={visibility.changeStatus ? reopen : undefined}
      onAcceptJob={
        selfClaim && isWorker && current.status === "open" && current.assigned_staff_id == null
          ? () => void acceptJob()
          : undefined
      }
      onReleaseJob={selfClaim && holdsJob && current.status !== "closed" ? openRelease : undefined}
      onConfirmFixed={role === "tenant" ? () => void confirmFixed() : undefined}
      onStillProblem={role === "tenant" ? openNotFixed : undefined}
      onMessageOffice={role === "landlord" ? () => navigate(officeHrefForRequest(current)) : undefined}
      backLabel={back.label}
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
        primaryDisabled={!assignStaffId || !visitPatchFor(assignVisit)}
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
              {assignableStaff(staff, accounts, current.assigned_staff_id).map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {personName(s.first_name, s.last_name)} · {s.job_title?.trim() || "Maintenance"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <VisitWindowFields value={assignVisit} onChange={setAssignVisit} idPrefix="assign" />
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

      <CompleteJobDialog
        open={dialog === "complete"}
        onOpenChange={closeDialog}
        context={dialogContext}
        notes={resolutionNotes}
        onNotesChange={changeCompletionNotes}
        proofPhotos={isWorker ? proof.photos : []}
        need={isWorker ? proof.need : "none"}
        pending={pending}
        slotsLeft={Math.max(0, photoSlotsLeft(photos, isWorker) - pending.length)}
        uploading={uploading}
        onAddPhotos={addPhotos}
        onRetryPending={retryPending}
        onDiscardPending={dropPending}
        error={completeError}
        busy={busy}
        onSubmit={() => void confirmComplete()}
      />

      <NoteDialog
        open={dialog === "release"}
        onOpenChange={closeDialog}
        title="Release this job?"
        description="It goes back to the office to reassign. The tenant isn't told why."
        label="Why are you releasing it?"
        hint="Only the office sees this."
        placeholder="e.g. Need a part I can't get this week"
        value={releaseReason}
        onChange={(v) => {
          setReleaseReason(v);
          setReleaseError(null);
        }}
        primaryLabel="Release job"
        primaryVariant="destructive"
        error={releaseError}
        busy={busy}
        onSubmit={() => void confirmRelease()}
      />

      <NoteDialog
        open={dialog === "not-fixed"}
        onOpenChange={closeDialog}
        title="Still a problem?"
        description="We'll reopen the request and let the office and the worker know."
        label="What's still wrong?"
        hint="A sentence is enough, e.g. “Still dripping under the sink.”"
        value={notFixedNote}
        onChange={(v) => {
          setNotFixedNote(v);
          setNotFixedError(null);
        }}
        primaryLabel="Reopen request"
        error={notFixedError}
        busy={busy}
        onSubmit={() => void confirmNotFixed()}
      />

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
