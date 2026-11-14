import type { WorkOrderStatus } from "@/types";

export const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

export const ADMIN_STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "closed", label: "Closed" },
];

export function staffStatusOptions(hasAssignee: boolean): { value: WorkOrderStatus; label: string }[] {
  const base: { value: WorkOrderStatus; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "on_hold", label: "On hold" },
    { value: "closed", label: "Closed" },
  ];
  if (hasAssignee) {
    base.splice(1, 0, { value: "in_progress", label: "In progress" });
  }
  return base;
}
