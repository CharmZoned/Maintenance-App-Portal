import { useEffect, useState } from "react";
import { Download, FileText, Plus, Trash2 } from "lucide-react";
import { useApp } from "@/context";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DocumentVisibility, PropertyDocument, Unit } from "@/types";

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

export function PropertyDocumentsPanel({
  propertyId,
  units,
}: {
  propertyId: number;
  units: Unit[];
}) {
  const app = useApp();
  /** Staff/admin manage docs; landlord (and tenant) shells are list/download only. */
  const canManageDocuments = !app.isLandlord && !app.isTenant;
  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<PropertyDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const list = await app.listPropertyDocuments({ property_id: propertyId });
        if (!cancelled) setDocs(list);
      } catch (err) {
        if (!cancelled) app.setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Stable data helpers; avoid depending on whole app object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, app.listPropertyDocuments, app.setError]);

  async function changeVisibility(doc: PropertyDocument, visibility: DocumentVisibility) {
    if (!app.isAdmin || doc.visibility === visibility) return;
    try {
      const updated = await app.updatePropertyDocumentVisibility(doc.id, visibility);
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, ...updated } : d)));
      app.setNotice(`Visibility set to ${VISIBILITY_LABEL[visibility]}.`);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  async function downloadDoc(doc: PropertyDocument) {
    try {
      setDownloadingId(doc.id);
      const url = await app.getPropertyDocumentDownloadUrl(doc);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.rel = "noreferrer";
      a.target = "_blank";
      a.click();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await app.deletePropertyDocument(deleting.id);
      setDocs((prev) => prev.filter((d) => d.id !== deleting.id));
      app.setNotice("Document deleted.");
      setDeleting(null);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Documents</h2>
        {canManageDocuments && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Upload
          </Button>
        )}
      </div>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading documents…</Card>
      ) : docs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {canManageDocuments
            ? "No documents yet. Upload leases, handbooks, or inspection files."
            : "No documents shared for this property yet."}
        </Card>
      ) : (
        <Card className="divide-y">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-start justify-between gap-3 p-4">
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
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {app.isAdmin ? (
                  <Select
                    value={doc.visibility}
                    onValueChange={(v) => void changeVisibility(doc, v as DocumentVisibility)}
                  >
                    <SelectTrigger className="h-7 w-[7.5rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="staff">Staff</SelectItem>
                      <SelectItem value="landlord">Landlord</SelectItem>
                      <SelectItem value="tenant">Tenant</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="neutral">{VISIBILITY_LABEL[doc.visibility]}</Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadingId === doc.id}
                  onClick={() => void downloadDoc(doc)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canManageDocuments && (
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(doc)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {canManageDocuments && (
        <>
          <UploadDocumentDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            propertyId={propertyId}
            units={units}
            onUploaded={(doc) => {
              setDocs((prev) => [doc, ...prev]);
              app.setNotice("Document uploaded.");
            }}
          />

          <ConfirmDelete
            open={deleting != null}
            onOpenChange={(o) => {
              if (!o) setDeleting(null);
            }}
            title="Delete document?"
            description={
              deleting
                ? `Remove “${deleting.title}” (${deleting.file_name}) from this property.`
                : undefined
            }
            onConfirm={() => void confirmDelete()}
          />
        </>
      )}
    </section>
  );
}

function UploadDocumentDialog({
  open,
  onOpenChange,
  propertyId,
  units,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: number;
  units: Unit[];
  onUploaded: (doc: PropertyDocument) => void;
}) {
  const app = useApp();
  const [title, setTitle] = useState("");
  const [unitId, setUnitId] = useState<string>("all");
  const [visibility, setVisibility] = useState<DocumentVisibility>("staff");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setUnitId("all");
    setVisibility("staff");
    setFile(null);
  }, [open]);

  async function save() {
    if (!file || !title.trim()) return;
    try {
      setSaving(true);
      const doc = await app.uploadPropertyDocument({
        property_id: propertyId,
        unit_id: unitId === "all" ? null : Number(unitId),
        title: title.trim(),
        file,
        visibility: app.isAdmin ? visibility : "staff",
      });
      onUploaded(doc);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lease agreement"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-file">File</Label>
            <Input
              id="doc-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Unit (optional)</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger>
                <SelectValue placeholder="Whole property" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Whole property</SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Visibility</Label>
            {app.isAdmin ? (
              <Select value={visibility} onValueChange={(v) => setVisibility(v as DocumentVisibility)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff only</SelectItem>
                  <SelectItem value="landlord">Landlord (+ staff)</SelectItem>
                  <SelectItem value="tenant">Tenant (+ landlord + staff)</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                Staff only. An admin can widen visibility after upload.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !file || !title.trim()}>
            {saving ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
