import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import { useApp } from "@/context";
import { BalanceSummaryCard } from "./balance-summary-card";
import {
  loadTenantPaymentsSnapshot,
  type TenantPaymentsSnapshot,
} from "./load-tenant-payments";
import { PayRentView } from "./pay-rent-view";
import { PaymentLedgerView } from "./payment-ledger-view";
import {
  PaymentsBackLink,
  PaymentsTabToggle,
  PaymentsTestBanner,
} from "./payments-chrome";
import {
  buildBalanceSummary,
  ledgerPlaceLine,
  placeContextLine,
} from "./payments-model";

export function PaymentsPage({
  mode,
  navigate,
}: {
  mode: "pay" | "ledger";
  navigate: (to: string) => void;
}) {
  const { setError } = useApp();
  const [snapshot, setSnapshot] = useState<TenantPaymentsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // Pay rent: charges + summary only. Ledger: batch-load Payments once.
        const data = await loadTenantPaymentsSnapshot({
          includeLedger: mode === "ledger",
        });
        if (!cancelled) setSnapshot(data);
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
  }, [setError, reloadKey, mode]);

  const title = mode === "pay" ? "Pay rent" : "Payment ledger";
  const meta = snapshot
    ? mode === "pay"
      ? placeContextLine(snapshot.profile)
      : ledgerPlaceLine(snapshot.profile)
    : "Unit account";

  return (
    <PageShell title="Payments" meta="Home / Payments" width="max-w-6xl">
      <div className="space-y-5">
        <PaymentsBackLink onBack={() => navigate("/home")} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[2.125rem] font-semibold leading-[2.625rem] tracking-[-0.02em] text-foreground">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
          </div>
          <PaymentsTestBanner className="sm:mt-2" />
        </div>

        <PaymentsTabToggle
          active={mode}
          onPay={() => navigate("/payments")}
          onLedger={() => navigate("/payments/ledger")}
        />

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading payments">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : loadError ? (
          <ErrorRetry
            message={loadError}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        ) : snapshot ? (
          mode === "pay" ? (
            <PayRentView
              profile={snapshot.profile}
              summary={snapshot.summary}
              onViewLedger={() => navigate("/payments/ledger")}
            />
          ) : (
            <PaymentLedgerView summary={snapshot.summary} ledger={snapshot.ledger} />
          )
        ) : (
          <BalanceSummaryCard
            summary={buildBalanceSummary([], null)}
          />
        )}
      </div>
    </PageShell>
  );
}
