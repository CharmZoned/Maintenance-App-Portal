import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/patterns";

/** Placeholder for journey screens that land after foundation. */
export function StubPage({
  title,
  meta,
  message,
}: {
  title: string;
  meta?: string;
  message: string;
}) {
  return (
    <PageShell title={title} meta={meta}>
      <EmptyState message={message} />
    </PageShell>
  );
}
