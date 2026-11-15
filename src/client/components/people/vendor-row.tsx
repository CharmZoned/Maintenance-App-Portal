import { cn } from "@/lib/utils";

/** Figma `Vendor row` — name, category, contact. */
export function VendorRow({
  name,
  meta,
  className,
}: {
  name: string;
  meta: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-[100px] w-full items-center justify-between gap-4 border-b border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
    </div>
  );
}
