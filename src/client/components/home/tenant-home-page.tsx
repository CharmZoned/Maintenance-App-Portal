import { useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import {
  EmptyState,
  ErrorRetry,
  ListRow,
  SkeletonRow,
  StatusChip,
} from "@/components/patterns";
import { TenantSubmitDialog } from "@/components/maintenance/tenant-submit-dialog";
import {
  formatActivityStamp,
  isOpenRequest,
  requestContextLine,
  requestNextStep,
  toRequestStatus,
  unitPropertyLabel,
} from "@/lib/request-status";
import { formatDate } from "@/lib/utils";
import type { PropertyDocument, TenantHomeContext, WorkOrder } from "@/types";

/**
 * Tenant N1 Home — unit card, Report a problem, open requests, stub latest
 * message, recent documents (Figma 04 Homes).
 */
export function TenantHomePage({ navigate }: { navigate: (to: string) => void }) {
  const {
    getTenantHomeContext,
    listWorkOrders,
    listPropertyDocuments,
    setError,
  } = useApp();
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // Context + open WOs in parallel; documents wait on property_id.
        const [ctx, woList] = await Promise.all([
          getTenantHomeContext(),
          listWorkOrders({ open_only: true, skip_staff_notes: true }),
        ]);
        if (cancelled) return;
        setHome(ctx);
        setOrders(woList);
        if (ctx?.property_id == null) {
          setDocs([]);
        } else {
          const docList = await listPropertyDocuments({
            property_id: ctx.property_id,
            limit: 3,
          });
          if (!cancelled) setDocs(docList);
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
  }, [getTenantHomeContext, listWorkOrders, listPropertyDocuments, setError, reloadKey]);

  const placeLabel = useMemo(
    () => unitPropertyLabel(home?.unit_label, home?.property_name),
    [home],
  );

  const openAll = useMemo(() => orders.filter(isOpenRequest), [orders]);
  const openOrders = openAll.slice(0, 5);

  const lastActivity = useMemo(() => {
    const stamps = orders
      .map((o) => o.created_at)
      .filter(Boolean)
      .sort((a, b) => (a === b ? 0 : a < b ? 1 : -1));
    return stamps[0] ? formatActivityStamp(stamps[0]) : null;
  }, [orders]);

  const recentDocs = docs.slice(0, 3);
  const hasUnit = home?.unit_id != null;

  return (
    <PageShell
      title="Home"
      meta={hasUnit ? placeLabel : "No unit linked"}
      actions={
        hasUnit ? (
          <Button variant="brand" size="header" onClick={() => setSubmitOpen(true)}>
            Report a problem
          </Button>
        ) : null
      }
      width="max-w-3xl"
    >
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading home">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : loadError ? (
        <ErrorRetry
          message={loadError}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : !hasUnit ? (
        <div className="rounded-md border border-warning/30 bg-warning-tint px-4 py-4">
          <p className="text-sm font-semibold text-warning">No unit linked yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask your property manager to link your account to a unit. You can still
            open Documents once a property is available.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-md bg-muted px-3 py-3">
            <p className="text-[15px] font-semibold leading-5 text-foreground">{placeLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {openAll.length} open{" "}
              {openAll.length === 1 ? "request" : "requests"}
              {lastActivity ? ` · Last activity ${lastActivity}` : ""}
            </p>
          </div>

          <Button
            className="h-11 w-full text-sm"
            onClick={() => setSubmitOpen(true)}
          >
            Report a problem
          </Button>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Open requests
            </h2>
            {openAll.length === 0 ? (
              <EmptyState
                message="No open requests. Report a problem if something needs fixing."
                icon={<Wrench className="size-5" aria-hidden />}
                actionLabel="Report a problem"
                onAction={() => setSubmitOpen(true)}
              />
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                {openOrders.map((wo) => (
                  <ListRow
                    key={wo.id}
                    title={wo.title}
                    context={requestContextLine(wo, {
                      includeProperty: false,
                    })}
                    status={
                      <StatusChip
                        status={toRequestStatus(wo)}
                        nextStep={requestNextStep(wo)}
                      />
                    }
                    onClick={() => navigate(`/maintenance?wo=${wo.id}`)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Latest message
            </h2>
            {/* Messaging UI ships in Messages/People group. */}
            <button
              type="button"
              onClick={() => navigate("/messages")}
              className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground">Messages</p>
                <p className="text-xs text-muted-foreground">
                  No new messages. Messages will show up here.
                </p>
              </div>
            </button>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Documents
            </h2>
            {recentDocs.length === 0 ? (
              <EmptyState
                message="No documents shared for this property yet."
                actionLabel="Open documents"
                onAction={() => navigate("/documents")}
              />
            ) : (
              <div className="space-y-2">
                {recentDocs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => navigate("/documents")}
                    className="flex w-full flex-col gap-0.5 rounded-sm border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {doc.file_name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Shared
                      {doc.created_at ? ` · ${formatDate(doc.created_at, { day: "numeric", month: "short" })}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
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
