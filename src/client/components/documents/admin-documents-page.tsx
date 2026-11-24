import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { useApp } from "@/context";
import { PageShell } from "@/components/page-shell";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  AdminButton,
  DashboardCard,
  navProps,
} from "@/components/dashboard/dashboard-primitives";
import { cn, formatDate } from "@/lib/utils";
import type { DocumentVisibility, PropertyDocument } from "@/types";
import { AdminUploadDocumentDialog } from "./admin-upload-document-dialog";

/**
 * Admin Documents: every file across the portfolio, grouped by property, with
 * a property filter, download and upload. Sharing changes and deletes stay on
 * each property's page (Properties → property → Documents), which every group
 * links to — this page only lists, downloads and adds.
 */

const ALL_PROPERTIES = "all";

const VISIBILITY: Record<DocumentVisibility, { label: string; className: string }> = {
  staff: { label: "Staff only", className: "bg-muted text-muted-foreground" },
  landlord: { label: "Landlord can see", className: "bg-brand-tint text-brand-text" },
  tenant: { label: "Tenant can see", className: "bg-success-tint text-success" },
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function unitWord(label: string): string {
  return /^unit\b/i.test(label.trim()) ? label.trim() : `Unit ${label.trim()}`;
}

interface PropertyGroup {
  propertyId: number;
  name: string;
  documents: PropertyDocument[];
}

export function AdminDocumentsPage({ navigate }: { navigate: (to: string) => void }) {
  const { listPropertyDocuments, getPropertyDocumentDownloadUrl, setError, setNotice, properties } =
    useApp();
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [propertyId, setPropertyId] = useState(ALL_PROPERTIES);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setLoadFailed(false);
        const list = await listPropertyDocuments();
        if (!cancelled) setDocs(list);
      } catch (err) {
        if (!cancelled) {
          setLoadFailed(true);
          setDocs([]);
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listPropertyDocuments, setError, reloadKey]);

  const propertyName = useMemo(() => {
    const byId = new Map<number, string>();
    for (const p of properties) byId.set(p.id, p.name?.trim() || `Property #${p.id}`);
    for (const d of docs) {
      if (!byId.has(d.property_id)) {
        byId.set(d.property_id, d.property_name?.trim() || `Property #${d.property_id}`);
      }
    }
    return byId;
  }, [properties, docs]);

  const propertyOptions = useMemo(
    () =>
      [...propertyName.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    [propertyName],
  );

  const groups = useMemo<PropertyGroup[]>(() => {
    const byProperty = new Map<number, PropertyDocument[]>();
    for (const doc of docs) {
      if (propertyId !== ALL_PROPERTIES && String(doc.property_id) !== propertyId) continue;
      const list = byProperty.get(doc.property_id) ?? [];
      list.push(doc);
      byProperty.set(doc.property_id, list);
    }
    return [...byProperty.entries()]
      .map(([id, documents]) => ({
        propertyId: id,
        name: propertyName.get(id) ?? `Property #${id}`,
        // Newest first, as the data layer returns them.
        documents,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.propertyId - b.propertyId);
  }, [docs, propertyId, propertyName]);

  const selectedName =
    propertyId === ALL_PROPERTIES ? null : (propertyName.get(Number(propertyId)) ?? null);
  const propertyCount = new Set(docs.map((d) => d.property_id)).size;
  const meta =
    loading || docs.length === 0
      ? "Leases, notices and files across your portfolio"
      : `${plural(docs.length, "file")} across ${plural(propertyCount, "property", "properties")}`;

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

  const uploadButton = (
    <AdminButton
      variant="default"
      onClick={() => setUploadOpen(true)}
      disabled={properties.length === 0}
    >
      <Upload aria-hidden />
      Upload document
    </AdminButton>
  );

  return (
    <PageShell title="Documents" meta={meta} actions={uploadButton}>
      {loading ? (
        <div className="space-y-2.5" aria-busy="true" aria-live="polite">
          <p className="lg-body text-muted-foreground">Loading documents…</p>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : loadFailed ? (
        <ErrorRetry
          message="Documents could not load. Please try again."
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : docs.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-md border border-border bg-card px-6 py-10 text-center">
          <div className="flex size-11 items-center justify-center rounded-sm bg-brand-tint text-brand-text">
            <FileText aria-hidden size={20} strokeWidth={2} absoluteStrokeWidth />
          </div>
          <p className="lg-section text-foreground">No documents yet</p>
          <p className="lg-body max-w-md text-muted-foreground">
            Upload a lease, notice or inspection report and choose whether the landlord or tenant
            can see it.
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger
                aria-label="Filter by property"
                className="h-11 w-full bg-card text-sm font-medium sm:w-[272px]"
              >
                <span className="truncate">Property: {selectedName ?? "All properties"}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROPERTIES}>All properties</SelectItem>
                {propertyOptions.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="lg-caption text-muted-foreground">
              To change who can see a file or delete it, open its property.
            </p>
          </div>

          {groups.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-md border border-border bg-card p-4">
              <p className="lg-body text-muted-foreground">
                No documents for {selectedName ?? "this property"} yet.
              </p>
              <Button variant="secondary" size="touch" onClick={() => setPropertyId(ALL_PROPERTIES)}>
                Show all properties
              </Button>
            </div>
          ) : (
            groups.map((group) => (
              <DashboardCard
                key={group.propertyId}
                title={group.name}
                summary={plural(group.documents.length, "file")}
                actions={
                  <AdminButton asChild>
                    <a {...navProps(`/properties/${group.propertyId}`, navigate)}>Open property</a>
                  </AdminButton>
                }
              >
                <ul className="flex flex-col divide-y divide-border">
                  {group.documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      downloading={downloadingId === doc.id}
                      onDownload={() => void downloadDoc(doc)}
                    />
                  ))}
                </ul>
              </DashboardCard>
            ))
          )}
        </>
      )}

      <AdminUploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        defaultPropertyId={propertyId === ALL_PROPERTIES ? null : Number(propertyId)}
        onUploaded={(doc) => {
          setDocs((prev) => [doc, ...prev]);
          setNotice("Document uploaded.");
        }}
      />
    </PageShell>
  );
}

function DocumentRow({
  doc,
  downloading,
  onDownload,
}: {
  doc: PropertyDocument;
  downloading: boolean;
  onDownload: () => void;
}) {
  const visibility = VISIBILITY[doc.visibility] ?? VISIBILITY.staff;
  const details = [
    doc.unit_name ? unitWord(doc.unit_name) : "Whole property",
    doc.file_name,
    formatBytes(doc.byte_size),
    `Added ${formatDate(doc.created_at)}`,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 @lg:flex-row @lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <FileText
          aria-hidden
          size={20}
          strokeWidth={2}
          absoluteStrokeWidth
          className="mt-px shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-col">
          <p className="lg-body-medium break-words text-foreground">{doc.title}</p>
          <p className="lg-caption break-words text-muted-foreground">{details.join(" · ")}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pl-8 @lg:pl-0">
        <span
          className={cn(
            "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium",
            visibility.className,
          )}
        >
          {visibility.label}
        </span>
        <AdminButton
          onClick={onDownload}
          disabled={downloading}
          aria-label={`Download ${doc.title}`}
        >
          <Download aria-hidden />
          {downloading ? "Downloading…" : "Download"}
        </AdminButton>
      </div>
    </li>
  );
}
