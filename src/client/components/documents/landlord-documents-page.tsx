import { useEffect, useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { useApp } from "@/context";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import type { DocumentVisibility, PropertyDocument } from "@/types";

const VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  staff: "Staff",
  landlord: "Landlord",
  tenant: "Tenant",
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function LandlordDocumentsPage() {
  const { listPropertyDocuments, getPropertyDocumentDownloadUrl, setError } = useApp();
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // No property filter: RLS returns landlord- and tenant-visible docs on owned properties only.
        const list = await listPropertyDocuments();
        if (!cancelled) setDocs(list);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listPropertyDocuments, setError]);

  const groups = useMemo(() => {
    const map = new Map<string, PropertyDocument[]>();
    for (const doc of docs) {
      const key = doc.property_name?.trim() || `Property #${doc.property_id}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(doc);
      else map.set(key, [doc]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [docs]);

  async function downloadDoc(doc: PropertyDocument) {
    try {
      setDownloadingId(doc.id);
      const url = await getPropertyDocumentDownloadUrl(doc);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.rel = "noreferrer";
      a.target = "_blank";
      a.click();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <PageShell
      title="Documents"
      meta={
        loading
          ? undefined
          : `${docs.length} ${docs.length === 1 ? "document" : "documents"} · read-only`
      }
      width="max-w-3xl"
    >
      <p className="text-sm text-muted-foreground">
        Documents shared with you for properties you own. Upload and delete remain staff-only.
      </p>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading documents…</Card>
      ) : docs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No documents shared with landlords for your properties yet.
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([propertyName, propertyDocs]) => (
            <section key={propertyName}>
              <h2 className="mb-2 text-sm font-medium text-foreground">{propertyName}</h2>
              <Card className="divide-y">
                {propertyDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{doc.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[
                            doc.file_name,
                            doc.unit_name ? `Unit ${doc.unit_name}` : "Whole property",
                            formatBytes(doc.byte_size),
                            formatDate(doc.created_at),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="neutral">{VISIBILITY_LABEL[doc.visibility]}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloadingId === doc.id}
                        onClick={() => void downloadDoc(doc)}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
