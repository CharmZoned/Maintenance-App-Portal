import type { ReactNode } from "react";

/**
 * STUB — replaced by the chrome agent. Props are the contract.
 *
 * Admin page frame: the 72px header ("Admin workspace / {section}" on desktop;
 * menu button + brand below `lg`; notifications on the right) over a scrolling
 * content pane on the paper background. Carries the `lg-admin` scope.
 */
export function AdminPageShell({
  section,
  children,
}: {
  /** Current section for the breadcrumb, e.g. "Dashboard". */
  section: string;
  children: ReactNode;
}) {
  return (
    <div className="lg-admin flex min-h-0 flex-1 flex-col bg-background" data-section={section}>
      <div className="min-h-0 flex-1 overflow-auto p-6">{children}</div>
    </div>
  );
}
