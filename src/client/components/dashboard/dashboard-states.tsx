import { cn } from "@/lib/utils";
import { AdminButton } from "./dashboard-primitives";

const STATE_CARD =
  "flex min-w-0 flex-col items-start gap-4 rounded-md border border-border bg-card p-4";

/**
 * AD / Dashboard skeleton tile — data-shaped bones: a label bar, a value
 * block and a detail bar. Pulses only when motion is allowed.
 */
function SkeletonTile({ className }: { className?: string }) {
  const bone = "rounded-xs bg-muted motion-safe:animate-pulse";
  return (
    <div className={cn("flex h-[100px] min-w-0 flex-col gap-3 rounded-md bg-card p-4", className)}>
      <div className={cn(bone, "h-3 w-full")} />
      <div className={cn(bone, "h-8 w-[90px] max-w-full")} />
      <div className={cn(bone, "h-3 w-full")} />
    </div>
  );
}

/**
 * Data-shaped skeletons (Figma "Loading" · "KPI placeholders" + "Dashboard
 * skeletons"): six KPI tiles, then the three card columns of the ready
 * layout (filling the screen from `xl`, like the cards). Never loading text
 * on screen — the label is for assistive technology only.
 */
export function DashboardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
      className="flex min-w-0 flex-col gap-6 xl:min-h-0 xl:flex-1 xl:gap-4"
    >
      <span className="sr-only">Loading dashboard</span>
      <div
        aria-hidden
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonTile key={index} />
        ))}
      </div>
      <div
        aria-hidden
        className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:min-h-[30rem] xl:flex-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,19rem)] xl:gap-4 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,22rem)]"
      >
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border bg-card p-4 xl:h-full"
          >
            <SkeletonTile />
            <SkeletonTile />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * No properties yet (Figma "Empty" · "Start your portfolio" + "Getting
 * started"): the one next step, then the three setup steps and who to ask.
 */
export function DashboardEmpty({
  statsLines,
  contactLines,
  onAddProperty,
}: {
  statsLines: string[];
  contactLines: string[];
  onAddProperty: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="dashboard-empty-title" className={STATE_CARD}>
        <h2 id="dashboard-empty-title" className="lg-heading break-words text-foreground">
          Your command center starts here
        </h2>
        <p className="lg-body break-words text-foreground">
          Add your first property, assign a landlord, then invite tenants. Rent, requests and
          conversations will appear here.
        </p>
        <AdminButton variant="default" className="min-w-40" onClick={onAddProperty}>
          Add property
        </AdminButton>
        {statsLines.length > 0 ? (
          <div className="lg-caption min-w-0 max-w-full text-muted-foreground">
            {statsLines.map((line) => (
              <p key={line} className="break-words">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-label="Getting started" className={STATE_CARD}>
        <ol className="lg-section flex list-inside list-decimal flex-col gap-4 text-foreground">
          <li className="break-words">Add a property</li>
          <li className="break-words">Add units and assign a landlord</li>
          <li className="break-words">Invite people and set up rent</li>
        </ol>
        {contactLines.length > 0 ? (
          <div className="lg-body min-w-0 max-w-full text-foreground">
            {contactLines.map((line) => (
              <p key={line} className="break-words">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Load failed (Figma "Error" · "Error with retry"): "Dashboard unavailable",
 * what happened, Retry, and when the last attempt was. Announced as an alert.
 */
export function DashboardError({
  message,
  lastAttemptLine,
  onRetry,
}: {
  message: string;
  lastAttemptLine: string;
  onRetry: () => void;
}) {
  // The design leads the sentence with "Error ·" so the state never relies on
  // colour alone; keep a message that already carries it as is.
  const sentence = /^error\b/i.test(message) ? message : `Error · ${message}`;
  return (
    <section role="alert" aria-labelledby="dashboard-error-title" className={STATE_CARD}>
      <h2 id="dashboard-error-title" className="lg-heading break-words text-destructive">
        Dashboard unavailable
      </h2>
      <p className="lg-body break-words text-foreground">{sentence}</p>
      <AdminButton variant="default" className="min-w-36" onClick={onRetry}>
        Retry
      </AdminButton>
      {lastAttemptLine ? (
        <p className="lg-caption break-words text-muted-foreground">{lastAttemptLine}</p>
      ) : null}
    </section>
  );
}
