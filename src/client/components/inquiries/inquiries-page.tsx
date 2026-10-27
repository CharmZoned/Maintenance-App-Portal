import { useEffect, useMemo, useState } from "react";
import { Inbox, Mail, Phone } from "lucide-react";
import { useApp } from "@/context";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageShell } from "@/components/page-shell";
import type { Inquiry } from "@/types";

const DEFAULT_STATUSES = ["new", "contacted", "scheduled", "closed"];

function statusVariant(status: string): "info" | "warning" | "success" | "neutral" {
  switch (status.toLowerCase()) {
    case "new": return "info";
    case "contacted": return "warning";
    case "closed": return "neutral";
    case "scheduled":
    case "converted": return "success";
    default: return "neutral";
  }
}

export function InquiriesPage() {
  const app = useApp();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setInquiries(await app.listInquiries());
      } catch (err) {
        app.setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statuses = useMemo(() => {
    const set = new Set(DEFAULT_STATUSES);
    for (const i of inquiries) if (i.status) set.add(i.status);
    return [...set];
  }, [inquiries]);

  async function changeStatus(inquiry: Inquiry, status: string) {
    if (status === inquiry.status) return;
    setUpdating(inquiry.id);
    try {
      const updated = await app.updateInquiryStatus(inquiry.id, status);
      setInquiries((prev) => prev.map((i) => (i.id === inquiry.id ? { ...i, ...updated } : i)));
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setUpdating(null);
    }
  }

  const openCount = inquiries.filter((i) => i.status.toLowerCase() === "new").length;

  return (
    <PageShell
      title="Inquiries"
      meta={`${inquiries.length} ${inquiries.length === 1 ? "inquiry" : "inquiries"}${openCount ? ` · ${openCount} new` : ""}`}
      width="max-w-6xl"
    >
      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : inquiries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <Inbox className="size-7 text-faint" aria-hidden />
          <p className="font-medium">No inquiries yet</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Website and referral inquiries show up here.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="w-44">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inquiries.map((i) => (
                <TableRow key={i.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(i.created_at)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {[i.first_name, i.last_name].filter(Boolean).join(" ")}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5 text-sm text-muted-foreground">
                      <div className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {i.email}</div>
                      {i.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> {i.phone}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-sm">
                      <Badge variant="neutral">{i.source}</Badge>
                      {i.referral_source && (
                        <div className="text-xs text-muted-foreground">Referral: {i.referral_source}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-sm whitespace-pre-wrap text-sm text-muted-foreground">
                    {i.message || "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={i.status}
                      onValueChange={(v) => changeStatus(i, v)}
                      disabled={updating === i.id}
                    >
                      <SelectTrigger aria-label={`Status for ${i.first_name}`}>
                        <SelectValue>
                          <Badge variant={statusVariant(i.status)} className="capitalize">{i.status}</Badge>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {statuses.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageShell>
  );
}
