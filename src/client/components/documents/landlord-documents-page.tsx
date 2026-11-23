import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { PageShell } from "@/components/page-shell";
import { ErrorRetry, SkeletonRow } from "@/components/patterns";
import {
  LandlordDocumentRow,
  LandlordPageIntro,
  LandlordPropertyHeading,
  LandlordScopeHeading,
} from "@/components/landlord";
import {
  groupLandlordDocuments,
  landlordDocumentRowModel,
} from "@/lib/landlord-documents";
import { cn } from "@/lib/utils";
import type { PropertyDocument } from "@/types";

/**
 * Landlord Documents (Figma `2037:487` and the documents frames on `2036:467`).
 *
 * Read-only. Download is the only file action. "Shared with me" hides rows
 * uploaded with role `landlord`. "I shared" stays off this screen until
 * landlords can upload — that insert is staff-only today, so the tab would
 * stay empty and read as if sharing already worked.
 */

const EYEBROW = "Your property records";
const TITLE = "Documents";
const DESCRIPTION = "Keep every lease, notice and shared document in one place.";

const SHARE_FILTERS = [
  { id: "all", label: "All" },
  { id: "with-me", label: "Shared with me" },
] as const;

type ShareFilter = (typeof SHARE_FILTERS)[number]["id"];

const ALL_PROPERTIES = "all";

function sharedByLandlord(doc: PropertyDocument): boolean {
  return doc.uploaded_by_role === "landlord";
}

function byCreatedAsc(a: PropertyDocument, b: PropertyDocument): number {
  const byDate = a.created_at.localeCompare(b.created_at);
  return byDate !== 0 ? byDate : a.id - b.id;
}

function filteredEmptyMessage(share: ShareFilter, propertyName: string | null): string {
  if (share === "with-me") {
    return propertyName
      ? `Nothing has been shared with you for ${propertyName} yet. Try another tab or property.`
      : "Nothing has been shared with you yet. Try another tab or property.";
  }
  return propertyName
    ? `No documents for ${propertyName} yet. Try another property.`
    : "No documents match these filters. Try another tab or property.";
}

export function LandlordDocumentsPage() {
  const { listPropertyDocuments, getPropertyDocumentDownloadUrl, setError, properties } = useApp();
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [share, setShare] = useState<ShareFilter>("all");
  const [propertyId, setPropertyId] = useState(ALL_PROPERTIES);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setLoadFailed(false);
        // No property filter on the query: RLS returns landlord- and tenant-visible docs.
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

  const propertyOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const property of properties) {
      byId.set(property.id, property.name?.trim() || `Property #${property.id}`);
    }
    for (const doc of docs) {
      if (!byId.has(doc.property_id)) {
        byId.set(doc.property_id, doc.property_name?.trim() || `Property #${doc.property_id}`);
      }
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }, [properties, docs]);

  useEffect(() => {
    if (propertyId === ALL_PROPERTIES) return;
    const known = propertyOptions.some((property) => String(property.id) === propertyId);
    if (!known) setPropertyId(ALL_PROPERTIES);
  }, [propertyId, propertyOptions]);

  const selectedPropertyName =
    propertyId === ALL_PROPERTIES
      ? null
      : (propertyOptions.find((property) => String(property.id) === propertyId)?.name ?? null);

  const filtersActive = share !== "all" || propertyId !== ALL_PROPERTIES;

  const sections = useMemo(() => {
    const filtered = docs.filter((doc) => {
      if (propertyId !== ALL_PROPERTIES && String(doc.property_id) !== propertyId) return false;
      if (share === "with-me") return !sharedByLandlord(doc);
      return true;
    });
    // Frames list the older file above the newer one inside a scope group.
    return groupLandlordDocuments([...filtered].sort(byCreatedAsc));
  }, [docs, propertyId, share]);

  const visibleCount = sections.reduce(
    (sum, section) => sum + section.groups.reduce((n, group) => n + group.documents.length, 0),
    0,
  );

  function clearFilters() {
    setShare("all");
    setPropertyId(ALL_PROPERTIES);
  }

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
    <PageShell title={TITLE} width="max-w-6xl">
      <div className="flex flex-col gap-9">
        <div className="flex flex-col gap-7">
          <LandlordPageIntro eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} />

          <div className="flex flex-col gap-4">
            <div role="group" aria-label="Which documents" className="flex flex-wrap gap-1">
              {SHARE_FILTERS.map((filter) => {
                const active = share === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setShare(filter.id)}
                    className={cn(
                      "inline-flex h-11 items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      active
                        ? "bg-brand-tint text-brand-text"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>

            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="h-11 w-full text-sm font-medium shadow-raised md:w-[272px]">
                <span className="truncate">
                  Property: {selectedPropertyName ?? "All properties"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROPERTIES}>All properties</SelectItem>
                {propertyOptions.map((property) => (
                  <SelectItem key={property.id} value={String(property.id)}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            <p className="lg-body text-muted-foreground">Loading documents…</p>
            <div className="space-y-2.5">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          </div>
        ) : loadFailed ? (
          <ErrorRetry
            message="Documents could not load. Please try again."
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        ) : visibleCount === 0 && !filtersActive ? (
          <p className="px-6 py-10 text-center lg-body text-muted-foreground">
            No documents yet. Share a lease, notice or other file to get started.
          </p>
        ) : visibleCount === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="max-w-md lg-body text-muted-foreground">
              {filteredEmptyMessage(share, selectedPropertyName)}
            </p>
            <Button type="button" variant="secondary" size="touch" onClick={clearFilters}>
              Clear filter
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-9">
            {sections.map((section) => (
              <section key={section.propertyId} className="flex flex-col gap-3">
                <LandlordPropertyHeading name={section.propertyName} />
                {section.groups.map((group) => (
                  <div key={group.key} className="flex flex-col gap-3">
                    <LandlordScopeHeading label={group.label} />
                    <div className="flex flex-col gap-3">
                      {group.documents.map((doc) => (
                        <LandlordDocumentRow
                          key={doc.id}
                          model={landlordDocumentRowModel(doc)}
                          onDownload={() => void downloadDoc(doc)}
                          downloading={downloadingId === doc.id}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
