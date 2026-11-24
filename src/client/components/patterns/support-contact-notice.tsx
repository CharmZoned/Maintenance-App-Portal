import { SUPPORT_CONTACT, type SupportContact, type SupportLine } from "@/lib/support-contact";
import { cn } from "@/lib/utils";

/** The one emergency sentence, used wherever urgent help is shown. */
export const EMERGENCY_LINE =
  "Immediate danger, like fire, gas or flooding? Contact local emergency services first.";

type Audience = "tenant" | "owner";

function urgentSentence(audience: Audience): string {
  return audience === "owner"
    ? "for an urgent issue at one of your properties, contact the office:"
    : "for an urgent repair, don't wait for a portal reply. Contact the office:";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Where to go for urgent help when the portal isn't the right channel
 * (audit UX-02). One component so registration, Tenant Home and the request
 * form always show the same contact and the same emergency wording.
 *
 * - `urgent`: warning box with every contact line (pending-access screens,
 *   Emergency requests).
 * - `compact`: two short lines for forms where the full box would push the
 *   primary action below the fold.
 * - `list`: plain contact lines for support cards.
 */
export function SupportContactNotice({
  variant,
  lead,
  audience = "tenant",
  contact = SUPPORT_CONTACT,
  className,
}: {
  variant: "urgent" | "compact" | "list";
  /** Optional opening clause, e.g. "While your account is pending,". */
  lead?: string;
  audience?: Audience;
  contact?: SupportContact;
  className?: string;
}) {
  const lines = (
    <dl className="space-y-0.5">
      <ContactLine line={contact.officePhone} />
      <ContactLine line={contact.afterHoursPhone} />
      <ContactLine line={contact.officeEmail} />
    </dl>
  );

  if (variant === "list") {
    return <div className={cn("text-sm leading-[1.375rem]", className)}>{lines}</div>;
  }

  if (variant === "compact") {
    return (
      <aside
        role="note"
        aria-label="Urgent help"
        className={cn(
          "rounded-sm border border-border bg-warning-tint px-3 py-2 text-xs leading-[1.125rem] text-warning",
          className,
        )}
      >
        <p className="font-medium">{EMERGENCY_LINE}</p>
        <p className="mt-0.5 text-foreground">
          Urgent repair? Call the office: <ContactValue line={contact.officePhone} /> · After hours:{" "}
          <ContactValue line={contact.afterHoursPhone} />
        </p>
      </aside>
    );
  }

  const sentence = urgentSentence(audience);
  return (
    <aside
      role="note"
      aria-label="Urgent help"
      className={cn(
        "rounded-sm border border-border bg-warning-tint px-4 py-3 text-sm leading-[1.375rem] text-warning",
        className,
      )}
    >
      <p className="font-medium">{EMERGENCY_LINE}</p>
      <p className="mt-1 text-foreground">{lead ? `${lead} ${sentence}` : capitalize(sentence)}</p>
      <div className="mt-1.5 text-foreground">{lines}</div>
    </aside>
  );
}

function ContactValue({ line }: { line: SupportLine }) {
  if (!line.configured) return <span className="italic text-muted-foreground">{line.value}</span>;
  if (!line.href) return <span className="font-medium">{line.value}</span>;
  return (
    <a href={line.href} className="font-medium text-brand-text underline-offset-2 hover:underline">
      {line.value}
    </a>
  );
}

function ContactLine({ line }: { line: SupportLine }) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      <dt className="text-muted-foreground">{line.label}:</dt>
      <dd>
        <ContactValue line={line} />
      </dd>
    </div>
  );
}
