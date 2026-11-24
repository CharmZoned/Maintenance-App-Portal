import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_STYLES } from "@/components/patterns/status-chip";
import type { TimelineEntry } from "@/lib/request-timeline";
import { cn } from "@/lib/utils";

/**
 * Request timeline + message box (Figma "UPGRADED — Request" Timeline; brief N3).
 *
 * Entries come from buildTimeline(order, activity, messages, people, role) in
 * src/client/lib/request-timeline.ts: chronological, named, role-tagged, with
 * internal entries already removed for tenant / landlord.
 */
export interface RequestTimelineComposer {
  /** Staff only: show the "Internal only" switch (off by default). */
  showInternalToggle: boolean;
  posting?: boolean;
  /** Resolve after the message is saved; the page reloads entries. */
  onSend: (body: string, internal: boolean) => void | Promise<void>;
  placeholder?: string;
}

export interface RequestTimelineProps {
  entries: TimelineEntry[];
  /** "When" text per entry (formatActivityStamp). Injected so tests can pin it. */
  formatWhen: (iso: string) => string;
  /** null hides the composer (landlord; completed requests). */
  composer: RequestTimelineComposer | null;
  /** Shown instead of the composer when it is hidden, e.g. "Completed — reopen to reply". */
  readOnlyNote?: string;
}

export function RequestTimeline({ entries, formatWhen, composer, readOnlyNote }: RequestTimelineProps) {
  return (
    <section className="rounded-md border border-border bg-card p-4" aria-labelledby="request-timeline-heading">
      <h2 id="request-timeline-heading" className="text-sm font-semibold text-foreground">
        Timeline
      </h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No updates yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {entries.map((entry) => (
            <TimelineRow key={entry.key} entry={entry} when={formatWhen(entry.at)} />
          ))}
        </ol>
      )}
      {composer ? (
        <TimelineComposer composer={composer} />
      ) : readOnlyNote ? (
        <p className="mt-3 text-xs text-muted-foreground">{readOnlyNote}</p>
      ) : null}
    </section>
  );
}

function TimelineRow({ entry, when }: { entry: TimelineEntry; when: string }) {
  return (
    <li className={cn("flex gap-3 rounded-sm", entry.internal && "bg-muted p-2")}>
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-medium text-brand-text"
        aria-hidden
      >
        {entry.actor.initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{entry.actor.name}</span>
          <span>{entry.actor.role}</span>
          <span>· {when}</span>
          {entry.status && entry.kind === "status" ? (
            <span className={cn("rounded-sm px-1.5 py-0.5 text-[11px] font-medium", STATUS_STYLES[entry.status])}>
              {entry.status}
            </span>
          ) : null}
        </p>
        {entry.internal ? (
          <p className="text-[11px] font-medium text-muted-foreground">Internal — not visible to tenant or landlord</p>
        ) : null}
        <p className="text-sm text-foreground">{entry.text}</p>
        {entry.detail ? <p className="text-sm text-muted-foreground">{entry.detail}</p> : null}
      </div>
    </li>
  );
}

function TimelineComposer({ composer }: { composer: RequestTimelineComposer }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const send = async () => {
    const text = body.trim();
    if (!text) return;
    await composer.onSend(text, composer.showInternalToggle && internal);
    setBody("");
    setInternal(false);
  };
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={composer.placeholder ?? "Write a message…"}
        rows={2}
        aria-label="Message"
      />
      <div className="flex items-center justify-between gap-2">
        {composer.showInternalToggle ? (
          <button
            type="button"
            role="switch"
            aria-checked={internal}
            onClick={() => setInternal((v) => !v)}
            className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                internal ? "bg-brand" : "bg-border",
              )}
              aria-hidden
            >
              <span className={cn("size-3 rounded-full bg-card transition-transform", internal && "translate-x-3")} />
            </span>
            Internal only
          </button>
        ) : (
          <span />
        )}
        <Button size="touch" disabled={composer.posting || !body.trim()} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </div>
  );
}
