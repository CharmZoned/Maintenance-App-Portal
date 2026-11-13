import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import { LandlordDialog } from "./landlord-dialog";
import type { Landlord } from "@/types";

export function LandlordsPage() {
  const { landlords, canMutatePortfolio } = useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Landlord | undefined>(undefined);

  return (
    <PageShell
      title="Landlords"
      meta={`${landlords.length} ${landlords.length === 1 ? "landlord" : "landlords"}`}
      actions={
        canMutatePortfolio ? (
          <Button
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New landlord
          </Button>
        ) : null
      }
    >
      {landlords.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <Users className="size-8 text-faint" aria-hidden />
          <p className="font-medium">No landlords yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create a landlord before adding properties — every property requires a landlord.
          </p>
          <Button
            className="mt-2"
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New landlord
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {landlords.map((l) => (
            <Card
              key={l.id}
              className="cursor-pointer p-4 transition hover:border-emerald-300"
              onClick={() => {
                if (!canMutatePortfolio) return;
                setEditing(l);
                setOpen(true);
              }}
            >
              <p className="font-medium">
                {l.company_name?.trim() || `${l.first_name} ${l.last_name}`}
              </p>
              {l.company_name && (
                <p className="text-sm text-muted-foreground">
                  {l.first_name} {l.last_name}
                </p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">{l.email}</p>
              {l.phone && <p className="text-sm text-muted-foreground">{l.phone}</p>}
            </Card>
          ))}
        </div>
      )}

      <LandlordDialog open={open} onOpenChange={setOpen} landlord={editing} />
    </PageShell>
  );
}
