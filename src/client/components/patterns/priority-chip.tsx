import { cn } from "@/lib/utils";

/** Priority badge — Emergency / High only (Figma Patterns). */
export type PriorityLevel = "Emergency" | "High";

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
        "inline-flex shrink-0 items-center rounded-sm px-2 py-0.5 text-xs font-medium",
        level === "Emergency" ? "bg-destructive-tint text-destructive" : "bg-warning-tint text-warning",
        className,
      )}
    >
      {level}
    </span>
  );
}
