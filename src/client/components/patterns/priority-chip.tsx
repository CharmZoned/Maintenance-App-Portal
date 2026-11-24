import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PriorityLevel } from "@/lib/request-status";

/** Priority badge — Emergency / High only (Figma Patterns). Map DB values with `priorityLevel()`. */
export type { PriorityLevel };

export function PriorityChip({
  level,
  className,
}: {
  level: PriorityLevel;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        level === "Emergency" ? "bg-destructive-tint text-destructive" : "bg-warning-tint text-warning",
        className,
      )}
    >
      {level === "Emergency" ? <CircleAlert className="size-3 shrink-0" aria-hidden /> : null}
      {level}
    </span>
  );
}
