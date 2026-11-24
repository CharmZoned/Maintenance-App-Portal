import { useApp } from "@/context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { ListRow, PriorityChip, StatusChip } from "@/components/patterns";
import {
  landlordNextStep,
  priorityLevel,
  requestNextStep,
  statusLabel,
} from "@/lib/request-status";
import type { WorkOrder } from "@/types";
import { requestRowContext, splitRequests } from "./property-requests";

/**
 * Open and completed requests for a property or a unit, with the shared
 * status and priority words (LG-F). Each row opens `/maintenance/:id`.
 */
export function RequestGroups({
  orders,
  showPlace,
  navigate,
  emptyText,
}: {
  orders: readonly WorkOrder[];
  /** Show "Unit 1A" / "Common area" on each row (property page). */
  showPlace: boolean;
  navigate: (to: string) => void;
  emptyText: string;
}) {
  const { open, past } = splitRequests(orders);

  if (orders.length === 0) {
    return (
      <p className="rounded-md border border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <RequestGroup
        title="Open"
        orders={open}
        showPlace={showPlace}
        navigate={navigate}
        emptyText="No open requests right now."
      />
      {past.length > 0 ? (
        <RequestGroup title="Completed" orders={past} showPlace={showPlace} navigate={navigate} />
      ) : null}
    </div>
  );
}

function RequestGroup({
  title,
  orders,
  showPlace,
  navigate,
  emptyText,
}: {
  title: string;
  orders: WorkOrder[];
  showPlace: boolean;
  navigate: (to: string) => void;
  emptyText?: string;
}) {
  const app = useApp();
  const isPhone = useMediaQuery("(max-width: 639px)");
  const audience = app.isLandlord ? "landlord" : "staff";

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">({orders.length})</span>
      </h3>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card [&>*:last-child]:border-b-0">
          {orders.map((w) => {
            const priority = priorityLevel(w.priority);
            const next = app.isLandlord ? landlordNextStep(w).text : requestNextStep(w);
            const context = requestRowContext(w, { showPlace });
            return (
              <ListRow
                key={w.id}
                title={w.title}
                context={
                  next && isPhone ? (
                    <>
                      <span className="block truncate">{context}</span>
                      <span className="mt-1 block whitespace-normal">{next}</span>
                    </>
                  ) : (
                    context
                  )
                }
                priority={priority ? <PriorityChip level={priority} /> : null}
                status={
                  <StatusChip
                    status={statusLabel(w, audience)}
                    nextStep={next && !isPhone ? next : undefined}
                  />
                }
                onClick={() => navigate(`/maintenance/${w.id}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
