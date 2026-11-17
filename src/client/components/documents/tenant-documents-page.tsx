import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { useApp } from "@/context";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import {
  EmptyState,
  ErrorRetry,
  SkeletonRow,
} from "@/components/patterns";
import type { PropertyDocument, TenantHomeContext } from "@/types";

/**
 * Tenant Documents — Figma M `2010:4805` · T `2024:2296` · D `2024:1917`.
 * Live: PropertyDocuments visibility=tenant list + signed download.
 * Mock/TODO(data-gap): in-app preview, category enum, e-sign.
 */

type DocCategory = "leases" | "addenda" | "notices" | "other";

type CategorizedDoc = { doc: PropertyDocument; category: DocCategory };

const CATEGORY_FILTERS: { id: "all" | DocCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "leases", label: "Leases" },
  { id: "addenda", label: "Addenda" },
  { id: "notices", label: "Notices" },
  { id: "other", label: "Other" },
];

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploaded(iso: string): string {
  const short = formatDate(iso, { day: "numeric", month: "short" });
  return short ? `Uploaded ${short}` : "";
}

function fileKindLabel(doc: PropertyDocument): string {
  const mime = (doc.content_type || "").toLowerCase();
  const name = (doc.file_name || "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (mime.includes("word") || name.endsWith(".doc") || name.endsWith(".docx")) return "DOC";
  if (mime.includes("sheet") || name.endsWith(".xls") || name.endsWith(".xlsx")) return "XLS";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return "IMG";
  return "FILE";
}

/**
 * TODO(data-gap): PropertyDocuments has no category enum. Heuristic from
 * title/file_name until a dedicated column or check constraint exists.
 * Addenda / amendments are checked before generic "lease" so "Lease addendum"
 * lands in Addenda.
 */
function inferDocCategory(doc: PropertyDocument): DocCategory {
  const hay = `${doc.title} ${doc.file_name} ${doc.notes ?? ""}`.toLowerCase();
  if (/\b(addendum|addenda|amendment|rider)\b/.test(hay)) return "addenda";
  if (/\b(lease|rental\s+agreement)\b/.test(hay)) return "leases";
  if (/\b(notice|fire\s+safety|announcement|building\s+notice)\b/.test(hay)) return "notices";
  return "other";
}

function categoryTypeLabel(category: DocCategory): string {
  switch (category) {
    case "leases":
      return "Lease agreement";
    case "addenda":
      return "Addendum";
    case "notices":
      return "Building notice";
    default:
      return "Other document";
  }
}

/** Primary list/preview label — prefer document title (tenant e2e looks for titles). */
function displayTitle(doc: PropertyDocument): string {
  return doc.title?.trim() || doc.file_name?.trim() || "Document";
}

/** Show file name only when it differs from the title. */
function secondaryFileName(doc: PropertyDocument): string | null {
  const title = doc.title?.trim() || "";
  const file = doc.file_name?.trim() || "";
  if (!file || !title) return null;
  if (file.toLowerCase() === title.toLowerCase()) return null;
  return file;
}

/** Building-wide docs (no unit) stay "Whole property" — never borrow the tenant's unit. */
function unitScopeLabel(doc: PropertyDocument): string {
  if (doc.unit_name?.trim()) return `Unit ${doc.unit_name.trim()}`;
  return "Whole property";
}

function scopeGroupKey(doc: PropertyDocument): string {
  if (doc.unit_id != null) return `unit:${doc.unit_id}`;
  return "property";
}

function groupFilteredDocs(rows: CategorizedDoc[]): {
  key: string;
  label: string;
  rows: CategorizedDoc[];
}[] {
  const order: string[] = [];
  const map = new Map<string, { label: string; rows: CategorizedDoc[] }>();
  for (const row of rows) {
    const key = scopeGroupKey(row.doc);
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      order.push(key);
      map.set(key, { label: unitScopeLabel(row.doc).toUpperCase(), rows: [row] });
    }
  }
  return order.map((key) => {
    const group = map.get(key)!;
    return { key, label: group.label, rows: group.rows };
  });
}

export function TenantDocumentsPage() {
  const app = useApp();
  const { getTenantHomeContext, listPropertyDocuments, getPropertyDocumentDownloadUrl, setError } =
    app;
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [category, setCategory] = useState<"all" | DocCategory>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
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
        if (cancelled) return;
        setDocs(list);
        // Do not auto-select — keeps a single title match for list e2e and
        // matches mobile Figma (preview only after Preview).
        setSelectedId((prev) =>
          prev != null && list.some((d) => d.id === prev) ? prev : null,
        );
      } catch (err) {
        if (!cancelled) {
          const message = (err as Error).message;
          setLoadError(message);
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getTenantHomeContext, listPropertyDocuments, setError, reloadKey]);

  const categorized = useMemo(
    () =>
      docs.map((doc) => ({
        doc,
        category: inferDocCategory(doc),
      })),
    [docs],
  );

  const counts = useMemo(() => {
    const next = { all: docs.length, leases: 0, addenda: 0, notices: 0, other: 0 };
    for (const row of categorized) next[row.category] += 1;
    return next;
  }, [categorized, docs.length]);

  const filtered = useMemo(() => {
    if (category === "all") return categorized;
    return categorized.filter((row) => row.category === category);
  }, [categorized, category]);

  const groups = useMemo(() => groupFilteredDocs(filtered), [filtered]);

  const selected = useMemo(() => {
    if (selectedId == null) return null;
    return filtered.find((row) => row.doc.id === selectedId) ?? null;
  }, [filtered, selectedId]);

  useEffect(() => {
    // Clear selection when the active category filter excludes it.
    if (selectedId != null && !filtered.some((row) => row.doc.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

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

  const unitLabel = home?.unit_label ?? null;
  const placeLine = unitLabel
    ? `Unit ${unitLabel}`
    : home?.property_name
      ? home.property_name
      : null;

  const desktopDescription = placeLine
    ? `Lease agreements, notices and shared documents for ${placeLine}.`
    : "Lease agreements, notices and shared documents for your home.";
  const mobileDescription = placeLine
    ? `Shared documents for ${placeLine}.`
    : "Shared documents for your home.";

  return (
    <PageShell title="Documents" width="max-w-6xl">
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            Important papers, easy to find
          </p>
          {/* Display title only (not a heading) — PageShell owns the Documents heading */}
          <p className="text-2xl font-semibold leading-8 text-foreground md:text-[34px] md:leading-[42px]">
            Documents
          </p>
          <p className="text-sm leading-[22px] text-muted-foreground md:hidden">
            {mobileDescription}
          </p>
          <p className="hidden text-sm leading-[22px] text-muted-foreground md:block">
            {desktopDescription}
          </p>
        </header>

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading documents">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : loadError ? (
          <ErrorRetry message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : !home ? (
          <ErrorRetry
            message="Could not load your tenant profile."
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        ) : home.property_id == null ? (
          <EmptyState message="No unit is linked to your account yet, so property documents are unavailable." />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
            <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
              <h2 className="text-lg font-semibold leading-[26px] text-foreground">
                Shared with you
              </h2>

              <div
                className="mt-4 flex flex-wrap gap-2"
                role="group"
                aria-label="Document categories"
              >
                {CATEGORY_FILTERS.map((chip) => {
                  const active = category === chip.id;
                  const count = counts[chip.id];
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCategory(chip.id)}
                      className={cn(
                        "inline-flex h-9 min-h-9 items-center rounded-sm px-3 text-xs",
                        active
                          ? "bg-brand-tint font-medium text-brand-text"
                          : "bg-muted text-muted-foreground hover:bg-muted/80",
                      )}
                    >
                      {chip.label} · {count}
                    </button>
                  );
                })}
              </div>

              {docs.length === 0 ? (
                <EmptyState
                  className="mt-4"
                  icon={<FileText className="size-5" aria-hidden />}
                  message="No documents shared with tenants for this property yet."
                />
              ) : filtered.length === 0 ? (
                <EmptyState
                  className="mt-4"
                  filtered
                  message="No documents in this category."
                  clearLabel="Show all"
                  onClear={() => setCategory("all")}
                />
              ) : (
                <div className="mt-5 space-y-5">
                  {groups.map((group) => (
                    <div key={group.key}>
                      <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        {group.label}
                      </p>
                      <ul className="mt-3 space-y-3">
                        {group.rows.map(({ doc, category: cat }) => {
                          const active = selected?.doc.id === doc.id;
                          return (
                            <li key={doc.id}>
                              <DocumentRow
                                doc={doc}
                                category={cat}
                                selected={active}
                                onSelect={() => setSelectedId(doc.id)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-5 text-xs leading-[18px] text-muted-foreground md:hidden">
                Only documents shared with your assigned unit appear here.
              </p>
              <p className="mt-5 hidden text-xs leading-[18px] text-muted-foreground md:block">
                Building documents are included only when shared with your unit.
              </p>
            </section>

            {/* Preview pane: desktop side column; tablet/mobile stacked below when selected */}
            <aside
              className={cn(
                "rounded-lg border border-border bg-card p-4 sm:p-5",
                !selected && "hidden lg:block",
              )}
            >
              <h2 className="text-lg font-semibold leading-[26px] text-foreground">
                Document preview
              </h2>

              {selected ? (
                <DocumentPreviewPanel
                  doc={selected.doc}
                  category={selected.category}
                  downloading={downloadingId === selected.doc.id}
                  onDownload={() => void downloadDoc(selected.doc)}
                />
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Select a document to preview details and download.
                </p>
              )}
            </aside>
          </div>
        )}

        <p className="text-xs leading-[18px] text-muted-foreground md:hidden">
          {/* TODO(data-gap): in-app preview / e-sign not wired */}
          Download uses a short-lived authorized link. In-browser preview is not available
          yet.
        </p>
        <p className="hidden text-xs leading-[18px] text-muted-foreground md:block">
          Access follows your tenant and unit assignments. Maintenance workers cannot
          access lease documents.
        </p>
      </div>
    </PageShell>
  );
}

function DocumentRow({
  doc,
  category,
  selected,
  onSelect,
}: {
  doc: PropertyDocument;
  category: DocCategory;
  selected: boolean;
  onSelect: () => void;
}) {
  const kind = fileKindLabel(doc);
  const uploaded = formatUploaded(doc.created_at);
  const size = formatBytes(doc.byte_size);
  const fileLine = secondaryFileName(doc);
  const meta = [uploaded, size].filter(Boolean).join(" · ");
  const typeLine = `${categoryTypeLabel(category)} · Shared`;

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-4 transition-colors",
        selected
          ? "border-transparent bg-brand-tint"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      {/* md+: horizontal ListRow-like layout; mobile: stacked with full-width Preview */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-pressed={selected}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-semibold text-brand-text",
              "size-10 md:h-14 md:w-12",
            )}
            aria-hidden
          >
            {kind}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-[22px] text-foreground">
              {displayTitle(doc)}
            </span>
            {fileLine ? (
              <span className="mt-0.5 block truncate text-xs leading-[18px] text-muted-foreground">
                {fileLine}
              </span>
            ) : null}
            {meta ? (
              <span className="mt-0.5 block truncate text-xs leading-[18px] text-muted-foreground">
                {meta}
              </span>
            ) : null}
            <span className="mt-0.5 block truncate text-xs leading-[18px] text-muted-foreground md:mt-1">
              {typeLine}
            </span>
          </span>
        </button>

        <Button
          type="button"
          variant="secondary"
          className="h-11 w-full px-3 text-brand-text md:w-[108px] md:shrink-0"
          onClick={onSelect}
        >
          Preview
        </Button>
      </div>
    </div>
  );
}

function DocumentPreviewPanel({
  doc,
  category,
  downloading,
  onDownload,
}: {
  doc: PropertyDocument;
  category: DocCategory;
  downloading: boolean;
  onDownload: () => void;
}) {
  const kind = fileKindLabel(doc);
  const uploaded = formatUploaded(doc.created_at);
  const size = formatBytes(doc.byte_size);
  const scope = unitScopeLabel(doc);
  const fileLine = secondaryFileName(doc);
  const meta = [scope, uploaded, size].filter(Boolean).join(" · ");

  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="truncate text-sm font-medium leading-[22px] text-foreground">
          {fileLine ? `${displayTitle(doc)} · ${fileLine}` : displayTitle(doc)}
        </p>
        <p className="mt-1 text-xs leading-[18px] text-muted-foreground">{meta}</p>
        <p className="mt-1 text-xs leading-[18px] text-muted-foreground">
          {categoryTypeLabel(category)} · Shared
        </p>
      </div>

      {/* TODO(data-gap): no in-browser document preview / e-sign integration */}
      <div className="flex min-h-[220px] flex-col items-start justify-center gap-2 rounded-lg bg-muted px-6 py-10 sm:min-h-[250px] lg:min-h-[280px]">
        <p className="text-2xl font-semibold leading-8 text-brand-text">{kind}</p>
        <p className="text-lg font-semibold leading-[26px] text-foreground">
          Preview unavailable
        </p>
        <p className="max-w-md text-sm leading-[22px] text-muted-foreground">
          Document contents are not connected to this design.
        </p>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full"
        disabled={downloading}
        onClick={onDownload}
      >
        {downloading ? "Preparing download…" : "Download"}
      </Button>

      <p className="text-sm leading-[22px] text-muted-foreground">
        Download uses a short-lived authorized link. In-browser preview is not available
        yet.
      </p>
    </div>
  );
}
