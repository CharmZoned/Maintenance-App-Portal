import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Toolbar title for landlord screens (Figma page header on 001 Landlord Pages).
 * Phone shows the brand, or `mobileLabel` when a screen names itself there
 * (request detail uses the request number). Desktop is the breadcrumb.
 */
export function LandlordPortalTitle({
  crumb,
  mobileLabel = "Landlord Gopher",
}: {
  crumb: string;
  mobileLabel?: string;
}) {
  return (
    <>
      <span className="lg-body font-medium md:hidden">{mobileLabel}</span>
      <span className="lg-body hidden font-medium md:inline">{crumb}</span>
    </>
  );
}

type Chip = { label: string; tone: "neutral" | "warning" | "info" | "success" | "brand" };

export function ToneBadge({ chip }: { chip: Chip }) {
  return <Badge variant={chip.tone}>{chip.label}</Badge>;
}

export function StatusBanner({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-sm border border-border bg-card p-5 md:flex-row md:items-center" role="alert">
      <div className="min-w-0 flex-1">
        <p className="lg-body-medium text-foreground">{title}</p>
        <p className="mt-1 lg-body text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">{actions}</div>
    </div>
  );
}

export function sectionCardClass(className?: string) {
  return cn("flex flex-col gap-3 rounded-sm border border-border bg-card p-6", className);
}
