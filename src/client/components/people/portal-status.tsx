import { cn } from "@/lib/utils";

export type PortalStatusKind =
  | "not_invited"
  | "pending"
  | "active"
  | "suspended"
  | "rejected";

const STYLES: Record<PortalStatusKind, { label: string; className: string }> = {
  not_invited: {
    label: "Not invited",
    className: "bg-muted text-muted-foreground",
  },
  pending: {
    label: "Pending approval",
    className: "bg-warning-tint text-warning",
  },
  active: {
    label: "Active",
    className: "bg-success-tint text-success",
  },
  suspended: {
    label: "Suspended",
    className: "bg-destructive-tint text-destructive",
  },
  rejected: {
    label: "Rejected",
    className: "bg-destructive-tint text-destructive",
  },
};

/** Figma `Portal status` chips. */
export function PortalStatus({
  status,
  className,
}: {
  status: PortalStatusKind;
  className?: string;
}) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-xs px-2 py-0.5 text-xs font-medium",
        s.className,
        className,
      )}
    >
      {s.label}
    </span>
  );
}
