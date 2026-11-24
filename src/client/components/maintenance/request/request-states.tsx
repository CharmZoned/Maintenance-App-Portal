import { Button } from "@/components/ui/button";
import { ErrorRetry, SuccessNotice } from "@/components/patterns";
import { cn } from "@/lib/utils";

/**
 * Request page states (brief §2.5 + N3 "States"; Figma has them for every role).
 * Loading = skeleton in the page's shape, never centred "Loading…" text.
 * Not available = not found OR not permitted (RLS hides the row) — one message,
 * with a way back, never a blank page.
 */

function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-xs bg-muted motion-safe:animate-pulse", className)} aria-hidden />;
}

export interface RequestLoadingStateProps {
  /** Admin / worker layouts reserve the actions column. */
  withActionsPanel?: boolean;
}

export function RequestLoadingState({ withActionsPanel = false }: RequestLoadingStateProps) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start" aria-busy="true" aria-label="Loading request">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="space-y-2">
          <Bone className="h-3 w-24" />
          <Bone className="h-8 w-full max-w-md" />
          <Bone className="h-5 w-56" />
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <Bone className="h-4 w-20" />
          <div className="mt-3 flex gap-2">
            <Bone className="size-[72px]" />
            <Bone className="size-[72px]" />
          </div>
        </div>
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <Bone className="h-4 w-24" />
          <Bone className="h-3 w-full max-w-sm" />
          <Bone className="h-3 w-full max-w-xs" />
        </div>
      </div>
      {withActionsPanel ? (
        <div className="w-full space-y-2 rounded-md border border-border bg-card p-4 lg:w-[280px]">
          <Bone className="h-11 w-full" />
          <Bone className="h-11 w-full" />
        </div>
      ) : null}
    </div>
  );
}

export interface RequestErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function RequestErrorState({ message, onRetry }: RequestErrorStateProps) {
  return <ErrorRetry message={message} onRetry={onRetry} />;
}

export interface RequestNotAvailableStateProps {
  /** "Maintenance" / "My jobs" / "Requests" — from backLinkFor(role). */
  backLabel: string;
  onBack: () => void;
}

export function RequestNotAvailableState({ backLabel, onBack }: RequestNotAvailableStateProps) {
  return (
    <section className="rounded-md border border-border bg-card p-6">
      <h2 className="text-base font-semibold text-foreground">This request isn’t available</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        It may have been removed, or it isn’t one of yours.
      </p>
      <Button className="mt-4" size="touch" variant="secondary" onClick={onBack}>
        Back to {backLabel}
      </Button>
    </section>
  );
}

export interface RequestSuccessStateProps {
  /** One line, e.g. "Marked completed". The page clears it after a few seconds. */
  message: string;
}

export function RequestSuccessState({ message }: RequestSuccessStateProps) {
  return <SuccessNotice message={message} />;
}
