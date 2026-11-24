import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorRetry,
  ListRow,
  PriorityChip,
  SkeletonRow,
  StatusChip,
  SuccessNotice,
} from "@/components/patterns";

/**
 * Admin-only specimen board for Figma Foundations → code parity checks.
 * Not linked in primary nav — open `/foundation`.
 */
export function FoundationGalleryPage() {
  return (
    <PageShell title="Foundation" meta="Tokens · chrome · patterns">
      <section className="space-y-3">
        <h2 className="section-label">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Save</Button>
          <Button variant="brand" size="header">
            New request
          </Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="outline">Sign out</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Badges</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="success">Paid</Badge>
          <Badge variant="warning">High</Badge>
          <Badge variant="destructive">Overdue</Badge>
          <Badge variant="brand">Count</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Input</h2>
        <Input className="max-w-xs" placeholder="Placeholder" />
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Card</h2>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Sample card</CardTitle>
            <CardDescription>Inset edge, no drop shadow at rest.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Journey screens compose content into PageShell — do not rebuild nav.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Status · priority</h2>
        <div className="flex flex-col gap-3">
          <StatusChip status="New" nextStep="Waiting for assignment" />
          <StatusChip status="Assigned" nextStep="Tue 17 Nov · Sam Fixit" />
          <StatusChip status="In progress" nextStep="Work started" />
          <StatusChip status="On hold" nextStep="Waiting for part · follow-up Fri 20 Nov" />
          <StatusChip status="Completed" nextStep="Replaced valve · closed" />
        </div>
        <div className="flex gap-2">
          <PriorityChip level="Emergency" />
          <PriorityChip level="High" />
        </div>
      </section>

      <section className="space-y-0 overflow-hidden rounded-md shadow-edge">
        <h2 className="section-label border-b border-border px-4 py-3">List · skeleton</h2>
        <ListRow
          title="Leaking tap in kitchen"
          context="Unit 4B · Reported yesterday"
          status={<StatusChip status="Assigned" nextStep="Tue 17 Nov · Sam Fixit" />}
        />
        <SkeletonRow />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <EmptyState
          message="Nothing open. Report a problem if something needs fixing."
          actionLabel="Report a problem"
          onAction={() => undefined}
        />
        <EmptyState
          filtered
          message="No requests match these filters."
          onClear={() => undefined}
        />
        <ErrorRetry onRetry={() => undefined} />
        <SuccessNotice message="Password updated" />
      </section>
    </PageShell>
  );
}
