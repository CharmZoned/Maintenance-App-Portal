import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkOrderPriority, WorkOrderStatus } from "@/types";

export interface WorkOrderTenantDetailProps {
  title: string;
  description: string;
  category: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  permissionToEnter: boolean;
}

/** Tenant / landlord read-only request summary (title, description, badges). */
export function WorkOrderTenantDetail({
  title,
  description,
  category,
  priority,
  status,
  permissionToEnter,
}: WorkOrderTenantDetailProps) {
  return (
    <>
      <div>
        <Label htmlFor="wo-title">Title</Label>
        <Input id="wo-title" value={title} disabled />
      </div>
      <div>
        <Label htmlFor="wo-desc">Description</Label>
        <Textarea id="wo-desc" value={description} rows={3} disabled />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="secondary" className="capitalize">
          {status.replaceAll("_", " ")}
        </Badge>
        <span className="text-muted-foreground">{category}</span>
        {priority === "urgent" && <Badge variant="destructive">Emergency</Badge>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={permissionToEnter} className="size-4" disabled />
        Permission to enter
      </label>
    </>
  );
}
