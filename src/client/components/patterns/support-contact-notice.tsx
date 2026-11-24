import { SUPPORT_CONTACT, type SupportContact, type SupportLine } from "@/lib/support-contact";
import { cn } from "@/lib/utils";

/**
 * Where to go for urgent help when the portal isn't the right channel
 * (audit UX-02). One component so registration, Tenant Home and the request
 * form always show the same contact and the same emergency wording.
 *
 * - `urgent`: warning strip for request forms and pending-access screens.
 * - `list`: plain contact lines for support cards.
 */
export function SupportContactNotice({
  variant,
  lead,
  contact = SUPPORT_CONTACT,
  className,
}: {
  variant: "urgent" | "list";
  /** Optional opening clause, e.g. "While your account is pending,". */
  lead?: string;
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

  return (
    <aside
      role="note"
      aria-label="Urgent help"
      className={cn(
        "rounded-sm border border-border bg-warning-tint px-4 py-3 text-sm leading-[1.375rem] text-warning",
        className,
      )}
    >
      <p className="font-medium">
        Immediate danger, like fire, gas or flooding? Contact local emergency services first.
      </p>
      <p className="mt-1 text-foreground">
        {lead ? `${lead} for` : "For"} an urgent repair, don&apos;t wait for a portal reply. Contact
        the office:
      </p>
      <div className="mt-1.5 text-foreground">{lines}</div>
    </aside>
  );
}

function ContactLine({ line }: { line: SupportLine }) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      <dt className="text-muted-foreground">{line.label}:</dt>
      <dd className={line.configured ? "font-medium" : "italic text-muted-foreground"}>
        {line.href ? (
          <a href={line.href} className="text-brand-text underline-offset-2 hover:underline">
            {line.value}
          </a>
        ) : (
          line.value
        )}
      </dd>
    </div>
  );
}
