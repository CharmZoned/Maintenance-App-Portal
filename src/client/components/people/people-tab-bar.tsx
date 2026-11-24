import { useCallback, useEffect, useRef, useState } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type PeopleTabId = "approvals" | "tenants" | "landlords" | "team" | "vendors";

export const PEOPLE_TABS: { id: PeopleTabId; label: string }[] = [
  { id: "approvals", label: "Approvals" },
  { id: "tenants", label: "Tenants" },
  { id: "landlords", label: "Landlords" },
  { id: "team", label: "Team" },
  { id: "vendors", label: "Vendors" },
];

export function isPeopleTab(v: string | null): v is PeopleTabId {
  return PEOPLE_TABS.some((t) => t.id === v);
}

const FADE = "24px";

/**
 * Figma `People tab` strip — Approvals shows a count badge when > 0.
 *
 * Must sit inside the page's `<Tabs>` root (ui/tabs.tsx, Radix): arrow keys,
 * Home/End and roving focus come from there. On a phone the strip scrolls
 * sideways; the edge that hides more tabs fades out, and the active tab is
 * kept in view.
 */
export function PeopleTabBar({
  active,
  approvalsCount,
}: {
  active: PeopleTabId;
  approvalsCount?: number;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [active]);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "black"}, black ${edges.left ? FADE : "0"}, black calc(100% - ${edges.right ? FADE : "0px"}), ${edges.right ? "transparent" : "black"})`
      : undefined;

  return (
    <div className="border-b border-border">
      <div
        ref={scroller}
        onScroll={measure}
        className="-mb-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        <TabsList
          aria-label="People sections"
          className="flex h-auto w-max min-w-full justify-start gap-1 rounded-none bg-transparent p-0"
        >
          {PEOPLE_TABS.map((tab) => {
            const isActive = tab.id === active;
            const showCount = tab.id === "approvals" && (approvalsCount ?? 0) > 0;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                data-tab={tab.id}
                className={cn(
                  "min-h-11 shrink-0 gap-1.5 rounded-none border-b-2 px-3 py-2.5 text-sm shadow-none focus-visible:ring-inset md:min-h-0",
                  "data-[state=active]:rounded-none data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  isActive
                    ? "border-brand font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {showCount ? (
                  <span
                    aria-label={`${approvalsCount} waiting`}
                    className={cn(
                      "rounded-xs px-1.5 py-px text-[11px] font-medium",
                      isActive ? "bg-brand-tint text-brand-text" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {approvalsCount}
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
    </div>
  );
}
