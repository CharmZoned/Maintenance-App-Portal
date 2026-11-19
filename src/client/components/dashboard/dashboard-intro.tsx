import type { DashboardIntroModel } from "./admin-dashboard-model";
import { AdminButton } from "./dashboard-primitives";
import { QuickAddMenu } from "./quick-add-menu";

/**
 * Page introduction (Figma "Page introduction" + "Page actions"): eyebrow,
 * the greeting as the page's `<h1>`, the date line, then "New request" and
 * "Quick add". Shown in every dashboard state.
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
    <header className="flex min-w-0 flex-col gap-2">
      <p className="lg-label break-words uppercase text-muted-foreground">{intro.eyebrow}</p>
      <h1 className="lg-display break-words text-foreground">{intro.greeting}</h1>
      <p className="lg-body break-words text-muted-foreground">{intro.dateLine}</p>
      <div className="flex flex-wrap items-center gap-3">
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
