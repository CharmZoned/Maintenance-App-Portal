import { useId, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_STYLES } from "@/components/patterns/status-chip";
import type { TimelineEntry } from "@/lib/request-timeline";
import { cn } from "@/lib/utils";

/**
 * Request timeline + message box (Figma "UPGRADED — Request" Timeline; spec §2.4).
 *
 * Entries come from buildTimeline(order, activity, messages, people, role) in
 * src/client/lib/request-timeline.ts: oldest first, each at its own time,
 * named, role-tagged, plain-language, with internal entries already removed
 * for tenant / landlord.
 *
 *   - Event (reported / status change): dot marker, sentence, then
 *     "time · role tag" and the status tag.
 *   - Message: 24px initials avatar, "Name · Role · time", then the text.
 *   - Internal note: the message inside a warning-tinted box headed
 *     "Internal — not visible to tenant or landlord".
 *   - Composer: staff get an "Internal only" switch (off by default; replaces
 *     the old "Visible to tenant" checkbox); the tenant replies here on the page.
 */
export interface RequestTimelineComposer {
  /** Staff only: show the "Internal only" switch (off by default). */
  showInternalToggle: boolean;
  posting?: boolean;
  /**
   * Save the message; the page reloads entries and shows the banner. Reject
   * (throw) on failure and the typed text is kept.
   */
  onSend: (body: string, internal: boolean) => void | Promise<void>;
  placeholder?: string;
}

export interface RequestTimelineProps {
  entries: TimelineEntry[];
  /** "When" text per entry (formatActivityStamp). Injected so tests can pin it. */
  formatWhen: (iso: string) => string;
  /** null hides the composer (landlord; completed requests). */
  composer: RequestTimelineComposer | null;
  /**
   * Shown as a locked strip in place of the composer, e.g.
   * "This request is completed. Messages are closed."
   */
  readOnlyNote?: string;
  /** Admin on a completed request: a secondary "Reopen" button in the locked strip. */
  onReopen?: () => void;
  reopenBusy?: boolean;
  /**
   * Phone: the page draws the message box in its sticky bottom bar instead
   * (spec §4), so the card shows it from tablet up only.
   */
  composerOnPhone?: boolean;
}

export function RequestTimeline({
  entries,
  formatWhen,
  composer,
  readOnlyNote,
  onReopen,
  reopenBusy,
  composerOnPhone = true,
}: RequestTimelineProps) {
  return (
    <section
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 md:p-5"
      aria-labelledby="request-timeline-heading"
    >
      <h2 id="request-timeline-heading" className="text-[17px] font-semibold leading-[22px] text-foreground">
        Timeline
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm leading-5 text-muted-foreground">No updates yet.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {entries.map((entry) => (
            <TimelineRow key={entry.key} entry={entry} when={formatWhen(entry.at)} />
          ))}
        </ol>
      )}
      {composer ? (
        <div className={composerOnPhone ? undefined : "hidden md:block"}>
          <RequestComposer composer={composer} />
        </div>
      ) : readOnlyNote ? (
        <div className="flex items-center gap-2 rounded-sm bg-muted px-3 py-2.5">
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 text-sm leading-5 text-muted-foreground">{readOnlyNote}</p>
          {onReopen ? (
            <Button
              type="button"
              variant="secondary"
              className="max-md:h-11 max-md:px-4"
              disabled={reopenBusy}
              onClick={onReopen}
            >
              Reopen
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TimelineRow({ entry, when }: { entry: TimelineEntry; when: string }) {
  return entry.kind === "message" ? <MessageRow entry={entry} when={when} /> : <EventRow entry={entry} when={when} />;
}

/** "Name · Role" — the tag is left out when it would repeat the name ("Landlord Gopher"). */
function roleTagFor(entry: TimelineEntry): string | null {
  return entry.actor.role === entry.actor.name ? null : entry.actor.role;
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-medium leading-none text-foreground"
      aria-hidden
    >
      {initials}
    </span>
  );
}

function Dot() {
  return (
    <span className="flex h-5 w-6 shrink-0 items-center justify-center" aria-hidden>
      <span className="size-1.5 rounded-full bg-faint" />
    </span>
  );
}

function EventRow({ entry, when }: { entry: TimelineEntry; when: string }) {
  const tag = roleTagFor(entry);
  return (
    <li className="flex gap-3">
      <Dot />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm leading-5 text-foreground">{entry.text}</p>
        {entry.detail ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-5 text-muted-foreground">{entry.detail}</p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-4 text-muted-foreground">
          <time dateTime={entry.at}>{when}</time>
          {tag ? (
            <>
              <span aria-hidden>·</span>
              <span>{tag}</span>
            </>
          ) : null}
          {entry.internal ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 font-medium text-warning">
                <Lock className="size-3" aria-hidden />
                Internal
              </span>
            </>
          ) : null}
          {entry.status ? (
            <span
              className={cn(
                "ml-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-4",
                STATUS_STYLES[entry.status],
              )}
            >
              {entry.status}
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function MessageRow({ entry, when }: { entry: TimelineEntry; when: string }) {
  const tag = roleTagFor(entry);
  const who = (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm leading-5">
      <span className="font-medium text-foreground">{entry.actor.name}</span>
      {tag ? (
        <>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="text-muted-foreground">{tag}</span>
        </>
      ) : null}
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <time className="text-muted-foreground" dateTime={entry.at}>
        {when}
      </time>
    </p>
  );
  const text = (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-[22px] text-foreground">{entry.text}</p>
  );
  return (
    <li className="flex gap-3">
      <Avatar initials={entry.actor.initials} />
      {entry.internal ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-sm bg-warning-tint p-3">
          <p className="flex items-center gap-1 text-xs font-medium leading-4 text-warning">
            <Lock className="size-3 shrink-0" aria-hidden />
            Internal — not visible to tenant or landlord
          </p>
          <div className="flex flex-col gap-0.5">
            {who}
            {text}
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {who}
          {text}
        </div>
      )}
    </li>
  );
}

function InternalSwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          // 36×20 track; the padding around it keeps a 44px tap target on phone.
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
          "before:absolute before:-inset-3 before:content-[''] md:before:-inset-1",
          checked ? "bg-primary" : "bg-muted shadow-edge",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full bg-card shadow-edge transition-transform duration-150",
            checked && "translate-x-4",
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm leading-5 text-foreground">
        Internal only
      </label>
    </div>
  );
}

/**
 * The message box. `variant="bar"` is the phone sticky bar (no top rule, 44px
 * controls); the default sits at the bottom of the Timeline card.
 */
export function RequestComposer({
  composer,
  variant = "card",
}: {
  composer: RequestTimelineComposer;
  variant?: "card" | "bar";
}) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const busy = sending || !!composer.posting;

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setSending(true);
    try {
      await composer.onSend(text, composer.showInternalToggle && internal);
      setBody("");
      setInternal(false);
    } catch {
      // The page shows "Couldn't send your message. Try again."; keep the text.
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className={cn("flex flex-col gap-2", variant === "card" && "border-t border-border pt-4")}
      onSubmit={(e) => void send(e)}
    >
      {composer.showInternalToggle ? <InternalSwitch checked={internal} onChange={setInternal} /> : null}
      <div className="flex gap-2">
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={composer.placeholder ?? (internal ? "Write an internal note…" : "Write a message…")}
          aria-label={internal ? "Internal note" : "Message"}
          className="flex-1 max-md:h-11"
        />
        <Button type="submit" className="max-md:h-11 max-md:px-4" disabled={busy || !body.trim()}>
          Send
        </Button>
      </div>
    </form>
  );
}
