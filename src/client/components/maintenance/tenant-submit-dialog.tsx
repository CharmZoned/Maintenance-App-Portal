import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory, type TenantHomeContext } from "@/types";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function TenantSubmitDialog({ open, onOpenChange, onSaved }: Props) {
  const app = useApp();
  const [home, setHome] = useState<TenantHomeContext | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory>("General repair");
  const [emergency, setEmergency] = useState(false);
  const [permission, setPermission] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setCategory("General repair");
    setEmergency(false);
    setPermission(false);
    setFiles([]);
    let cancelled = false;
    (async () => {
      try {
        const ctx = await app.getTenantHomeContext();
        if (!cancelled) setHome(ctx);
      } catch (err) {
        if (!cancelled) app.setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, app]);

  const homeLabel = home
    ? [home.unit_label ? `Unit ${home.unit_label}` : null, home.property_name]
        .filter(Boolean)
        .join(" · ") || "Your unit"
    : "Loading unit…";

  const noUnit = home != null && home.unit_id == null;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 5));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    if (!title.trim() || !description.trim() || noUnit) return;
    setSaving(true);
    try {
      const created = await app.submitTenantRequest({
        title: title.trim(),
        description: description.trim(),
        category,
        permission_to_enter: permission,
        priority: emergency ? "urgent" : "normal",
      });
      let photoFail = false;
      if (files.length) {
        try {
          await Promise.all(
            files.slice(0, 5).map((file) => app.uploadMaintenancePhoto(created.id, file)),
          );
        } catch (photoErr) {
          photoFail = true;
          app.setError((photoErr as Error).message);
        }
      }
      app.setNotice(
        photoFail
          ? "Request submitted, but photo upload failed — open the request to add photos."
          : files.length
            ? "Request submitted with photos. Staff will update status in the portal."
            : "Request submitted. Staff will update status in the portal.",
      );
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit a maintenance request</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="rounded border bg-muted/40 px-3 py-2 text-sm">
            Reporting for <span className="font-medium text-foreground">{homeLabel}</span>
          </p>
          {noUnit && (
            <p className="text-sm text-destructive">
              Your account isn’t linked to a unit yet. Ask staff to assign a unit before submitting.
            </p>
          )}
          <div>
            <Label htmlFor="tenant-title">Title</Label>
            <Input
              id="tenant-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leaking kitchen faucet"
              disabled={noUnit}
            />
          </div>
          <div>
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as MaintenanceCategory)}
              disabled={noUnit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINTENANCE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tenant-desc">Description</Label>
            <Textarea
              id="tenant-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What needs fixing? When did it start?"
              disabled={noUnit}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={emergency}
              onChange={(e) => setEmergency(e.target.checked)}
              className="size-4"
              disabled={noUnit}
            />
            This is an emergency (urgent)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={permission}
              onChange={(e) => setPermission(e.target.checked)}
              className="size-4"
              disabled={noUnit}
            />
            Permission to enter if nobody is home
          </label>
          <div>
            <Label htmlFor="tenant-photos">Photos (optional, up to 5)</Label>
            <Input
              id="tenant-photos"
              type="file"
              accept="image/*"
              multiple
              disabled={noUnit || files.length >= 5}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {previews.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {previews.map((p, i) => (
                  <div key={p.url} className="relative overflow-hidden rounded border">
                    <img src={p.url} alt={p.file.name} className="aspect-square w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded bg-background/90 p-0.5"
                      onClick={() => removeFile(i)}
                      aria-label="Remove photo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || noUnit || !title.trim() || !description.trim()}
          >
            {saving ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
