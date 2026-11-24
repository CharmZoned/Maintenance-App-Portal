import { useEffect, useMemo, useState } from "react";
import { SupportContactNotice } from "@/components/patterns/support-contact-notice";
import type { MouseEvent, ReactNode } from "react";
import {
  Building2,
  Calendar,
  ChevronRight,
  CircleCheck,
  DollarSign,
  FileText,
  TriangleAlert,
  User,
  Wrench,
} from "lucide-react";
import { useApp } from "@/context";
import { useShellChrome } from "@/components/chrome/shell-chrome-context";
import {
  LandlordDocumentRow,
  downloadLandlordDocument,
  LandlordPageIntro,
  LandlordPortalTitle,
  LandlordPropertyHeading,
  LandlordScopeHeading,
} from "@/components/landlord";
import { PageShell } from "@/components/page-shell";
import { ErrorRetry } from "@/components/patterns";
import { StatusChip, type RequestStatus } from "@/components/patterns/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  documentScopeLabel,
  formatDocumentDate,
  landlordDocumentRowModel,
  type LandlordDocumentRowModel,
} from "@/lib/landlord-documents";
import { billedSpend, billedSpendText, billedYearStart } from "@/lib/billed-spend";
import { formatMessageTime, officeMessageHref, threadsFromWorkOrders } from "@/lib/messages";
import { isOpenRequest, requestNextStep, toRequestStatus } from "@/lib/request-status";
import { daysBetween, formatMoney, toIsoDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  UNIT_READINESS_LABELS,
  type Lease,
  type Property,
  type PropertyDocument,
  type RentCharge,
  type Unit,
  type WorkOrder,
} from "@/types";

/**
 * Landlord home (Figma "001 - Landlord Pages", LH — Landlord Home).
 *
 * Read-only. Portfolio edits stay on the staff shell. Shared patterns are
 * imported, not restyled: intro, property heading, day labels, document rows.
 *
 * TODO(data-gap): no landlord rent-roll route, so the rent card states the
 * totals and does not link to a page this portal will bounce away from.
 * TODO(data-gap): no support-contact record and no property photo column.
 * TODO(data-gap): no document-share event for this read-only role, so the
 * success banner (document shared) has nothing live to show.
 * TODO(data-gap): message rows are request threads, not a messages table.
 */

const LEASE_SOON_DAYS = 60;
const NEW_DOCUMENT_DAYS = 21;
const ATTENTION_CAP = 5;
const MAINTENANCE_CAP = 3;
const MESSAGE_CAP = 3;
const ACTIVITY_CAP = 6;

type AttentionTone = "warning" | "info" | "muted";
type AttentionIcon = "alert" | "calendar" | "wrench" | "building";
type ActivityIcon = "wrench" | "file" | "dollar";
type ChipTone = "neutral" | "warning" | "info" | "success";

export type AttentionItem =
  | {
      kind: "link";
      id: string;
      score: number;
      tone: AttentionTone;
      icon: AttentionIcon;
      title: string;
      context: string;
      href: string;
    }
  | {
      kind: "document";
      id: string;
      score: number;
      documentId: number;
      model: LandlordDocumentRowModel;
    };

export type PropertyCardModel = {
  id: number;
  name: string;
  address: string;
  href: string;
  chips: { label: string; tone: ChipTone }[];
  unread: number;
  phoneMeta: string;
};

export type RentCardModel = {
  title: string;
  unavailable: boolean;
  headline: string;
  percent: number;
  caption: string;
  badges: { label: string; tone: ChipTone }[];
  pendingLine: string | null;
};

export type MaintenanceRowModel = {
  id: number;
  title: string;
  href: string;
  status: RequestStatus;
  nextStep?: string;
};

export type ThreadRowModel = {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread: boolean;
  href: string;
  icon: "user" | "wrench";
};

export type ActivityItemModel = {
  id: string;
  icon: ActivityIcon;
  event: string;
  meta: string;
  href?: string;
  at: string;
};

export type ReadyHomeModel = {
  greeting: string;
  subtitle: string;
  kpis: { id: string; label: string; value: string; detail: string; href: string }[];
  attention: AttentionItem[];
  attentionPartial: boolean;
  properties: PropertyCardModel[];
  rent: RentCardModel;
  maintenance: {
    unavailable: boolean;
    countLine: string;
    /** "Billed: $120 this month · $120 this year"; null when the billed read failed. */
    billedLine: string | null;
    rows: MaintenanceRowModel[];
  };
  messages: { unavailable: boolean; unread: number; threads: ThreadRowModel[] };
  activity: { unavailable: boolean; days: { label: string; items: ActivityItemModel[] }[] };
};

type PendingPayment = { amount: number; method: string; propertyId: number | null };

type Bundle = {
  orders: WorkOrder[] | null;
  /** Requests completed this year, with prices, for the Billed line. */
  billed: WorkOrder[] | null;
  charges: RentCharge[] | null;
  leases: Lease[] | null;
  units: Unit[] | null;
  documents: PropertyDocument[] | null;
  pending: PendingPayment[] | null;
  marketed: Map<number, boolean> | null;
};

export function greetingTitle(now: Date, name: string | null): string {
  const hour = now.getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const who = name?.trim();
  return who ? `${hello}, ${who}.` : `${hello}.`;
}

export function portfolioSubtitle(
  kind: "ready" | "empty" | "error",
  counts: { properties: number; units: number },
  now: Date,
): string {
  const month = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (kind === "error") return month;
  if (kind === "empty") return `No properties linked yet · ${month}`;
  return `${plural(counts.properties, "property", "properties")} · ${plural(counts.units, "unit", "units")} · ${month}`;
}

export function buildReadyHome(input: {
  now: Date;
  name: string | null;
  properties: Property[];
  orders: WorkOrder[] | null;
  /**
   * Requests completed this year, with prices (see `billedSpend`). Defaults to
   * the completed requests in `orders`; null when that read failed.
   */
  billed?: WorkOrder[] | null;
  charges: RentCharge[] | null;
  leases: Lease[] | null;
  units: Unit[] | null;
  documents: PropertyDocument[] | null;
  pending: PendingPayment[] | null;
  marketed: Map<number, boolean> | null;
}): ReadyHomeModel {
  const ids = new Set(input.properties.map((property) => property.id));
  const orders = owned(input.orders, ids);
  const billed = input.billed === undefined ? orders : owned(input.billed, ids);
  const charges =
    owned(input.charges, ids)?.filter((charge) => charge.period === currentPeriodFrom(input.now)) ?? null;
  const leases = owned(input.leases, ids);
  const units = input.units?.filter((unit) => ids.has(unit.property_id)) ?? null;
  const documents = owned(input.documents, ids);
  const pending =
    input.pending?.filter((row) => row.propertyId == null || ids.has(row.propertyId)) ?? null;

  const unitCount = input.properties.reduce((sum, property) => sum + (property.unit_count ?? 0), 0);
  const occupied = input.properties.reduce((sum, property) => sum + (property.occupied_count ?? 0), 0);
  const vacant = Math.max(0, unitCount - occupied);
  const openOrders = (orders ?? []).filter(isOpenRequest);
  const holdOrders = openOrders.filter((order) => order.status === "on_hold");
  const names = input.properties.map((property) => property.name);
  const nameDetail =
    names.length <= 2 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} · +${names.length - 2}`;

  const unreadByProperty = unreadCounts(orders ?? []);
  const lateByProperty = lateCounts(charges ?? [], input.now);

  return {
    greeting: greetingTitle(input.now, input.name),
    subtitle: portfolioSubtitle("ready", { properties: input.properties.length, units: unitCount }, input.now),
    kpis: [
      {
        id: "properties",
        label: "Properties",
        value: String(input.properties.length),
        detail: nameDetail || "None linked",
        href: "/properties",
      },
      {
        id: "units",
        label: "Units",
        value: String(unitCount),
        detail: `${occupied} occupied · ${vacant} vacant`,
        href: "/properties",
      },
      {
        id: "occupancy",
        label: "Occupancy",
        value: unitCount === 0 ? "—" : `${Math.round((occupied / unitCount) * 100)}%`,
        detail: unitCount === 0 ? "No units yet" : `${occupied} of ${unitCount} occupied`,
        href: "/properties",
      },
      {
        id: "requests",
        label: "Open requests",
        value: orders == null ? "—" : String(openOrders.length),
        detail: orders == null ? "Couldn't load requests" : holdOrders.length ? `${holdOrders.length} on hold` : "None on hold",
        href: "/maintenance",
      },
    ],
    attention: rankAttention({
      now: input.now,
      properties: input.properties,
      orders,
      charges,
      leases,
      units,
      documents,
      marketed: input.marketed,
    }),
    attentionPartial: orders == null || charges == null || leases == null || documents == null,
    properties: input.properties.map((property) =>
      propertyCard(property, {
        open: (orders ?? []).filter((order) => order.property_id === property.id && isOpenRequest(order)).length,
        late: lateByProperty.get(property.id) ?? 0,
        unread: unreadByProperty.get(property.id) ?? 0,
        ordersKnown: orders != null,
        chargesKnown: charges != null,
      }),
    ),
    rent: rentCard({
      now: input.now,
      charges,
      vacant,
      pending,
    }),
    maintenance: maintenanceCard(orders, billed, input.now),
    messages: messageCard(orders, input.now),
    activity:
      orders == null
        ? { unavailable: true, days: [] }
        : {
            unavailable: false,
            days: groupActivity(activityItems({ now: input.now, orders, documents }), input.now),
          },
  };
}

export function LandlordHomePage({ navigate }: { navigate: (to: string) => void }) {
  const {
    properties,
    loading: portfolioLoading,
    error: portfolioError,
    listWorkOrders,
    listCharges,
    listLeases,
    listPropertyDocuments,
    getPropertyDocumentDownloadUrl,
    setError,
    refreshLookups,
  } = useApp();
  const chrome = useShellChrome();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const propertyKey = properties.map((property) => property.id).join(",");
  const now = useMemo(() => new Date(), [propertyKey, reloadKey, portfolioLoading]);
  const name = firstName(chrome?.displayName, chrome?.email ?? "");

  useEffect(() => {
    if (portfolioLoading) return;
    if (properties.length === 0) {
      setBundle(null);
      setBundleLoading(false);
      return;
    }
    let cancelled = false;
    setBundleLoading(true);
    (async () => {
      const period = currentPeriodFrom(now);
      // Open requests cover counts, attention, maintenance, and messages.
      // A short closed slice is enough for recent completions in activity.
      // Ended leases and the full unit graph are not used by these cards.
      // Billed spend needs every request completed this year, with its price.
      const [openOrders, recentClosed, billed, charges, leases, documents, pending] = await Promise.all([
        listWorkOrders({ open_only: true, skip_staff_notes: true }).then(
          (rows) => rows,
          () => null,
        ),
        listWorkOrders({ status: "closed", limit: ACTIVITY_CAP, skip_staff_notes: true }).then(
          (rows) => rows,
          () => null,
        ),
        listWorkOrders({ status: "closed", closed_since: billedYearStart(now) }).then(
          (rows) => rows,
          () => null,
        ),
        listCharges(period).then(
          (rows) => rows,
          () => null,
        ),
        listLeases({ status: "active" }).then(
          (rows) => rows,
          () => null,
        ),
        listPropertyDocuments().then(
          (rows) => rows,
          () => null,
        ),
        loadPendingPayments(),
      ]);
      if (cancelled) return;
      setBundle({
        orders: openOrders == null ? null : [...openOrders, ...(recentClosed ?? [])],
        billed,
        charges,
        leases,
        units: null,
        documents,
        pending,
        marketed: null,
      });
      setBundleLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    portfolioLoading,
    propertyKey,
    reloadKey,
    now,
    properties.length,
    listWorkOrders,
    listCharges,
    listLeases,
    listPropertyDocuments,
  ]);

  const retry = () => {
    void refreshLookups();
    setReloadKey((key) => key + 1);
  };

  const download = async (documentId: number) => {
    const doc = bundle?.documents?.find((row) => row.id === documentId);
    if (!doc) return;
    try {
      setDownloadingId(doc.id);
      await downloadLandlordDocument(doc, getPropertyDocumentDownloadUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  };

  const greeting = greetingTitle(now, name);
  const onMessage = () => navigate(officeMessageHref());
  const unitCount = properties.reduce((sum, property) => sum + (property.unit_count ?? 0), 0);

  let body: ReactNode;
  if (portfolioLoading) {
    body = <LoadingHome greeting={greeting} onMessage={onMessage} />;
  } else if (portfolioError && properties.length === 0) {
    body = (
      <ErrorHome
        greeting={greeting}
        subtitle={portfolioSubtitle("error", { properties: 0, units: 0 }, now)}
        onRetry={retry}
        onMessage={onMessage}
      />
    );
  } else if (properties.length === 0) {
    body = (
      <EmptyHome
        greeting={greeting}
        subtitle={portfolioSubtitle("empty", { properties: 0, units: 0 }, now)}
        onMessage={onMessage}
      />
    );
  } else if (bundle == null || bundleLoading) {
    body = (
      <LoadingHome
        greeting={greeting}
        subtitle={portfolioSubtitle("ready", { properties: properties.length, units: unitCount }, now)}
        onMessage={onMessage}
      />
    );
  } else {
    const model = buildReadyHome({
      now,
      name,
      properties,
      orders: bundle.orders,
      billed: bundle.billed,
      charges: bundle.charges,
      leases: bundle.leases,
      units: bundle.units,
      documents: bundle.documents,
      pending: bundle.pending,
      marketed: bundle.marketed,
    });
    body = (
      <ReadyHome
        model={model}
        navigate={navigate}
        onDownload={(id) => void download(id)}
        downloadingId={downloadingId}
        onRetry={retry}
      />
    );
  }

  return (
    <PageShell
      title={<LandlordPortalTitle crumb="Landlord portal / Home" />}
      width="max-w-none"
      titleIsPageHeading={false}
    >
      <div className="pb-24 md:pb-0">{body}</div>
      <PhoneActions onMessage={onMessage} />
    </PageShell>
  );
}

function LoadingHome({
  greeting,
  subtitle,
  onMessage,
}: {
  greeting: string;
  subtitle?: string;
  onMessage: () => void;
}) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading home" className="flex flex-col gap-6">
      <span className="sr-only">Loading home</span>
      <div>
        <HomeIntro greeting={greeting} subtitle={subtitle} onMessage={onMessage} />
        {subtitle ? null : <Bone className="mt-2 h-3.5 w-60" />}
      </div>
      <div aria-hidden className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-[124px] rounded-lg border border-border bg-card p-5 md:h-[132px]">
            <Bone className="h-3 w-20" />
            <Bone className="mt-3 h-8 w-14" />
            <Bone className="mt-3 h-2.5 w-28" />
          </div>
        ))}
      </div>
      <div aria-hidden className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <BoneCard rows={5} />
        <BoneCard rows={3} />
        <BoneCard rows={2} />
      </div>
    </div>
  );
}

function ErrorHome({
  greeting,
  subtitle,
  onRetry,
  onMessage,
}: {
  greeting: string;
  subtitle: string;
  onRetry: () => void;
  onMessage: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <HomeIntro greeting={greeting} subtitle={subtitle} onMessage={onMessage} />
      <div className="flex justify-center py-10">
        <ErrorRetry
          className="w-full max-w-[32.5rem]"
          message="We couldn't load your portfolio. Check your connection and try again. If it keeps happening, message Landlord Gopher."
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}

function EmptyHome({
  greeting,
  subtitle,
  onMessage,
}: {
  greeting: string;
  subtitle: string;
  onMessage: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <HomeIntro greeting={greeting} subtitle={subtitle} onMessage={onMessage} />
      <section className="flex flex-col items-center px-4 py-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-md bg-muted text-foreground">
          <Building2 className="size-7" strokeWidth={2} aria-hidden />
        </span>
        <h2 className="mt-4 lg-section text-foreground">No properties are linked to your account yet.</h2>
        <p className="mt-2 max-w-3xl lg-body text-muted-foreground">
          Landlord Gopher links your properties once your management agreement is set up. Message us and
          we&apos;ll get you connected.
        </p>
        <Button type="button" variant="brand" size="touch" className="mt-4 hidden md:inline-flex" onClick={onMessage}>
          Message Landlord Gopher
        </Button>
      </section>
    </div>
  );
}

export function ReadyHome({
  model,
  navigate,
  onDownload,
  downloadingId,
  onRetry,
}: {
  model: ReadyHomeModel;
  navigate: (to: string) => void;
  onDownload: (documentId: number) => void;
  downloadingId: number | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <HomeIntro greeting={model.greeting} subtitle={model.subtitle} onMessage={() => navigate(officeMessageHref())} />
      <ul aria-label="Portfolio" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {model.kpis.map((tile) => (
          <li key={tile.id} className="min-w-0">
            <a
              {...go(navigate, tile.href)}
              className="flex h-full min-h-[124px] flex-col gap-1 rounded-lg border border-border bg-card px-4 py-5 transition-colors hover:border-ring focus-visible:border-ring md:min-h-[132px] md:px-6"
            >
              <span className="lg-body-medium text-muted-foreground">{tile.label}</span>
              <span className="lg-display text-foreground">{tile.value}</span>
              <span className="lg-caption text-muted-foreground">{tile.detail}</span>
            </a>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
          <AttentionCard
            className="order-1 md:col-span-2 xl:order-none"
            items={model.attention}
            partial={model.attentionPartial}
            navigate={navigate}
            onDownload={onDownload}
            downloadingId={downloadingId}
          />
          <PropertiesSection
            className="order-3 md:order-4 md:col-span-2 xl:order-none"
            properties={model.properties}
            navigate={navigate}
          />
          <ActivityCard
            className="order-6 md:order-7 md:col-span-2 xl:order-none"
            activity={model.activity}
            navigate={navigate}
            onRetry={onRetry}
          />
        </div>
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
          <RentCard className="order-2 xl:order-none" rent={model.rent} onRetry={onRetry} />
          <MaintenanceCard
            className="order-4 md:order-3 xl:order-none"
            maintenance={model.maintenance}
            navigate={navigate}
            onRetry={onRetry}
          />
          <MessagesCard
            className="order-5 xl:order-none"
            messages={model.messages}
            navigate={navigate}
            onRetry={onRetry}
          />
          <SupportCard className="order-7 md:order-6 xl:order-none" onMessage={() => navigate(officeMessageHref())} />
        </div>
      </div>
    </div>
  );
}

function HomeIntro({
  greeting,
  subtitle,
  onMessage,
}: {
  greeting: string;
  subtitle?: string;
  onMessage: () => void;
}) {
  return (
    <LandlordPageIntro
      eyebrow="Your portfolio, at a glance"
      title={greeting}
      description={subtitle}
      action={
        <div className="hidden md:block">
          <Button type="button" variant="brand" size="touch" onClick={onMessage}>
            Message Landlord Gopher
          </Button>
        </div>
      }
    />
  );
}

function PhoneActions({ onMessage }: { onMessage: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-[3.25rem] z-30 border-t border-border bg-background px-4 py-3 md:hidden">
      <Button type="button" variant="brand" size="touch" className="w-full" onClick={onMessage}>
        Message Landlord Gopher
      </Button>
    </div>
  );
}

function AttentionCard({
  items,
  partial,
  navigate,
  onDownload,
  downloadingId,
  className,
}: {
  items: AttentionItem[];
  partial: boolean;
  navigate: (to: string) => void;
  onDownload: (documentId: number) => void;
  downloadingId: number | null;
  className?: string;
}) {
  const count = items.length;
  return (
    <section className={cn("rounded-lg border border-border bg-card p-5 md:p-6", className)} aria-labelledby="home-attention">
      <div className="flex items-center gap-3">
        <h2 id="home-attention" className="min-w-0 flex-1 lg-section text-foreground">
          Needs your attention
        </h2>
        {count === 0 ? (
          <Badge variant="success">All clear</Badge>
        ) : (
          <Badge variant="warning">
            <span className="md:hidden">{count}</span>
            <span className="hidden md:inline">{plural(count, "item", "items")}</span>
          </Badge>
        )}
      </div>
      {count > 0 ? (
        <p className="mt-1 hidden lg-caption text-muted-foreground md:block">
          Ranked by urgency. Select an item to open it.
        </p>
      ) : null}
      {count === 0 ? (
        <div className="mt-4 flex gap-3">
          <IconBox tone="success">
            <CircleCheck className="size-5" strokeWidth={2} aria-hidden />
          </IconBox>
          <div className="min-w-0">
            <p className="lg-body-medium text-foreground">Nothing needs you right now.</p>
            <p className="lg-caption text-muted-foreground">
              Urgent repairs, late rent, leases ending soon and anything waiting on you will show up here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {items.map((item) =>
            item.kind === "document" ? (
              <li key={item.id} className="py-3">
                <LandlordDocumentRow
                  className="border-0 bg-transparent p-0 shadow-none"
                  model={item.model}
                  onDownload={() => onDownload(item.documentId)}
                  downloading={downloadingId === item.documentId}
                />
              </li>
            ) : (
              <li key={item.id}>
                <a
                  {...go(navigate, item.href)}
                  className="flex min-h-16 items-center gap-3 py-3 transition-colors hover:bg-muted/60"
                >
                  <IconBox tone={item.tone}>
                    <AttentionGlyph name={item.icon} />
                  </IconBox>
                  <span className="min-w-0 flex-1">
                    <span className="block lg-body-medium text-foreground">{item.title}</span>
                    <span className="block lg-caption text-muted-foreground">{item.context}</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-foreground" strokeWidth={2} aria-hidden />
                </a>
              </li>
            ),
          )}
        </ul>
      )}
      {partial ? (
        <p className="mt-3 lg-caption text-muted-foreground">Some of this list couldn&apos;t be loaded.</p>
      ) : null}
    </section>
  );
}

function PropertiesSection({
  properties,
  navigate,
  className,
}: {
  properties: PropertyCardModel[];
  navigate: (to: string) => void;
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="home-properties">
      <div className="rounded-lg border border-border bg-card p-4 md:rounded-none md:border-0 md:bg-transparent md:p-0">
        <div className="flex items-center justify-between gap-3">
          <h2 id="home-properties" className="lg-section text-foreground">
            Your properties
          </h2>
          <Button type="button" variant="ghost" size="touch" onClick={() => navigate("/properties")}>
            <span className="xl:hidden">View all</span>
            <span className="hidden xl:inline">View all properties</span>
          </Button>
        </div>
        <ul className="mt-1 divide-y divide-border md:hidden">
          {properties.map((property) => (
            <li key={property.id}>
              <a {...go(navigate, property.href)} className="flex min-h-16 items-center gap-3 py-3">
                <IconBox tone="muted">
                  <Building2 className="size-5" strokeWidth={2} aria-hidden />
                </IconBox>
                <span className="min-w-0 flex-1">
                  <span className="block lg-body-medium text-foreground">{property.name}</span>
                  <span className="block lg-caption text-muted-foreground">{property.phoneMeta}</span>
                </span>
                <ChevronRight className="size-5 shrink-0" strokeWidth={2} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
        <ul className="mt-4 hidden gap-4 md:grid md:grid-cols-2">
          {properties.map((property) => (
            <li key={property.id} className="min-w-0">
              <a
                {...go(navigate, property.href)}
                className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-ring"
              >
                <span className="flex h-[140px] flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
                  <Building2 className="size-5" strokeWidth={2} aria-hidden />
                  <span className="lg-caption">Property photo</span>
                </span>
                <span className="flex flex-col gap-2 px-5 pb-5 pt-4">
                  <LandlordPropertyHeading name={property.name} />
                  {property.address ? <span className="lg-body text-muted-foreground">{property.address}</span> : null}
                  <span className="flex flex-wrap gap-1.5">
                    {property.chips.map((chip) => (
                      <Badge key={chip.label} variant={chip.tone === "neutral" ? "neutral" : chip.tone}>
                        {chip.label}
                      </Badge>
                    ))}
                  </span>
                  {property.unread > 0 ? (
                    <span className="flex items-center gap-2 lg-caption text-foreground">
                      <span className="size-2 rounded-full bg-foreground" aria-hidden />
                      {plural(property.unread, "unread message", "unread messages")}
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RentCard({ rent, onRetry, className }: { rent: RentCardModel; onRetry: () => void; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-5 md:p-6", className)} aria-labelledby="home-rent">
      <h2 id="home-rent" className="lg-section text-foreground">
        {rent.title}
      </h2>
      {rent.unavailable ? (
        <div className="mt-3">
          <p className="lg-body text-muted-foreground">Rent totals couldn&apos;t be loaded.</p>
          <Button type="button" variant="secondary" size="touch" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-lg font-semibold leading-[1.625rem] text-foreground xl:text-2xl xl:leading-8">
            {rent.headline}
          </p>
          <div className="flex flex-col gap-2">
            <p className="lg-body-medium text-foreground">{rent.percent}% collected</p>
            <div
              className="h-2 overflow-hidden rounded-xs bg-muted"
              role="progressbar"
              aria-valuenow={rent.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Rent collected"
            >
              <div className="h-full rounded-xs bg-success-solid" style={{ width: `${rent.percent}%` }} />
            </div>
            {rent.caption ? <p className="lg-caption text-muted-foreground">{rent.caption}</p> : null}
          </div>
          {rent.badges.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {rent.badges.map((badge) => (
                <Badge key={badge.label} variant={badge.tone === "neutral" ? "neutral" : badge.tone}>
                  {badge.label}
                </Badge>
              ))}
            </div>
          ) : null}
          {rent.pendingLine ? (
            <p className="flex items-center gap-2 lg-body text-foreground">
              <DollarSign className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              {rent.pendingLine}
            </p>
          ) : null}
          <p className="lg-caption text-muted-foreground">The rent roll isn&apos;t in this portal yet.</p>
        </div>
      )}
    </section>
  );
}

function MaintenanceCard({
  maintenance,
  navigate,
  onRetry,
  className,
}: {
  maintenance: ReadyHomeModel["maintenance"];
  navigate: (to: string) => void;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-5 md:p-6", className)} aria-labelledby="home-maintenance">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-maintenance" className="lg-section text-foreground">
          Maintenance
        </h2>
        <Button type="button" variant="ghost" size="touch" onClick={() => navigate("/maintenance")}>
          View all
        </Button>
      </div>
      {maintenance.unavailable ? (
        <div className="mt-3">
          <p className="lg-body text-muted-foreground">Maintenance couldn&apos;t be loaded.</p>
          <Button type="button" variant="secondary" size="touch" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-lg font-semibold leading-[1.625rem] text-foreground xl:text-2xl xl:leading-8">
            {maintenance.countLine}
          </p>
          {maintenance.billedLine ? (
            <p className="mt-1 lg-body text-foreground">{maintenance.billedLine}</p>
          ) : (
            <p className="mt-1 lg-caption text-muted-foreground">Billed amounts couldn&apos;t be loaded.</p>
          )}
          {maintenance.rows.length === 0 ? (
            <p className="mt-4 lg-body text-muted-foreground">No open requests.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {maintenance.rows.map((row) => (
                <li key={row.id}>
                  <a {...go(navigate, row.href)} className="flex items-center gap-3 py-3 hover:bg-muted/60">
                    <span className="min-w-0 flex-1">
                      <span className="block lg-body-medium text-foreground">{row.title}</span>
                      <StatusChip className="mt-1" status={row.status} nextStep={row.nextStep} />
                    </span>
                    <ChevronRight className="size-5 shrink-0" strokeWidth={2} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function MessagesCard({
  messages,
  navigate,
  onRetry,
  className,
}: {
  messages: ReadyHomeModel["messages"];
  navigate: (to: string) => void;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-5 md:p-6", className)} aria-labelledby="home-messages">
      <div className="flex items-center gap-3">
        <h2 id="home-messages" className="min-w-0 flex-1 lg-section text-foreground">
          Messages
        </h2>
        {!messages.unavailable && messages.threads.length > 0 ? (
          <Badge variant={messages.unread > 0 ? "warning" : "success"}>
            {messages.unread > 0 ? `${messages.unread} unread` : "All read"}
          </Badge>
        ) : null}
      </div>
      {messages.unavailable ? (
        <div className="mt-3">
          <p className="lg-body text-muted-foreground">Messages couldn&apos;t be loaded.</p>
          <Button type="button" variant="secondary" size="touch" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : messages.threads.length === 0 ? (
        <p className="mt-3 lg-body text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {messages.threads.map((thread) => (
            <li key={thread.id}>
              <a {...go(navigate, thread.href)} className="flex min-h-14 items-center gap-3 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-foreground">
                  {thread.icon === "user" ? (
                    <User className="size-5" strokeWidth={2} aria-hidden />
                  ) : (
                    <Wrench className="size-5" strokeWidth={2} aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-foreground", thread.unread ? "lg-body-medium" : "lg-body")}>
                      {thread.name}
                    </span>
                    <span className="shrink-0 lg-caption text-muted-foreground">{thread.time}</span>
                  </span>
                  <span className="block truncate lg-caption text-muted-foreground">{thread.preview}</span>
                </span>
                {thread.unread ? <span className="size-2.5 shrink-0 rounded-full bg-foreground" aria-label="Unread" /> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="secondary" size="touch" className="mt-3 w-full" onClick={() => navigate("/messages")}>
        Open messages
      </Button>
    </section>
  );
}

function ActivityCard({
  activity,
  navigate,
  onRetry,
  className,
}: {
  activity: ReadyHomeModel["activity"];
  navigate: (to: string) => void;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-5 md:p-6", className)} aria-labelledby="home-activity">
      <h2 id="home-activity" className="lg-section text-foreground">
        Recent activity
      </h2>
      {activity.unavailable ? (
        <div className="mt-3">
          <p className="lg-body text-muted-foreground">Recent activity couldn&apos;t be loaded.</p>
          <Button type="button" variant="secondary" size="touch" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : activity.days.length === 0 ? (
        <p className="mt-3 lg-body text-muted-foreground">Nothing new across your properties.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {activity.days.map((day) => (
            <div key={day.label}>
              <LandlordScopeHeading label={day.label} />
              <ul>
                {day.items.map((item) => {
                  const body = (
                    <>
                      <IconBox tone="muted" size="sm">
                        <ActivityGlyph name={item.icon} />
                      </IconBox>
                      <span className="min-w-0 flex-1">
                        <span className="block lg-body text-foreground">{item.event}</span>
                        <span className="block lg-caption text-muted-foreground">{item.meta}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id} className="py-2">
                      {item.href ? (
                        <a {...go(navigate, item.href)} className="flex items-start gap-3">
                          {body}
                        </a>
                      ) : (
                        <div className="flex items-start gap-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SupportCard({ onMessage, className }: { onMessage: () => void; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-5 md:p-6", className)} aria-labelledby="home-support">
      <h2 id="home-support" className="lg-section text-foreground">
        A little help, when you need it.
      </h2>
      <p className="mt-3 hidden lg-body text-muted-foreground md:block">Your Landlord Gopher contact</p>
      <SupportContactNotice variant="list" className="mt-2" />
      <p className="mt-1 lg-caption text-muted-foreground">Or message us and we&apos;ll get you connected.</p>
      <Button type="button" variant="secondary" size="touch" className="mt-4 w-full" onClick={onMessage}>
        Message
      </Button>
    </section>
  );
}

function IconBox({
  tone,
  size = "md",
  children,
}: {
  tone: AttentionTone | "brand" | "success";
  size?: "md" | "sm";
  children: ReactNode;
}) {
  const tones: Record<typeof tone, string> = {
    warning: "bg-warning-tint text-foreground",
    info: "bg-info-tint text-foreground",
    muted: "bg-muted text-foreground",
    brand: "bg-brand-tint text-foreground",
    success: "bg-success-tint text-success",
  };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "sm" ? "size-8 rounded-lg" : "size-10 rounded-md",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function AttentionGlyph({ name }: { name: AttentionIcon }) {
  const className = "size-5";
  if (name === "alert") return <TriangleAlert className={className} strokeWidth={2} aria-hidden />;
  if (name === "calendar") return <Calendar className={className} strokeWidth={2} aria-hidden />;
  if (name === "wrench") return <Wrench className={className} strokeWidth={2} aria-hidden />;
  return <Building2 className={className} strokeWidth={2} aria-hidden />;
}

function ActivityGlyph({ name }: { name: ActivityIcon }) {
  const className = "size-4";
  if (name === "file") return <FileText className={className} strokeWidth={2} aria-hidden />;
  if (name === "dollar") return <DollarSign className={className} strokeWidth={2} aria-hidden />;
  return <Wrench className={className} strokeWidth={2} aria-hidden />;
}

function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-xs bg-muted motion-safe:animate-pulse", className)} />;
}

function BoneCard({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <Bone className="h-4 w-40" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Bone className="size-10 rounded-md" />
            <div className="flex-1 space-y-2 py-1">
              <Bone className="h-3 w-full" />
              <Bone className="h-2.5 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function go(navigate: (to: string) => void, href: string) {
  return {
    href,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(href);
    },
  };
}

function rankAttention(input: {
  now: Date;
  properties: Property[];
  orders: WorkOrder[] | null;
  charges: RentCharge[] | null;
  leases: Lease[] | null;
  units: Unit[] | null;
  documents: PropertyDocument[] | null;
  marketed: Map<number, boolean> | null;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const today = toIsoDate(input.now);

  for (const charge of input.charges ?? []) {
    if (charge.status === "paid" || charge.status === "waived") continue;
    const outstanding = Math.max(0, Number(charge.amount) - Number(charge.amount_paid));
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;
    const lateByStatus = charge.status === "overdue";
    const lateDays = daysBetween(dayKey(charge.due_date), today);
    const daysKnown = Number.isFinite(lateDays);
    if (!daysKnown && !lateByStatus) continue;
    if (daysKnown && !lateByStatus && lateDays <= 0) continue;
    const days = daysKnown ? Math.max(lateDays, lateByStatus ? 1 : 0) : null;
    const unit = charge.unit_name?.trim();
    const tenant = person(charge.tenant_first_name, charge.tenant_last_name);
    const property = charge.property_name?.trim() || "Property";
    const lateLabel = days == null ? "Overdue" : `Late ${days} ${days === 1 ? "day" : "days"}`;
    items.push({
      kind: "link",
      id: `rent-${charge.id}`,
      score: 1000 + (days ?? 0),
      tone: "warning",
      icon: "alert",
      title:
        days == null
          ? `${unit ? `Unit ${unit} ` : ""}rent overdue · ${formatMoney(outstanding)} outstanding`
          : `${unit ? `Unit ${unit} ` : ""}rent ${days} ${days === 1 ? "day" : "days"} late · ${formatMoney(outstanding)} outstanding`,
      context: [property, tenant, lateLabel].filter(Boolean).join(" · "),
      href: charge.property_id != null ? `/properties/${charge.property_id}` : "/properties",
    });
  }

  for (const lease of input.leases ?? []) {
    if (lease.status !== "active" || !lease.end_date) continue;
    const remaining = daysBetween(today, dayKey(lease.end_date));
    if (!Number.isFinite(remaining) || remaining < 0 || remaining > LEASE_SOON_DAYS) continue;
    const unit = lease.unit_name?.trim();
    const tenant = person(lease.tenant_first_name, lease.tenant_last_name);
    const when = new Date(`${dayKey(lease.end_date)}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const place = [unit ? `Unit ${unit}` : null, tenant].filter(Boolean).join(" · ");
    items.push({
      kind: "link",
      id: `lease-${lease.id}`,
      score: 800 - remaining,
      tone: "info",
      icon: "calendar",
      title:
        remaining === 0
          ? `Lease ends today${place ? ` · ${place}` : ""}`
          : `Lease ends in ${plural(remaining, "day", "days")}${place ? ` · ${place}` : ""}`,
      context: `Lease ends ${when}`,
      href: lease.property_id != null ? `/properties/${lease.property_id}` : "/properties",
    });
  }

  for (const order of input.orders ?? []) {
    if (!isOpenRequest(order)) continue;
    const urgent = urgentAttention(order);
    if (urgent) {
      items.push(urgent);
      continue;
    }
    if (order.status !== "on_hold") continue;
    const follow = order.next_follow_up_date
      ? new Date(`${dayKey(order.next_follow_up_date)}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : "";
    const reason = order.hold_reason?.trim();
    items.push({
      kind: "link",
      id: `hold-${order.id}`,
      score: 600,
      tone: "muted",
      icon: "wrench",
      title: `${order.title} on hold${follow ? ` · follow-up ${follow}` : ""}`,
      context: [requestLabel(order), order.property_name, reason].filter(Boolean).join(" · "),
      href: `/maintenance/${order.id}`,
    });
  }

  items.push(...vacantItems(input.properties, input.units, input.marketed));

  for (const doc of input.documents ?? []) {
    const age = daysBetween(dayKey(doc.created_at), today);
    const fromOffice = doc.uploaded_by_role === "admin" || doc.uploaded_by_role === "staff";
    if (!fromOffice || age < 0 || age > NEW_DOCUMENT_DAYS) continue;
    const model = landlordDocumentRowModel(doc, { now: input.now });
    items.push({
      kind: "document",
      id: `doc-${doc.id}`,
      score: 200 - age,
      documentId: doc.id,
      model: {
        ...model,
        title: `New document from Landlord Gopher · ${model.title}`,
      },
    });
  }

  return items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, ATTENTION_CAP);
}

/**
 * An open Emergency or High-priority request on the owner's property, linking
 * to the request. Emergency outranks everything; High sits just under late
 * rent. It replaces the plain on-hold line for the same request.
 */
function urgentAttention(order: WorkOrder): AttentionItem | null {
  const emergency = order.priority === "urgent";
  if (!emergency && order.priority !== "high") return null;
  const created = Date.parse(order.created_at);
  const unit = order.unit_name?.trim();
  return {
    kind: "link",
    id: `priority-${order.id}`,
    // The band sets the rank; newer requests come first within it.
    score: (emergency ? 3000 : 900) + (Number.isFinite(created) ? created / 1e13 : 0),
    tone: "warning",
    icon: "alert",
    title: `${emergency ? "Emergency" : "High priority"} · ${order.title}`,
    context: [requestLabel(order), order.property_name?.trim(), unit ? `Unit ${unit}` : null, toRequestStatus(order)]
      .filter(Boolean)
      .join(" · "),
    href: `/maintenance/${order.id}`,
  };
}

function vacantItems(
  properties: Property[],
  units: Unit[] | null,
  marketed: Map<number, boolean> | null,
): AttentionItem[] {
  if (units) {
    const byProperty = new Map<number, Unit[]>();
    for (const unit of units) {
      if (unit.status !== "vacant") continue;
      const list = byProperty.get(unit.property_id) ?? [];
      list.push(unit);
      byProperty.set(unit.property_id, list);
    }
    return [...byProperty.entries()].map(([propertyId, vacant]) => {
      const property = properties.find((row) => row.id === propertyId);
      const name = property?.name ?? vacant[0]?.property_name ?? "Property";
      const flags = vacant.map((unit) => marketed?.get(unit.id));
      const notMarketed = marketed != null && flags.every((flag) => flag === false);
      const readiness = new Set(vacant.map((unit) => unit.readiness_status));
      const label = readiness.size === 1 ? UNIT_READINESS_LABELS[vacant[0].readiness_status] : null;
      return {
        kind: "link" as const,
        id: `vacant-${propertyId}`,
        score: 400,
        tone: "muted" as const,
        icon: "building" as const,
        title: `${name} ${plural(vacant.length, "vacant", "vacant")}${notMarketed ? " and not marketed" : ""}`,
        context: label ? `Vacant · ${label}` : "Vacant",
        href: `/properties/${propertyId}`,
      };
    });
  }
  return properties.flatMap((property) => {
    const count = Math.max(0, (property.unit_count ?? 0) - (property.occupied_count ?? 0));
    if (count <= 0) return [];
    return [
      {
        kind: "link" as const,
        id: `vacant-${property.id}`,
        score: 400,
        tone: "muted" as const,
        icon: "building" as const,
        title: `${property.name} ${count} vacant`,
        context: "Vacant",
        href: `/properties/${property.id}`,
      },
    ];
  });
}

function propertyCard(
  property: Property,
  facts: { open: number; late: number; unread: number; ordersKnown: boolean; chargesKnown: boolean },
): PropertyCardModel {
  const units = property.unit_count ?? 0;
  const occupied = property.occupied_count ?? 0;
  const chips: PropertyCardModel["chips"] = [
    { label: plural(units, "unit", "units"), tone: "neutral" },
    { label: `${occupied} of ${units} occupied`, tone: "neutral" },
  ];
  if (facts.chargesKnown && facts.late > 0) chips.push({ label: `Rent · ${facts.late} late`, tone: "warning" });
  if (facts.ordersKnown) {
    chips.push(
      facts.open > 0
        ? { label: plural(facts.open, "open request", "open requests"), tone: "info" }
        : { label: "No open requests", tone: "neutral" },
    );
  }
  const phone = [
    `${occupied} of ${units} occupied`,
    facts.chargesKnown && facts.late > 0 ? `Rent: ${facts.late} late` : null,
    facts.ordersKnown ? `${facts.open} open` : null,
    facts.unread > 0 ? `${facts.unread} unread` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: property.id,
    name: property.name,
    address: [property.address, property.city].filter(Boolean).join(", "),
    href: `/properties/${property.id}`,
    chips,
    unread: facts.unread,
    phoneMeta: phone,
  };
}

function rentCard(input: {
  now: Date;
  charges: RentCharge[] | null;
  vacant: number;
  pending: PendingPayment[] | null;
}): RentCardModel {
  const month = input.now.toLocaleDateString(undefined, { month: "long" });
  const title = `Rent · ${month}`;
  if (input.charges == null) {
    return {
      title,
      unavailable: true,
      headline: "",
      percent: 0,
      caption: "",
      badges: [],
      pendingLine: null,
    };
  }
  const active = input.charges.filter((charge) => charge.status !== "waived");
  const expected = active.reduce((sum, charge) => sum + Number(charge.amount), 0);
  const collected = active.reduce((sum, charge) => sum + Number(charge.amount_paid), 0);
  const outstanding = Math.max(0, expected - collected);
  const percent = expected <= 0 ? 0 : Math.min(100, Math.round((collected / expected) * 100));
  const lateCharges = active.filter((charge) => {
    if (charge.status === "paid") return false;
    return charge.status === "overdue" || daysBetween(dayKey(charge.due_date), toIsoDate(input.now)) > 0;
  });
  const lateUnits = new Set(lateCharges.map((charge) => charge.unit_id).filter((id) => id != null)).size || lateCharges.length;
  const paidCount = active.filter((charge) => charge.status === "paid").length;
  const headline =
    expected <= 0
      ? "No rent charges this month"
      : collected >= expected
        ? `All ${formatMoney(expected)} collected`
        : `${formatMoney(collected)} of ${formatMoney(expected)} collected`;
  const caption =
    outstanding <= 0
      ? "Nothing outstanding"
      : lateUnits > 0
        ? `${formatMoney(outstanding)} outstanding · ${plural(lateUnits, "unit", "units")} late`
        : `${formatMoney(outstanding)} outstanding`;
  const badges: RentCardModel["badges"] = [];
  if (active.length > 0) badges.push({ label: `Paid ${paidCount}`, tone: "success" });
  if (lateCharges.length > 0) badges.push({ label: `Late ${lateCharges.length}`, tone: "warning" });
  if (input.vacant > 0) badges.push({ label: `Vacant ${input.vacant}`, tone: "neutral" });
  return {
    title,
    unavailable: false,
    headline,
    percent,
    caption,
    badges,
    pendingLine: pendingLine(input.pending),
  };
}

function pendingLine(pending: PendingPayment[] | null): string | null {
  if (pending == null) return null;
  if (pending.length === 0) return "No payments awaiting verification";
  const total = pending.reduce((sum, row) => sum + row.amount, 0);
  const methods = new Set(pending.map((row) => paymentMethodLabel(row.method)));
  const method = methods.size === 1 ? [...methods][0] : "";
  return method
    ? `Awaiting verification ${formatMoney(total)} · ${method}`
    : `Awaiting verification ${formatMoney(total)}`;
}

function maintenanceCard(
  orders: WorkOrder[] | null,
  billed: WorkOrder[] | null,
  now: Date,
): ReadyHomeModel["maintenance"] {
  if (orders == null) {
    return { unavailable: true, countLine: "", billedLine: null, rows: [] };
  }
  const open = orders.filter(isOpenRequest);
  const hold = open.filter((order) => order.status === "on_hold").length;
  return {
    unavailable: false,
    countLine: `${open.length} open · ${hold} on hold`,
    billedLine: billed == null ? null : billedSpendText(billedSpend(billed, now)).line,
    rows: open
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, MAINTENANCE_CAP)
      .map((order) => ({
        id: order.id,
        title: maintenanceTitle(order),
        href: `/maintenance/${order.id}`,
        status: toRequestStatus(order),
        nextStep: requestNextStep(order),
      })),
  };
}

function messageCard(orders: WorkOrder[] | null, now: Date): ReadyHomeModel["messages"] {
  if (orders == null) return { unavailable: true, unread: 0, threads: [] };
  const byId = new Map(orders.map((order) => [order.id, order]));
  const all = threadsFromWorkOrders(orders, { now });
  const threads = all.slice(0, MESSAGE_CAP);
  return {
    unavailable: false,
    unread: all.filter((thread) => thread.unread).length,
    threads: threads.map((thread) => {
      const order = thread.requestId != null ? byId.get(thread.requestId) : undefined;
      const tenant = order ? person(order.tenant_first_name, order.tenant_last_name) : "";
      const place = order?.unit_name
        ? `Unit ${order.unit_name}`
        : order?.property_name || "";
      return {
        id: thread.id,
        name: [tenant || order?.title || thread.title, place].filter(Boolean).join(" · "),
        preview: thread.preview,
        time: formatMessageTime(thread.updatedAt, now),
        unread: thread.unread,
        href: `/messages?thread=${encodeURIComponent(thread.id)}`,
        icon: tenant ? "user" : "wrench",
      };
    }),
  };
}

function activityItems(input: {
  now: Date;
  orders: WorkOrder[] | null;
  documents: PropertyDocument[] | null;
}): ActivityItemModel[] {
  const items: ActivityItemModel[] = [];
  for (const order of input.orders ?? []) {
    const tenant = person(order.tenant_first_name, order.tenant_last_name);
    items.push({
      id: `wo-${order.id}`,
      icon: "wrench",
      event: tenant ? `${tenant} reported "${order.title}"` : `Request opened "${order.title}"`,
      meta: activityPlace(order, clock(order.created_at)),
      href: `/maintenance/${order.id}`,
      at: order.created_at,
    });
    if (order.completed_at) {
      items.push({
        id: `wo-done-${order.id}`,
        icon: "wrench",
        event: `"${order.title}" was completed`,
        meta: activityPlace(order, clock(order.completed_at)),
        href: `/maintenance/${order.id}`,
        at: order.completed_at,
      });
    }
  }
  for (const doc of input.documents ?? []) {
    const model = landlordDocumentRowModel(doc, { now: input.now });
    const fromOffice = doc.uploaded_by_role === "admin" || doc.uploaded_by_role === "staff";
    items.push({
      id: `doc-${doc.id}`,
      icon: "file",
      event: fromOffice ? `Landlord Gopher shared "${model.title.replace(/^New document from Landlord Gopher · /, "")}"` : `Document added "${doc.title}"`,
      meta: [doc.property_name, documentScopeLabel(doc), formatDocumentDate(doc.created_at, input.now)]
        .filter(Boolean)
        .join(" · "),
      href: "/documents",
      at: doc.created_at,
    });
  }
  return items
    .filter((item) => item.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_CAP);
}

function groupActivity(items: ActivityItemModel[], now: Date): { label: string; items: ActivityItemModel[] }[] {
  const groups: { label: string; items: ActivityItemModel[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function unreadCounts(orders: WorkOrder[]): Map<number, number> {
  const byId = new Map(orders.map((order) => [order.id, order]));
  const counts = new Map<number, number>();
  for (const thread of threadsFromWorkOrders(orders)) {
    if (!thread.unread || thread.requestId == null) continue;
    const propertyId = byId.get(thread.requestId)?.property_id;
    if (propertyId == null) continue;
    counts.set(propertyId, (counts.get(propertyId) ?? 0) + 1);
  }
  return counts;
}

function lateCounts(charges: RentCharge[], now: Date): Map<number, number> {
  const counts = new Map<number, number>();
  const today = toIsoDate(now);
  for (const charge of charges) {
    if (charge.property_id == null || charge.status === "paid" || charge.status === "waived") continue;
    const late = charge.status === "overdue" || daysBetween(dayKey(charge.due_date), today) > 0;
    if (!late) continue;
    counts.set(charge.property_id, (counts.get(charge.property_id) ?? 0) + 1);
  }
  return counts;
}

function maintenanceTitle(order: WorkOrder): string {
  const where = order.unit_name?.trim() || order.property_name?.trim() || "";
  return `${requestLabel(order)} ${order.title}${where ? ` · ${where}` : ""}`;
}

function activityPlace(order: WorkOrder, when: string): string {
  const place = order.unit_name?.trim()
    ? [order.property_name, order.unit_name.trim()].filter(Boolean).join(" · ")
    : [order.property_name, "common area"].filter(Boolean).join(" · ");
  return [place, when].filter(Boolean).join(" · ");
}

function requestLabel(order: WorkOrder): string {
  const num = order.request_number?.trim();
  if (!num) return `WO-${order.id}`;
  return num.startsWith("#") ? num : `#${num}`;
}

function person(first?: string | null, last?: string | null): string {
  return [first, last].map((part) => part?.trim()).filter(Boolean).join(" ");
}

function owned<T extends { property_id?: number | null }>(rows: T[] | null, ids: Set<number>): T[] | null {
  if (rows == null) return null;
  return rows.filter((row) => row.property_id == null || ids.has(row.property_id));
}

function dayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return toIsoDate(parsed);
}

function dayLabel(iso: string, now: Date): string {
  const key = dayKey(iso);
  const date = key ? new Date(`${key}T00:00:00`) : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = daysBetween(key || toIsoDate(date), toIsoDate(now));
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const dayMonth = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (diff === 0) return `Today · ${weekday} ${dayMonth}`;
  return `${weekday} ${dayMonth}`;
}

function clock(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime()) || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return parsed
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(" AM", " am")
    .replace(" PM", " pm");
}

function currentPeriodFrom(now: Date): string {
  return toIsoDate(now).slice(0, 7);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function paymentMethodLabel(method: string): string {
  switch (method.toLowerCase()) {
    case "zelle":
      return "Zelle";
    case "ach":
      return "ACH";
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "credit":
      return "Card";
    default:
      return method;
  }
}

function firstName(displayName: string | null | undefined, email: string): string | null {
  const named = displayName?.trim().split(/\s+/)[0];
  if (named) return named;
  const local = email.split("@")[0] ?? "";
  const bit = local.split(/[._-]+/).filter(Boolean)[0];
  // "landlord@…" is a role, not a name: greet without one rather than "Landlord".
  if (!bit || ROLE_WORDS.has(bit.toLowerCase())) return null;
  return bit.charAt(0).toUpperCase() + bit.slice(1);
}

const ROLE_WORDS = new Set(["landlord", "owner", "admin", "office", "info", "tenant", "maintenance", "staff"]);

async function loadPendingPayments(): Promise<PendingPayment[] | null> {
  try {
    const data = await import("@/lib/data");
    return await data.listPaymentsAwaitingVerification().then(
      (rows) =>
        rows.map((row) => ({
          amount: row.amount,
          method: row.method,
          propertyId: row.charge?.property_id ?? null,
        })),
      () => null,
    );
  } catch {
    return null;
  }
}
