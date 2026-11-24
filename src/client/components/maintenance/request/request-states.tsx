import type { ReactNode } from "react";
import { RefreshCw, SearchX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RequestBackLink } from "./request-header";
import { FloatingBanner } from "@/components/patterns/floating-banner";

/**
 * Request page states (spec §3; Figma "UPGRADED — Request" has them for every role).
 *
 * The shell (sidebar + header) always stays; only the content area changes.
 * - Loading: skeleton bones in the page's shape. Never "Loading…" text.
 * - Error: triangle-alert, one sentence, secondary Retry.
 * - Not available (not found OR not permitted; RLS hides the row): search-x,
 *   one sentence, a role-specific primary button. Never a blank page.
 * - Success / action failed: a floating banner at the bottom centre.
 */

function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-xs bg-muted motion-safe:animate-pulse", className)} aria-hidden />;
}

function CardBones({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-md border border-border bg-card p-4 md:p-5", className)}>
      {children}
    </div>
  );
}

function FieldBone({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Bone className="h-3 w-16" />
      <Bone className="h-4 w-full max-w-[12rem]" />
    </div>
  );
}

export interface RequestLoadingStateProps {
  /** Admin / worker layouts reserve the actions column. */
  withActionsPanel?: boolean;
}

export function RequestLoadingState({ withActionsPanel = false }: RequestLoadingStateProps) {
  const actions = (
    <CardBones>
      <Bone className="h-4 w-20" />
      <Bone className="h-7 w-full" />
      <Bone className="h-7 w-full" />
      <div className="h-px bg-border" aria-hidden />
      <FieldBone />
      <FieldBone />
    </CardBones>
  );
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true" aria-label="Loading request">
      <div className="flex flex-col gap-2.5">
        <Bone className="h-4 w-24" />
        <Bone className="h-7 w-full max-w-xs md:hidden" />
        <div className="flex gap-2">
          <Bone className="h-5 w-20" />
          <Bone className="h-5 w-32" />
          <Bone className="h-5 w-14" />
        </div>
        <Bone className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-4 md:gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {withActionsPanel ? <div className="hidden md:block lg:col-start-2 lg:row-start-1">{actions}</div> : null}
        <div className="flex min-w-0 flex-col gap-4 md:gap-6 lg:col-start-1 lg:row-start-1">
          <CardBones>
            <Bone className="h-5 w-20" />
            <FieldBone />
            <FieldBone className="[&>div:last-child]:max-w-md" />
            <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:gap-6">
              <FieldBone />
              <FieldBone />
              <FieldBone />
            </div>
          </CardBones>
          <CardBones>
            <Bone className="h-5 w-16" />
            <div className="flex gap-3">
              <Bone className="size-24 rounded-sm" />
              <Bone className="size-24 rounded-sm" />
            </div>
          </CardBones>
          <CardBones>
            <Bone className="h-5 w-20" />
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex gap-3">
                <Bone className="size-6 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Bone className="h-4 w-full max-w-sm" />
                  <Bone className="h-3 w-24" />
                </div>
              </div>
            ))}
          </CardBones>
        </div>
        {withActionsPanel ? <div className="md:hidden">{actions}</div> : null}
      </div>
    </div>
  );
}

function CentredState({
  icon,
  message,
  children,
  role,
}: {
  icon: ReactNode;
  message: string;
  children?: ReactNode;
  role?: "alert";
}) {
  return (
    <section
      role={role}
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-card px-6 py-12 text-center"
    >
      {icon}
      <p className="max-w-sm text-sm leading-5 text-muted-foreground">{message}</p>
      {children}
    </section>
  );
}

export interface RequestErrorStateProps {
  /** Defaults to the designed copy; pass only to override it. */
  message?: string;
  onRetry: () => void;
  /** Back link above the message (spec: shown on the error state). */
  backLabel?: string;
  onBack?: () => void;
}

export const REQUEST_LOAD_ERROR =
  "We couldn't load this request. Check your connection and try again.";

export function RequestErrorState({ message = REQUEST_LOAD_ERROR, onRetry, backLabel, onBack }: RequestErrorStateProps) {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {backLabel && onBack ? <RequestBackLink label={backLabel} onBack={onBack} /> : null}
      <CentredState
        role="alert"
        icon={<TriangleAlert className="size-6 text-destructive" aria-hidden />}
        message={message}
      >
        <Button variant="secondary" size="touch" className="md:h-7 md:px-2" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Retry
        </Button>
      </CentredState>
    </div>
  );
}

export interface RequestNotAvailableStateProps {
  /** "Maintenance" / "My jobs" / "Requests" — from backLinkFor(role). */
  backLabel: string;
  onBack: () => void;
  /** Role-specific primary ("Go to Dashboard" …) from notAvailableActionFor(role). */
  actionLabel?: string;
  onAction?: () => void;
}

export const REQUEST_NOT_AVAILABLE =
  "This request isn’t available. It may have been deleted, or you may not have access to it.";

export function RequestNotAvailableState({ backLabel, onBack, actionLabel, onAction }: RequestNotAvailableStateProps) {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <RequestBackLink label={backLabel} onBack={onBack} />
      <CentredState
        icon={<SearchX className="size-6 text-muted-foreground" aria-hidden />}
        message={REQUEST_NOT_AVAILABLE}
      >
        <Button size="touch" className="md:h-7 md:px-2" onClick={onAction ?? onBack}>
          {actionLabel ?? `Back to ${backLabel}`}
        </Button>
      </CentredState>
    </div>
  );
}

export type RequestBannerTone = "success" | "error";

export interface RequestBannerProps {
  tone: RequestBannerTone;
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms (0 keeps it). Default: success 4s, error stays. */
  autoDismissMs?: number;
}

/**
 * Banner / Success and Banner / Error (spec §3): floating at the bottom centre,
 * one line, close x. On phone it sits above the sticky bar. Drawn above open
 * dialogs and sheets so a failed save inside one is visible (FloatingBanner).
 */
export function RequestBanner({ tone, message, onDismiss, autoDismissMs }: RequestBannerProps) {
  return (
    <FloatingBanner
      tone={tone}
      message={message}
      onDismiss={onDismiss}
      autoDismissMs={autoDismissMs}
      placement="above-bar"
    />
  );
}

export interface RequestSuccessStateProps {
  /** One line, e.g. "Marked completed." */
  message: string;
  onDismiss?: () => void;
}

/** Success banner shorthand (kept for the foundation contract). */
export function RequestSuccessState({ message, onDismiss }: RequestSuccessStateProps) {
  return <RequestBanner tone="success" message={message} onDismiss={onDismiss ?? (() => undefined)} autoDismissMs={onDismiss ? 4000 : 0} />;
}
