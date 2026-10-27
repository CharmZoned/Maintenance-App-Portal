import { Badge } from "@/components/ui/badge";

/** Marks seeded or demo records so they are never mistaken for live data. */
export function TestDataBadge({ show, className }: { show?: boolean | null; className?: string }) {
  if (!show) return null;
  return (
    <Badge variant="warning" className={className} title="This record is test data">
      Test data
    </Badge>
  );
}
