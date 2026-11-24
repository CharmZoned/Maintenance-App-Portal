import { cn } from "@/lib/utils";

/** Loading stand-in for ListRow — bones only, never “Loading…” text. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-[100px] w-full items-center justify-between border-b border-border bg-background px-4 py-3 admin:bg-card",
        className,
      )}
      aria-hidden
    >
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3 w-[200px] max-w-full rounded-xs bg-muted" />
        <div className="h-2.5 w-[140px] max-w-[70%] rounded-xs bg-muted" />
      </div>
      <div className="h-[18px] w-16 shrink-0 rounded-xs bg-muted" />
    </div>
  );
}
