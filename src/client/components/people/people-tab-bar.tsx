import { cn } from "@/lib/utils";

export type PeopleTabId = "approvals" | "tenants" | "landlords" | "team" | "vendors";

const TABS: { id: PeopleTabId; label: string }[] = [
  { id: "approvals", label: "Approvals" },
  { id: "tenants", label: "Tenants" },
  { id: "landlords", label: "Landlords" },
  { id: "team", label: "Team" },
  { id: "vendors", label: "Vendors" },
];

/** Figma `People tab` strip — Approvals shows count badge when > 0. */
export function PeopleTabBar({
  active,
  approvalsCount,
  onChange,
}: {
  active: PeopleTabId;
  approvalsCount?: number;
  onChange: (id: PeopleTabId) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border" role="tablist" aria-label="People sections">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const showCount = tab.id === "approvals" && (approvalsCount ?? 0) > 0;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-sm",
              isActive
                ? "border-b-2 border-brand font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {showCount ? (
              <span
                className={cn(
                  "rounded-xs px-1.5 py-px text-[11px] font-medium",
                  isActive ? "bg-brand-tint text-brand-text" : "bg-muted text-muted-foreground",
                )}
              >
                {approvalsCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
