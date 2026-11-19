import type { DashboardIntroModel } from "./admin-dashboard-model";

/** STUB — replaced by the intro/KPI agent. Props are the contract. */
export function DashboardIntro({
  intro,
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
  return <div data-stub="intro">{intro.greeting}</div>;
}
