import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROPERTY_DOCUMENT_ACCEPT } from "@/lib/data";
import type { DocumentVisibility, PropertyDocument, Unit } from "@/types";

const WHOLE_PROPERTY = "all";

/**
 * Upload a file from anywhere in the admin workspace (Dashboard → Quick add →
 * Upload document, and the Documents page). Same fields and rules as the
 * upload on a property's page, with the property chosen here first.
 *
 * Admins choose who can see the file; other staff upload as staff-only and an
 * admin can widen it afterwards (the data layer enforces the same).
 */
export function AdminUploadDocumentDialog({
  open,
  onOpenChange,
  defaultPropertyId,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a property (e.g. the Documents page filter). */
  defaultPropertyId?: number | null;
  onUploaded: (doc: PropertyDocument) => void;
}) {
  const app = useApp();
  const { properties, listUnits, uploadPropertyDocument, setError, isAdmin } = app;
  const [propertyId, setPropertyId] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState(WHOLE_PROPERTY);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<DocumentVisibility>("staff");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const propertyOptions = useMemo(
    () =>
      [...properties]
        .map((p) => ({ id: p.id, name: p.name?.trim() || `Property #${p.id}` }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    [properties],
  );

  useEffect(() => {
    if (!open) return;
    const preset =
      defaultPropertyId != null && propertyOptions.some((p) => p.id === defaultPropertyId)
        ? String(defaultPropertyId)
        : propertyOptions.length === 1
          ? String(propertyOptions[0].id)
          : "";
    setPropertyId(preset);
    setUnitId(WHOLE_PROPERTY);
    setTitle("");
    setVisibility("staff");
    setFile(null);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setUnitId(WHOLE_PROPERTY);
    if (!propertyId) {
      setUnits([]);
      return;
    }
    let cancelled = false;
    listUnits(Number(propertyId))
      .then((rows) => {
        if (!cancelled) setUnits(rows);
      })
      .catch(() => {
        // The upload still works for the whole property.
        if (!cancelled) setUnits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, listUnits]);

  const canSave = Boolean(propertyId && file && title.trim()) && !saving;

  async function save() {
    if (!propertyId || !file || !title.trim()) return;
    try {
      setSaving(true);
      const doc = await uploadPropertyDocument({
        property_id: Number(propertyId),
        unit_id: unitId === WHOLE_PROPERTY ? null : Number(unitId),
        title: title.trim(),
        file,
        visibility: isAdmin ? visibility : "staff",
      });
      onUploaded(doc);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
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
            <Label>Property</Label>
            {propertyOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add a property first — every document belongs to one.
              </p>
            ) : (
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger aria-label="Property">
                  <SelectValue placeholder="Choose a property" />
                </SelectTrigger>
                <SelectContent>
                  {propertyOptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Unit (optional)</Label>
            <Select value={unitId} onValueChange={setUnitId} disabled={!propertyId}>
              <SelectTrigger aria-label="Unit">
                <SelectValue placeholder="Whole property" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_PROPERTY}>Whole property</SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="admin-doc-title">Title</Label>
            <Input
              id="admin-doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lease agreement"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="admin-doc-file">File</Label>
            <Input
              id="admin-doc-file"
              type="file"
              accept={PROPERTY_DOCUMENT_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Who can see it</Label>
            {isAdmin ? (
              <Select value={visibility} onValueChange={(v) => setVisibility(v as DocumentVisibility)}>
                <SelectTrigger aria-label="Who can see it">
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
                Staff only. An admin can share it more widely after upload.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
