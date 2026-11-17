import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import { TenantSubmitDialog } from "@/components/maintenance/tenant-submit-dialog";
import {
  countPropertyDocuments,
  listChargesForTenantLeases,
} from "@/lib/data";
import { isOpenRequest, unitPropertyLabel } from "@/lib/request-status";
import { cn, formatDate, formatMoney, toIsoDate } from "@/lib/utils";
import type { RentCharge, TenantHomeContext, WorkOrder } from "@/types";
import illustrativePhoto from "@/assets/tenant-home-illustrative.jpg";

type RentSummary = {
  balanceLabel: string;
  dueLabel: string;
  statusLabel: string;
  hasCharges: boolean;
};

const RENT_UNAVAILABLE: RentSummary = {
  balanceLabel: "Balance unavailable",
  dueLabel: "Not available",
  statusLabel: "Not connected",
  hasCharges: false,
};

function summarizeRent(charges: RentCharge[]): RentSummary {
  const open = charges.filter((c) => c.status !== "paid" && c.status !== "waived");
  if (open.length === 0) {
    if (charges.length === 0) return RENT_UNAVAILABLE;
    return {
      balanceLabel: formatMoney(0),
      dueLabel: "—",
      statusLabel: "Paid up",
      hasCharges: true,
    };
  }

  const today = toIsoDate(new Date());
  const balance = open.reduce(
    (sum, c) => sum + Math.max(0, (c.amount ?? 0) - (c.amount_paid ?? 0)),
    0,
  );
  const nextDue = [...open]
    .map((c) => c.due_date)
    .filter(Boolean)
    .sort()[0];
  const overdue = open.some((c) => {
    const remaining = (c.amount ?? 0) - (c.amount_paid ?? 0);
    if (remaining <= 0) return false;
    return c.status === "overdue" || (Boolean(c.due_date) && c.due_date < today);
  });
  const partial = open.some((c) => c.status === "partial" || (c.amount_paid ?? 0) > 0);

  return {
    balanceLabel: formatMoney(balance),
    dueLabel: nextDue ? formatDate(nextDue) : "Not available",
    statusLabel: overdue ? "Past due" : partial ? "Partial" : "Open",
    hasCharges: true,
  };
}

/**
 * Tenant Home — Figma triad Mobile `2024:1576` · Tablet `2024:1509` · Desktop `2017:2`.
 * Live: unit/property/address, open WO count, documents summary, rent from scoped RentCharges.
 * Mocked with TODO(data-gap): messages inbox, support contact, property manager, pay processors.
 */
export function TenantHomePage({ navigate }: { navigate: (to: string) => void }) {
  const { getTenantHomeContext, listWorkOrders, setError } = useApp();
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [docCount, setDocCount] = useState(0);
  const [rent, setRent] = useState<RentSummary>(RENT_UNAVAILABLE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setRent(RENT_UNAVAILABLE);
      try {
        const [ctx, woList] = await Promise.all([
          getTenantHomeContext(),
          listWorkOrders({ open_only: true, skip_staff_notes: true }),
        ]);
        if (cancelled) return;
        setHome(ctx);
        setOrders(woList);

        if (ctx?.property_id == null) {
          setDocCount(0);
        } else {
          const count = await countPropertyDocuments(ctx.property_id);
          if (!cancelled) setDocCount(count);
        }

        // Rent is loaded separately so a ledger failure does not blank Home.
        if (ctx?.tenant_id != null) {
          void (async () => {
            try {
              const charges = await listChargesForTenantLeases(ctx.tenant_id);
              if (!cancelled) setRent(summarizeRent(charges));
            } catch {
              if (!cancelled) setRent(RENT_UNAVAILABLE);
            }
          })();
        }
      } catch (err) {
        if (!cancelled) {
          const message = (err as Error).message;
          setLoadError(message);
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getTenantHomeContext, listWorkOrders, setError, reloadKey]);

  const placeLabel = useMemo(
    () => unitPropertyLabel(home?.unit_label, home?.property_name),
    [home],
  );
  const propertyName = home?.property_name?.trim() || "Your home";
  const unitLabel = home?.unit_label?.trim() || null;
  const openCount = useMemo(() => orders.filter(isOpenRequest).length, [orders]);
  const hasUnit = home?.unit_id != null;

  // TODO(data-gap): No messages tables — preview via open request threads only.
  const messagesSummary =
    openCount === 0
      ? "Request conversations preview · no open requests yet."
      : openCount === 1
        ? "Request conversations preview · 1 open request thread."
        : `Request conversations preview · ${openCount} open request threads.`;

  // TODO(data-gap): No dedicated support-contact field — mock until Settings/staff proposal.
  const supportConfigured = false;

  // TODO(data-gap): Property manager not in home context join — unwired, not blank contact fields.
  const propertyManagerLabel = "Manager contact is not available in the portal yet.";

  const addressLabel = home?.property_address?.trim() || "Address not provided";

  const welcomeSub =
    hasUnit && home?.property_name
      ? undefined
      : "Your portal for rent, requests, and documents.";

  const maintenanceLabel =
    openCount === 0
      ? "No open requests"
      : openCount === 1
        ? "1 open request"
        : `${openCount} open requests`;

  const documentsSummary =
    docCount === 0
      ? "No documents shared for this property yet."
      : docCount === 1
        ? "1 document shared for this property."
        : `${docCount} documents shared for this property.`;

  return (
    <PageShell title="Home" meta={hasUnit ? placeLabel : "No unit linked"} width="max-w-6xl">
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading home">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : loadError ? (
        <ErrorRetry message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !hasUnit ? (
        <div className="rounded-lg border border-warning/30 bg-warning-tint px-4 py-4">
          <p className="text-sm font-semibold text-warning">No unit linked yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask your property manager to link your account to a unit. You can still open
            Documents once a property is available.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <header className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your space, at a glance
            </p>
            <h2 className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-foreground md:text-[2.125rem] md:leading-[2.625rem]">
              Welcome home.
            </h2>
            <p className="text-sm leading-[1.375rem] text-muted-foreground">
              <span className="lg:hidden">
                {welcomeSub ?? `Life at ${propertyName}, made simple.`}
              </span>
              <span className="hidden lg:inline">
                {welcomeSub ?? `Everything you need for life at ${propertyName}.`}
              </span>
            </p>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-start">
            <div className="space-y-6">
              <PropertyCard
                propertyName={propertyName}
                unitLabel={unitLabel}
                addressLabel={addressLabel}
                propertyManagerLabel={propertyManagerLabel}
              />

              <div className="grid gap-6 md:grid-cols-2 lg:hidden">
                <RentCard
                  rent={rent}
                  onPay={() => navigate("/payments")}
                  onLedger={() => navigate("/payments/ledger")}
                />
                <MaintenanceCard
                  label={maintenanceLabel}
                  onRequest={() => setSubmitOpen(true)}
                  stretch
                />
              </div>

              <UpdatesCard
                messagesSummary={messagesSummary}
                documentsSummary={documentsSummary}
                onMessages={() => navigate("/messages")}
                onDocuments={() => navigate("/documents")}
              />

              <div className="lg:hidden">
                <SupportCard configured={supportConfigured} />
              </div>

              <p className="hidden text-xs leading-[1.125rem] text-muted-foreground lg:block">
                Your unit. Your conversations. Your documents.
              </p>
            </div>

            <aside className="hidden space-y-6 lg:block">
              <RentCard
                rent={rent}
                onPay={() => navigate("/payments")}
                onLedger={() => navigate("/payments/ledger")}
              />
              <MaintenanceCard
                label={maintenanceLabel}
                onRequest={() => setSubmitOpen(true)}
              />
              <SupportCard configured={supportConfigured} />
            </aside>
          </div>
        </div>
      )}

      <TenantSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onSaved={() => {
          setSubmitOpen(false);
          setReloadKey((k) => k + 1);
        }}
      />
    </PageShell>
  );
}

function PropertyCard({
  propertyName,
  unitLabel,
  addressLabel,
  propertyManagerLabel,
}: {
  propertyName: string;
  unitLabel: string | null;
  addressLabel: string;
  propertyManagerLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative aspect-[1376/768] max-h-60 w-full overflow-hidden bg-muted md:max-h-[14.75rem]">
        <img src={illustrativePhoto} alt="" className="size-full object-cover" />
        <div className="absolute bottom-3 left-3 rounded-sm bg-card px-2.5 py-1.5">
          <p className="text-xs leading-[1.125rem] text-foreground">
            Illustrative photo · actual photo needed
          </p>
        </div>
      </div>
      <div className="space-y-3 px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your home
        </p>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-2xl font-semibold leading-8 text-foreground">{propertyName}</h3>
          {unitLabel ? (
            <span className="inline-flex h-7 items-center rounded-sm bg-muted px-2.5 text-xs text-foreground">
              {unitLabel.startsWith("Unit") ? unitLabel : `Unit ${unitLabel}`}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-[1.375rem] text-muted-foreground">{addressLabel}</p>
        <div className="border-t border-border pt-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <p className="text-sm font-medium leading-[1.375rem] text-foreground">
              Property manager
            </p>
            <p className="text-sm leading-[1.375rem] text-muted-foreground md:text-right">
              {propertyManagerLabel}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function RentCard({
  rent,
  onPay,
  onLedger,
}: {
  rent: RentSummary;
  onPay: () => void;
  onLedger: () => void;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-card px-5 py-5">
      <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">
        Rent &amp; payments
      </h3>
      <p className="mt-2 text-2xl font-semibold leading-8 text-foreground">{rent.balanceLabel}</p>
      <dl className="mt-3 space-y-1">
        <div className="flex justify-between gap-3 text-sm leading-[1.375rem]">
          <dt className="text-muted-foreground">Due date</dt>
          <dd className="font-medium text-foreground">{rent.dueLabel}</dd>
        </div>
        <div className="flex justify-between gap-3 text-sm leading-[1.375rem]">
          <dt className="text-muted-foreground">Payment status</dt>
          <dd className="font-medium text-foreground">
            {/* TODO(data-gap): No Stripe/Plaid/Zelle processors — ledger status when charges exist. */}
            {rent.hasCharges ? rent.statusLabel : "Not connected"}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex gap-2">
        <Button variant="brand" className="h-11 min-h-11 flex-1" onClick={onPay}>
          Pay rent · preview
        </Button>
        <Button variant="secondary" className="h-11 min-h-11 flex-1" onClick={onLedger}>
          View ledger
        </Button>
      </div>
      <p className="mt-3 text-xs leading-[1.125rem] text-muted-foreground">
        Demo views · no live payments.
      </p>
    </section>
  );
}

function MaintenanceCard({
  label,
  onRequest,
  stretch = false,
}: {
  label: string;
  onRequest: () => void;
  stretch?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-lg border border-border bg-card px-5 py-5",
        stretch && "md:min-h-[15.375rem]",
      )}
    >
      <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">Maintenance</h3>
      <p className="mt-2 text-sm leading-[1.375rem] text-muted-foreground">{label}</p>
      <div className={cn("mt-4", stretch && "md:mt-auto")}>
        <Button variant="brand" className="h-11 min-h-11 w-full" onClick={onRequest}>
          Request maintenance
        </Button>
      </div>
    </section>
  );
}

function UpdatesCard({
  messagesSummary,
  documentsSummary,
  onMessages,
  onDocuments,
}: {
  messagesSummary: string;
  documentsSummary: string;
  onMessages: () => void;
  onDocuments: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card px-5 py-5">
      <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">
        Your latest updates
      </h3>
      <div className="mt-4 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium leading-[1.375rem] text-foreground">Messages</p>
            <p className="text-sm leading-[1.375rem] text-muted-foreground">{messagesSummary}</p>
          </div>
          <Button
            variant="secondary"
            className="h-11 min-h-11 w-full shrink-0 md:w-[10.75rem]"
            onClick={onMessages}
          >
            Open messages
          </Button>
        </div>
        <div className="border-t border-border" />
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium leading-[1.375rem] text-foreground">
              Lease &amp; documents
            </p>
            <p className="text-sm leading-[1.375rem] text-muted-foreground">{documentsSummary}</p>
          </div>
          <Button
            variant="secondary"
            className="h-11 min-h-11 w-full shrink-0 md:w-[10.75rem]"
            onClick={onDocuments}
          >
            Open documents
          </Button>
        </div>
      </div>
    </section>
  );
}

function SupportCard({ configured }: { configured: boolean }) {
  return (
    <section className="rounded-lg border border-border bg-muted px-5 py-5">
      <h3 className="text-lg font-semibold leading-[1.625rem] text-foreground">
        A little help, when you need it.
      </h3>
      <div className="mt-4 space-y-1">
        <p className="text-sm font-medium leading-[1.375rem] text-foreground">
          Landlord Gopher support
        </p>
        {!configured ? (
          <p className="text-sm leading-[1.375rem] text-muted-foreground">
            Support contact not configured.
          </p>
        ) : null}
        <p className="pt-2 text-sm leading-[1.375rem] text-muted-foreground">
          Use Messages to reach an authorized contact when one is available.
        </p>
      </div>
    </section>
  );
}
