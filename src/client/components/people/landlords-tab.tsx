import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorRetry, SkeletonRow } from "@/components/patterns";
import { listLandlordsWithPortfolio, officeThreadHref, type LandlordPortfolio } from "@/lib/landlord-portfolio";
import { LandlordRow, LandlordTableHeader } from "./landlord-row";

type LoadState = "loading" | "ready" | "error";

/**
 * People → Landlords (admin). Loads its own portfolio view so the rest of the
 * People page keeps its existing reads. `reloadKey` changes after a landlord
 * is added or edited so the list refreshes without a skeleton flash.
 */
export function LandlordsTab({
  navigate,
  onAdd,
  onEdit,
  reloadKey = 0,
}: {
  navigate: (to: string) => void;
  /** Present when the viewer may add landlords. */
  onAdd?: () => void;
  /** Present when the viewer may edit landlords. */
  onEdit?: (landlordId: number) => void;
  reloadKey?: number;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LandlordPortfolio[]>([]);

  const load = useCallback(async (keepRows: boolean) => {
    if (!keepRows) setState("loading");
    setError(null);
    try {
      const list = await listLandlordsWithPortfolio();
      setRows(list);
      setState("ready");
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load(reloadKey > 0);
  }, [load, reloadKey]);

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Properties, units, open requests and portal status for each landlord.
      </p>
      {state === "loading" ? (
        <div className="overflow-hidden rounded-md border border-border" aria-busy="true">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : state === "error" ? (
        <ErrorRetry
          message={
            error
              ? `We couldn't load landlords. ${error}`
              : "We couldn't load landlords. Check your connection and try again."
          }
          onRetry={() => void load(false)}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          message="No landlords yet. Create a landlord before adding properties."
          actionLabel={onAdd ? "Add landlord" : undefined}
          onAction={onAdd}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <LandlordTableHeader />
          {rows.map((l) => (
            <LandlordRow
              key={l.id}
              landlord={l}
              onEdit={onEdit ? () => onEdit(l.id) : undefined}
              onMessage={(userId) => navigate(officeThreadHref(userId))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
