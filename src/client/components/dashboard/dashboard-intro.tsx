import type { DashboardIntroModel } from "./admin-dashboard-model";
import { AdminButton } from "./dashboard-primitives";
import { QuickAddMenu } from "./quick-add-menu";

/**
 * Page introduction (Figma "Page introduction" + "Page actions"): the greeting
 * as the page's `<h1>` over the date line, with "New request" and "Quick add"
 * on the same row from `sm` up (under it on phones). Kept to one compact row
 * so the cards below fit the first screen. The eyebrow is kept for screen
 * readers only. Shown in every dashboard state.
 */
export function DashboardIntro({
  intro,
  canCreateRequest,
  onNewRequest,
  onQuickAdd,
  defaultQuickAddOpen,
}: {
  intro: DashboardIntroModel;
  /** Hide "New request" when the signed-in user cannot create requests. */
  canCreateRequest: boolean;
  onNewRequest: () => void;
  /** Called with one of the ids in QUICK_ADD_ACTIONS (quick-add-menu.tsx). */
  onQuickAdd: (actionId: string) => void;
  /** Preview/testing only: render the Quick add menu open on mount. */
  defaultQuickAddOpen?: boolean;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="sr-only">{intro.eyebrow}</p>
        <h1 className="lg-heading break-words text-foreground">{intro.greeting}</h1>
        <p className="lg-caption break-words text-muted-foreground">{intro.dateLine}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {canCreateRequest ? (
          <AdminButton variant="default" className="min-w-36" onClick={onNewRequest}>
            New request
          </AdminButton>
        ) : null}
        <QuickAddMenu onSelect={onQuickAdd} defaultOpen={defaultQuickAddOpen} />
      </div>
    </header>
  );
}
