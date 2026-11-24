import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Property page sections on the shared Radix tabs (audit UX-11): arrow keys
 * move between tabs, each tab controls a labelled tabpanel, and the strip
 * scrolls sideways on a phone with a fade on the side that has more tabs, so
 * a label is never cut to "Messa…". The focus ring is drawn inside the tab so
 * the scroller cannot clip it.
 */
export function PropertyTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  label,
  focusRequest = 0,
  children,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  /**
   * Bump to move focus to the selected tab and bring the strip into view,
   * after a link elsewhere on the page ("View requests") switched tabs.
   */
  focusRequest?: number;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure, tabs.length]);

  // Keep the selected tab in view when it changes from a link or the keyboard.
  useEffect(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!el || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < el.scrollLeft) el.scrollTo({ left: left - 16 });
    else if (right > el.scrollLeft + el.clientWidth) el.scrollTo({ left: right - el.clientWidth + 16 });
  }, [value]);

  useEffect(() => {
    if (!focusRequest) return;
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!el || !active) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    active.focus({ preventScroll: true });
  }, [focusRequest]);

  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as T)} className="space-y-6">
      <div className="relative -mt-2 border-b border-border">
        <div ref={scroller} className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList
            aria-label={label}
            className="flex h-auto w-max min-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-muted-foreground"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  "-mb-px h-11 shrink-0 rounded-none border-b-2 border-transparent px-3 lg-body-medium text-muted-foreground hover:text-foreground",
                  "focus-visible:ring-inset",
                  "data-[state=active]:rounded-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none!",
                )}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity",
            fade.start ? "opacity-100" : "opacity-0",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent transition-opacity",
            fade.end ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
      {children}
    </Tabs>
  );
}

export function PropertyTabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContent value={value} className="mt-0 rounded-sm focus-visible:ring-offset-4">
      {children}
    </TabsContent>
  );
}
