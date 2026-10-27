import { useMemo, useState } from "react";
import { Mail, Phone, Plus, Search, UserRound } from "lucide-react";
import { useApp } from "@/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TestDataBadge } from "@/components/test-data-badge";
import { PageShell } from "@/components/page-shell";
import { LandlordDialog } from "./landlord-dialog";
import type { Landlord } from "@/types";

export function LandlordsPage() {
  const { landlords } = useApp();
  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Landlord | undefined>(undefined);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return landlords;
    return landlords.filter((l) =>
      `${l.first_name} ${l.last_name} ${l.company_name ?? ""} ${l.email} ${l.mobile_phone ?? ""} ${l.source_id}`
        .toLowerCase()
        .includes(needle),
    );
  }, [landlords, q]);

  function openNew() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  return (
    <PageShell
      title="Landlords"
      meta={`${landlords.length} ${landlords.length === 1 ? "landlord" : "landlords"}`}
      actions={
        landlords.length > 0 ? (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New landlord
          </Button>
        ) : null
      }
      width="max-w-6xl"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, company, email, or phone"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <UserRound className="size-7 text-faint" aria-hidden />
          <p className="font-medium">{landlords.length === 0 ? "No landlords yet" : "No matches"}</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {landlords.length === 0
              ? "Every property belongs to a landlord. Add one to get started."
              : "Try a different search."}
          </p>
          {landlords.length === 0 && (
            <Button className="mt-2" onClick={openNew}>
              <Plus className="mr-1 h-4 w-4" /> New landlord
            </Button>
          )}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Mobile phone</TableHead>
                <TableHead>Preferred</TableHead>
                <TableHead className="text-right">Properties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow
                  key={l.id}
                  className="cursor-pointer"
                  onClick={() => { setEditing(l); setDialogOpen(true); }}
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {l.first_name} {l.last_name}
                      <TestDataBadge show={l.is_test_data} />
                    </span>
                  </TableCell>
                  <TableCell>{l.company_name || <Dash />}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Mail className="h-3 w-3" /> {l.email}
                    </span>
                  </TableCell>
                  <TableCell>
                    {l.mobile_phone ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="h-3 w-3" /> {l.mobile_phone}
                      </span>
                    ) : <Dash />}
                  </TableCell>
                  <TableCell>
                    {l.preferred_contact ? <Badge variant="neutral">{l.preferred_contact}</Badge> : <Dash />}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.property_count ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <LandlordDialog open={dialogOpen} onOpenChange={setDialogOpen} landlord={editing} />
    </PageShell>
  );
}

function Dash() {
  return <span className="text-xs text-muted-foreground">—</span>;
}
