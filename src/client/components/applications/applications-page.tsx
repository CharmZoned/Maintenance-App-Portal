import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import * as data from "@/lib/data";
import { useApp } from "@/context";
import { queryId } from "@/lib/deep-link";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ApplicationDialog } from "./application-dialog";
import type { Application, ApplicationStatus, Unit } from "@/types";

type StatusFilter = ApplicationStatus | "all";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "screening", label: "Screening" },
  { id: "approved", label: "Approved" },
  { id: "declined", label: "Declined" },
  { id: "withdrawn", label: "Withdrawn" },
];

export function ApplicationsPage({
  search = "",
  replace,
}: {
  search?: string;
  replace?: (to: string) => void;
} = {}) {
  const { setError, isAdmin } = useApp();
  const [rows, setRows] = useState<Application[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Application | undefined>(undefined);

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const list = await data.listApplications("all");
      setRows(list);
      return list;
    } catch (err) {
      setError((err as Error).message);
      return [] as Application[];
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void loadApps();
    void (async () => {
      try {
        setUnits(await data.listUnits());
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [loadApps, setError]);

  useEffect(() => {
    const appId = queryId(search, "app");
    if (appId == null) return;
    let cancelled = false;
    (async () => {
      const list = rows.length ? rows : await loadApps();
      if (cancelled) return;
      const found = list.find((a) => a.id === appId);
      if (found) {
        setEditing(found);
        setOpen(true);
      }
      replace?.("/applications");
    })();
    return () => {
      cancelled = true;
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  return (
    <PageShell
      title="Rental applications"
      meta="Applicant pipeline — separate from account approval (Users)"
      actions={
        <Button
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New application
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Track rental applicants for units. Portal login approval is on the{" "}
        <span className="font-medium text-foreground">Users</span> page.
      </p>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading applications…</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <ClipboardList className="size-8 text-faint" aria-hidden />
          <p className="font-medium">
            {rows.length === 0 ? "No rental applications yet" : "No applications in this filter"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create an applicant record when someone applies for a unit. This is not the account
            approval queue.
          </p>
          {rows.length === 0 && (
            <Button
              className="mt-2"
              onClick={() => {
                setEditing(undefined);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New application
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((a) => (
            <Card
              key={a.id}
              className="cursor-pointer space-y-2 p-4 transition hover:border-emerald-300"
              onClick={() => {
                setEditing(a);
                setOpen(true);
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">
                  {a.first_name} {a.last_name}
                </p>
                <Badge variant="secondary">{a.status}</Badge>
              </div>
              {(a.property_name || a.unit_name) && (
                <p className="text-sm text-muted-foreground">
                  {[a.property_name, a.unit_name].filter(Boolean).join(" · ")}
                </p>
              )}
              {a.email && <p className="text-sm text-muted-foreground">{a.email}</p>}
              {a.phone && <p className="text-sm text-muted-foreground">{a.phone}</p>}
              {a.desired_move_in && (
                <p className="text-xs text-muted-foreground">Move-in: {a.desired_move_in}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      <ApplicationDialog
        open={open}
        onOpenChange={setOpen}
        application={editing}
        units={units}
        canDelete={isAdmin}
        onSaved={() => void loadApps()}
      />
    </PageShell>
  );
}
