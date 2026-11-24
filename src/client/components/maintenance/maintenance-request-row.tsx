import * as React from "react";
import { CalendarClock, ChevronDown, Clock, User, UserPlus } from "lucide-react";
import type { StaffMember } from "@/lib/data";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PriorityChip, StatusChip } from "@/components/patterns";
import type { RequestStatus } from "@/components/patterns/status-chip";
import { AdminButton, navProps } from "@/components/dashboard/dashboard-primitives";
import type { WorkOrder } from "@/types";
import type { RequestAge, RequestAssignee } from "./maintenance-list";
import { requestPlaceLine, staffDisplayName } from "./maintenance-list";

const ICON = { size: 14, strokeWidth: 2, absoluteStrokeWidth: true, "aria-hidden": true } as const;

/**
 * One request in the admin Maintenance list.
 *
 * The row (a link to the request) reads: title with its priority and status
 * chips, place and tenant, who is on it ("Unassigned" in amber) and how old it
 * is. In a wide list the assignee and age line up as columns; in a narrow one
 * (phone) they wrap under the place line. `action` sits beside the row link —
 * never inside it — so the row keeps opening the request.
 */
export function MaintenanceRequestRow({
  order,
  status,
  assignee,
  age,
  href,
  onOpen,
  action,
}: {
  order: WorkOrder;
  status: RequestStatus;
  assignee: RequestAssignee;
  age: RequestAge;
  /** In-app route of the request; with `onNavigate` semantics via `onOpen`. */
  href: string | null;
  onOpen: () => void;
  action?: React.ReactNode;
}) {
  const titleId = React.useId();
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span id={titleId} className="lg-body-medium min-w-0 break-words text-foreground">
            {order.title}
          </span>
          {order.priority === "urgent" ? (
            <PriorityChip level="Emergency" />
          ) : order.priority === "high" ? (
            <PriorityChip level="High" />
          ) : null}
          <StatusChip status={status} />
        </span>
        <span className="lg-caption break-words text-muted-foreground">
          {requestPlaceLine(order)}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 @2xl:contents">
        <span
          className={cn(
            "lg-caption flex min-w-0 items-center gap-1.5",
            assignee.unassigned ? "font-medium text-warning" : "text-foreground",
          )}
        >
          <User {...ICON} className="shrink-0" />
          <span className="min-w-0 truncate">
            <span className="sr-only">Assigned to: </span>
            {assignee.label}
          </span>
        </span>
        {age.label ? (
          <span
            title={age.title}
            className={cn(
              "lg-caption flex min-w-0 items-center gap-1.5",
              age.stale ? "font-medium text-warning" : "text-muted-foreground",
            )}
          >
            <Clock {...ICON} className="shrink-0" />
            <span className="min-w-0 truncate">{age.label}</span>
          </span>
        ) : (
          <span className="hidden @2xl:block" />
        )}
      </span>
    </>
  );

  const rowClass = cn(
    "grid min-w-0 flex-1 items-center gap-x-6 gap-y-1.5 self-stretch rounded-sm px-4 py-3 text-left",
    "@2xl:grid-cols-[minmax(0,1fr)_10rem_10.5rem]",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
  );

  return (
    <li className="flex min-w-0 items-center gap-2 transition-colors duration-150 hover:bg-muted/60">
      {href ? (
        <a
          {...navProps(href, onOpen)}
          aria-labelledby={titleId}
          className={rowClass}
          data-testid="maintenance-row"
        >
          {body}
        </a>
      ) : (
        <button type="button" onClick={onOpen} className={rowClass} data-testid="maintenance-row">
          {body}
        </button>
      )}
      {action ? <div className="shrink-0 pr-3">{action}</div> : null}
    </li>
  );
}

/**
 * Inline "Assign" for an unassigned request: a menu of team members, plus a
 * way into the request page to assign and schedule in one go.
 */
export function AssignMenu({
  title,
  staff,
  busy,
  onAssign,
  onAssignAndSchedule,
}: {
  title: string;
  staff: StaffMember[];
  busy: boolean;
  onAssign: (member: StaffMember) => void;
  onAssignAndSchedule: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AdminButton
          className="h-9 gap-1 px-3"
          disabled={busy}
          aria-label={`Assign — ${title}`}
        >
          <UserPlus {...ICON} size={16} className="shrink-0" />
          <span>{busy ? "Assigning…" : "Assign"}</span>
          <ChevronDown {...ICON} className="hidden shrink-0 sm:block" />
        </AdminButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        collisionPadding={16}
        className="lg-admin w-64 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel className="lg-label text-muted-foreground">Assign to</DropdownMenuLabel>
        {staff.length === 0 ? (
          <p className="lg-caption px-2 py-1.5 text-muted-foreground">No team members yet.</p>
        ) : (
          staff.map((member) => (
            <DropdownMenuItem
              key={member.id}
              onSelect={() => onAssign(member)}
              className="min-h-11 cursor-pointer flex-col items-start justify-center gap-0"
            >
              <span className="lg-body-medium text-foreground">{staffDisplayName(member)}</span>
              {member.job_title ? (
                <span className="lg-caption text-muted-foreground">{member.job_title}</span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAssignAndSchedule} className="min-h-11 cursor-pointer gap-2">
          <CalendarClock {...ICON} size={16} className="shrink-0" />
          <span className="lg-body-medium">Assign and schedule…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
