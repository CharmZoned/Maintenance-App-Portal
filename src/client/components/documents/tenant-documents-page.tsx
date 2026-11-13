import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { useApp } from "@/context";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import type { PropertyDocument, TenantHomeContext } from "@/types";

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function TenantDocumentsPage() {
  const app = useApp();
  const { getTenantHomeContext, listPropertyDocuments, getPropertyDocumentDownloadUrl, setError } =
    app;
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const ctx = await getTenantHomeContext();
        if (cancelled) return;
        if (!ctx) {
          setHome(null);
          setDocs([]);
          return;
        }
        setHome(ctx);
        if (ctx.property_id == null) {
          setDocs([]);
          return;
        }
        const list = await listPropertyDocuments({ property_id: ctx.property_id });
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
  }, [getTenantHomeContext, listPropertyDocuments, setError]);

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

  const subtitle = home
    ? [home.unit_label ? `Unit ${home.unit_label}` : null, home.property_name]
        .filter(Boolean)
        .join(" · ") || "Your home"
    : null;

  return (
    <PageShell title="Documents" width="max-w-3xl">
      {subtitle && (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      )}

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading documents…</Card>
      ) : !home ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Could not load your tenant profile.
        </Card>
      ) : home.property_id == null ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No unit is linked to your account yet, so property documents are unavailable.
        </Card>
      ) : docs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No documents shared with tenants for this property yet.
        </Card>
      ) : (
        <Card className="divide-y">
          {docs.map((doc) => (
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
          ))}
        </Card>
      )}
    </PageShell>
  );
}
