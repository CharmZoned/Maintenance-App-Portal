import { useMemo, useState } from "react";
import { HardHat, Search, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import type { OfficeContact } from "@/lib/office-messages";

/**
 * Admin "New message": pick a landlord or worker to open (or start) their
 * conversation with the office.
 */
export function OfficeContactPicker({
  open,
  onOpenChange,
  contacts,
  loading,
  error,
  onRetry,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: OfficeContact[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPick: (contact: OfficeContact) => void;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: OfficeContact) =>
      !q || c.name.toLowerCase().includes(q) || (c.detail ?? "").toLowerCase().includes(q);
    return [
      { key: "landlord", heading: "Landlords", rows: contacts.filter((c) => c.role === "landlord" && match(c)) },
      { key: "maintenance", heading: "Workers", rows: contacts.filter((c) => c.role === "maintenance" && match(c)) },
    ];
  }, [contacts, query]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Choose a landlord or worker to message from the Landlord Gopher office.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search landlords and workers"
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="-mx-5 max-h-[50vh] overflow-auto border-t border-border">
          {loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : error ? (
            <ErrorRetry className="m-4" message={`We couldn't load people. ${error}`} onRetry={onRetry} />
          ) : total === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              {query.trim() ? "No one matches that search." : "No landlords or workers have a portal login yet."}
            </p>
          ) : (
            groups.map((g) =>
              g.rows.length ? (
                <div key={g.key}>
                  <p className="bg-muted/50 px-5 py-1.5 text-xs font-medium text-muted-foreground">{g.heading}</p>
                  {g.rows.map((c) => (
                    <button
                      key={c.userId}
                      type="button"
                      onClick={() => onPick(c)}
                      className="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        {c.role === "maintenance" ? (
                          <HardHat className="size-4" aria-hidden />
                        ) : (
                          <UserRound className="size-4" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                        {c.detail ? (
                          <span className="block truncate text-[13px] text-muted-foreground">{c.detail}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null,
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
