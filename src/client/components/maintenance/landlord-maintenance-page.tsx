import { useEffect, useMemo, useState, type ReactNode } from "react";
import { withFrom } from "@/lib/back-link";
import { LandlordPageIntro, LandlordPortalTitle, LandlordPropertyHeading } from "@/components/landlord";
import { StatusChip } from "@/components/patterns";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context";
import { createSingleFlightLoader, type DeepLinkProps } from "@/lib/deep-link";
import { useDeepLinkOpen } from "@/hooks/use-deep-link-open";
import { cn } from "@/lib/utils";
import type { WorkOrder } from "@/types";
import {
  buildLandlordQueue,
  type LandlordQueueGroup,
  type LandlordQueueModel,
  type LandlordQueuePriority,
  type LandlordQueueProperty,
  type LandlordQueueRow,
  type LandlordQueueTab,
} from "./landlord-queue";

const INTRO = {
  eyebrow: "Care for your properties",
  title: "Maintenance",
  description: "Track repairs across your properties and report anything new to Landlord Gopher.",
} as const;

const TABS: { id: LandlordQueueTab; label: string; countKey: keyof LandlordQueueModel["counts"] }[] = [
  { id: "open", label: "Open", countKey: "open" },
  { id: "on_hold", label: "On hold", countKey: "onHold" },
  { id: "completed", label: "Completed", countKey: "completed" },
  { id: "all", label: "All", countKey: "all" },
];

type Phase = "loading" | "error" | "ready";

/**
 * Landlord maintenance queue. Read-only: opening a row goes to the request,
 * and this screen does not start a new request.
 */
export function LandlordMaintenancePage({
  search = "",
  replace,
  navigate,
}: DeepLinkProps & { navigate?: (to: string) => void } = {}) {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<LandlordQueueTab>("open");
  const [propertyId, setPropertyId] = useState<number | "all">("all");

  const listWorkOrders = app.listWorkOrders;
  const setError = app.setError;
  const flight = useMemo(
    () =>
      createSingleFlightLoader(async () => {
        try {
          setListError(null);
          setError(null);
          return await listWorkOrders();
        } catch (err) {
          const message = (err as Error).message;
          setListError(message);
          setError(message);
          throw err;
        }
      }),
    [listWorkOrders, setError],
  );

  async function load() {
    setLoading(true);
    try {
      setOrders(await flight.load());
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await flight.load();
        if (!cancelled) setOrders(list);
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flight]);

  useDeepLinkOpen({
    search,
    param: "wo",
    items: orders,
    loadList: () => flight.load(),
    onList: setOrders,
    onFound: (found) => {
      if (navigate) navigate(`/maintenance/${found.id}`);
      else replace?.("/maintenance");
    },
    onMiss: () => replace?.("/maintenance"),
  });

  const properties = useMemo(() => queueProperties(app.properties, orders), [app.properties, orders]);
  const model = useMemo(
    () => buildLandlordQueue({ orders, properties, tab, propertyId }),
    [orders, properties, tab, propertyId],
  );
  const phase: Phase = loading ? "loading" : listError ? "error" : "ready";

  function openRequest(id: number) {
    if (navigate) navigate(withFrom(`/maintenance/${id}`));
  }

  function clearFilter() {
    if (propertyId !== "all") {
      setPropertyId("all");
      return;
    }
    setTab("all");
  }

  return (
    <PageShell title={<LandlordPortalTitle crumb="Landlord portal / Maintenance" />}>
      <LandlordMaintenanceView
        model={model}
        phase={phase}
        tab={tab}
        onTab={setTab}
        propertyId={propertyId}
        properties={properties}
        onProperty={setPropertyId}
        onRetry={() => void load()}
        onOpen={openRequest}
        onClear={clearFilter}
      />
    </PageShell>
  );
}

export function LandlordMaintenanceView({
  model,
  phase,
  tab,
  onTab,
  propertyId,
  properties,
  onProperty,
  onRetry,
  onOpen,
  onClear,
}: {
  model: LandlordQueueModel;
  phase: Phase;
  tab: LandlordQueueTab;
  onTab: (tab: LandlordQueueTab) => void;
  propertyId: number | "all";
  properties: readonly LandlordQueueProperty[];
  onProperty: (id: number | "all") => void;
  onRetry: () => void;
  onOpen: (id: number) => void;
  onClear: () => void;
}) {
  const showCounts = phase === "ready";
  const showSummary = phase === "ready" && tab === "open" && model.empty == null;
  const showSpendLine = phase === "ready" && tab === "completed" && model.groups.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <LandlordPageIntro eyebrow={INTRO.eyebrow} title={INTRO.title} description={INTRO.description} />

      {showSummary ? <Summary model={model} /> : null}
      {showSpendLine ? <p className="lg-body-medium text-foreground">{model.completedSpendLine}</p> : null}

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Request status">
          {TABS.map((item) => {
            const active = tab === item.id;
            const count = model.counts[item.countKey];
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => onTab(item.id)}
                className={cn(
                  "h-11 shrink-0 rounded-sm px-3 lg-body-medium text-muted-foreground",
                  active && "bg-brand-tint",
                )}
              >
                {showCounts ? `${item.label} · ${count}` : item.label}
              </button>
            );
          })}
        </div>
        <div className="md:ml-auto md:w-[272px]">
          <Select
            value={propertyId === "all" ? "all" : String(propertyId)}
            onValueChange={(value) => onProperty(value === "all" ? "all" : Number(value))}
          >
            <SelectTrigger className="h-11 shadow-raised lg-body-medium" aria-label="Property">
              <SelectValue placeholder="Property: All properties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Property: All properties</SelectItem>
              {properties.map((property) => (
                <SelectItem key={property.id} value={String(property.id)}>
                  {`Property: ${property.name}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {phase === "loading" ? (
        <LoadingList />
      ) : phase === "error" ? (
        <StateCard
          icon="!"
          iconClassName="bg-destructive-tint text-destructive"
          title="We couldn’t load your maintenance requests."
          body="Check your connection and try again. You can still report an issue."
          action={
            <Button type="button" variant="secondary" size="touch" className="w-[120px]" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      ) : model.empty ? (
        <StateCard
          icon={model.empty.kind === "none" ? "🔧" : "⌕"}
          iconClassName="bg-muted text-muted-foreground"
          title={model.empty.title}
          body={model.empty.body}
          action={
            model.empty.kind === "filtered" ? (
              <Button type="button" variant="secondary" size="touch" className="min-w-[140px]" onClick={onClear}>
                Clear filter
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {model.groups.map((group) => (
            <PropertyGroup key={group.propertyId ?? "none"} group={group} onOpen={onOpen} />
          ))}
          {tab === "open" && model.openFooter ? <OpenFooter footer={model.openFooter} /> : null}
          {tab === "completed"
            ? model.completedNotes.map((note) => (
                <p key={note} className="lg-caption text-muted-foreground">
                  {note}
                </p>
              ))
            : null}
        </div>
      )}
    </div>
  );
}

function Summary({ model }: { model: LandlordQueueModel }) {
  return (
    <>
      <div className="rounded-md border border-border bg-card px-4 py-4 md:hidden">
        <p className="lg-body-medium text-foreground">{model.phoneHeadline}</p>
        <p className="mt-1 lg-caption text-muted-foreground">{model.phoneSpend}</p>
      </div>
      <div className="hidden gap-6 md:grid md:grid-cols-3">
        <SummaryCard label="Open requests" value={String(model.counts.open)} detail={model.openDetail} />
        <SummaryCard
          label="On hold"
          value={String(model.counts.onHold)}
          detail={model.onHoldDetail}
          detailCompact={model.onHoldDetailCompact}
        />
        <SummaryCard
          label="Maintenance spend"
          labelCompact="Spend"
          value={model.spendMonthLabel}
          valueCompact={model.spendMonthAmount}
          detail={model.spendYearLabel}
          detailCompact={model.spendCompactDetail}
        />
      </div>
    </>
  );
}

function SummaryCard({
  label,
  labelCompact,
  value,
  valueCompact,
  detail,
  detailCompact,
}: {
  label: string;
  labelCompact?: string;
  value: string;
  valueCompact?: string;
  detail: string;
  detailCompact?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-5 py-4">
      <p className="lg-label uppercase text-muted-foreground">
        <ResponsiveText full={label} compact={labelCompact} />
      </p>
      <p className="mt-1 lg-heading text-foreground">
        <ResponsiveText full={value} compact={valueCompact} />
      </p>
      <p className="mt-1 lg-caption text-muted-foreground">
        <ResponsiveText full={detail} compact={detailCompact} />
      </p>
    </div>
  );
}

function ResponsiveText({ full, compact }: { full: string; compact?: string }) {
  if (!compact || compact === full) return full;
  return (
    <>
      <span className="lg:hidden">{compact}</span>
      <span className="hidden lg:inline">{full}</span>
    </>
  );
}

function PropertyGroup({ group, onOpen }: { group: LandlordQueueGroup; onOpen: (id: number) => void }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <LandlordPropertyHeading name={group.name} />
        {group.subtitle ? (
          <p className="mt-1 hidden lg-caption text-muted-foreground md:block">{group.subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {group.rows.map((row) => (
          <RequestRow key={row.id} row={row} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function RequestRow({ row, onOpen }: { row: LandlordQueueRow; onOpen: (id: number) => void }) {
  return (
    <article className="rounded-md border border-border bg-card px-4 py-4 md:px-5">
      <button
        type="button"
        onClick={() => onOpen(row.id)}
        className="flex w-full items-start gap-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 md:hidden"
        aria-label={`View ${row.title}`}
      >
        <span className="min-w-0 flex-1">
          <RowBody row={row} />
        </span>
        <span className="lg-section text-muted-foreground" aria-hidden>
          ›
        </span>
      </button>
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_13.75rem_5.5rem] md:items-center md:gap-4">
        <RowBody row={row} />
        <StatusChip status={row.status} nextStep={row.statusDetail || undefined} />
        <Button
          type="button"
          variant="secondary"
          size="touch"
          className="w-[88px] justify-self-end"
          onClick={() => onOpen(row.id)}
          aria-label={`View ${row.title}`}
        >
          View
        </Button>
      </div>
    </article>
  );
}

function RowBody({ row }: { row: LandlordQueueRow }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="lg-body-medium text-foreground">{row.title}</p>
        {row.priority ? <PriorityMark priority={row.priority} /> : null}
      </div>
      <p className="mt-1 lg-caption text-muted-foreground">{row.context}</p>
      <div className="mt-2 md:hidden">
        <StatusChip status={row.status} nextStep={row.statusDetail || undefined} />
      </div>
    </div>
  );
}

function PriorityMark({ priority }: { priority: LandlordQueuePriority }) {
  return <Badge variant={priority === "Emergency" ? "destructive" : "warning"}>{priority}</Badge>;
}

function OpenFooter({ footer }: { footer: { desktop: string; phone: string } }) {
  return (
    <p className="lg-caption text-muted-foreground">
      <span className="md:hidden">{footer.phone}</span>
      <span className="hidden md:inline">{footer.desktop}</span>
    </p>
  );
}

function StateCard({
  icon,
  iconClassName,
  title,
  body,
  action,
}: {
  icon: string;
  iconClassName: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-6 py-8 text-center" role={icon === "!" ? "alert" : undefined}>
      <div
        className={cn(
          "mx-auto flex size-12 items-center justify-center rounded-xl lg-section",
          iconClassName,
        )}
        aria-hidden
      >
        {icon}
      </div>
      <h2 className="mt-4 lg-section text-foreground">{title}</h2>
      <p className="mx-auto mt-1 max-w-xl lg-body text-muted-foreground">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading maintenance requests">
      <div className="h-4 w-36 rounded-sm bg-muted" />
      {[0, 1, 2].map((key) => (
        <div key={key} className="rounded-md border border-border bg-card px-5 py-5" aria-hidden>
          <div className="h-3.5 w-64 max-w-full rounded-sm bg-muted" />
          <div className="mt-3 h-2.5 w-80 max-w-[70%] rounded-sm bg-muted" />
          <div className="mt-3 h-5 w-24 rounded-sm bg-muted" />
        </div>
      ))}
    </div>
  );
}

function queueProperties(
  properties: readonly { id: number; name: string; address: string | null; city: string | null }[],
  orders: readonly WorkOrder[],
): LandlordQueueProperty[] {
  const byId = new Map<number, LandlordQueueProperty>();
  for (const property of properties) {
    byId.set(property.id, {
      id: property.id,
      name: property.name,
      address: property.address,
      city: property.city,
    });
  }
  for (const order of orders) {
    if (order.property_id == null || byId.has(order.property_id)) continue;
    byId.set(order.property_id, {
      id: order.property_id,
      name: order.property_name?.trim() || `Property #${order.property_id}`,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}
