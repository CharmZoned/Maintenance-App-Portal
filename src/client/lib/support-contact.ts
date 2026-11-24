/**
 * Office and after-hours contact shown to people who need help outside the
 * portal: tenants waiting for account approval, tenants filing an urgent
 * request, and owners on their home page (audit UX-02).
 *
 * Values come from build-time env so the real numbers can ship without a code
 * change. Until the business confirms them, each line renders an explicit
 * "to be confirmed" placeholder rather than disappearing, so the slot, layout
 * and wording can be reviewed now.
 *
 *   VITE_SUPPORT_OFFICE_PHONE       e.g. "(555) 010-2000"
 *   VITE_SUPPORT_OFFICE_EMAIL       e.g. "office@example.com"
 *   VITE_SUPPORT_AFTER_HOURS_PHONE  e.g. "(555) 010-2999"
 */

export type SupportLine = {
  /** Visible label, e.g. "Office phone". */
  label: string;
  /** The confirmed value, or the placeholder text when not configured. */
  value: string;
  /** `tel:` / `mailto:` link when configured; null for placeholders. */
  href: string | null;
  configured: boolean;
};

export type SupportContact = {
  officePhone: SupportLine;
  officeEmail: SupportLine;
  afterHoursPhone: SupportLine;
  /** True only when every line has a confirmed value. */
  configured: boolean;
};

export type SupportContactEnv = {
  VITE_SUPPORT_OFFICE_PHONE?: string;
  VITE_SUPPORT_OFFICE_EMAIL?: string;
  VITE_SUPPORT_AFTER_HOURS_PHONE?: string;
};

export const SUPPORT_PLACEHOLDER = "To be confirmed";

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 3 ? `tel:${digits}` : null;
}

function line(
  label: string,
  raw: string | undefined,
  toHref: (value: string) => string | null,
): SupportLine {
  const value = raw?.trim();
  if (!value) return { label, value: SUPPORT_PLACEHOLDER, href: null, configured: false };
  return { label, value, href: toHref(value), configured: true };
}

export function resolveSupportContact(env: SupportContactEnv): SupportContact {
  const officePhone = line("Office phone", env.VITE_SUPPORT_OFFICE_PHONE, telHref);
  const officeEmail = line("Office email", env.VITE_SUPPORT_OFFICE_EMAIL, (v) =>
    v.includes("@") ? `mailto:${v}` : null,
  );
  const afterHoursPhone = line("After-hours line", env.VITE_SUPPORT_AFTER_HOURS_PHONE, telHref);
  return {
    officePhone,
    officeEmail,
    afterHoursPhone,
    configured: officePhone.configured && officeEmail.configured && afterHoursPhone.configured,
  };
}

export const SUPPORT_CONTACT: SupportContact = resolveSupportContact(import.meta.env);
