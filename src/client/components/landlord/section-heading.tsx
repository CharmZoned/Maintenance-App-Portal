import { cn } from "@/lib/utils";

/**
 * Property name above a document group (Figma `2037:558`, 18/26 semibold).
 */
export function LandlordPropertyHeading({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return <h2 className={cn("lg-section text-foreground", className)}>{name}</h2>;
}

/**
 * "WHOLE BUILDING" / "UNIT 1A" label (Figma `2037:559`, 12/18 semibold, muted).
 * Pass `documentScopeGroupLabel` so the wording stays shared.
 */
export function LandlordScopeHeading({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <p className={cn("lg-label uppercase text-muted-foreground", className)}>{label}</p>
  );
}
