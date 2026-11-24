/**
 * Office verification of Zelle payments that tenants report from the portal.
 *
 * A tenant's "I sent it" leaves a `PaymentIntents` row in `zelle_reported`; the
 * money is not on the ledger until an admin confirms it with
 * `confirm_zelle_payment`, which records a Payment against the charge.
 */
import { supabase } from "./supabase";
import { listPaymentsAwaitingVerification, type PaymentAwaitingVerification } from "./data";

function throwSb(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

/** A reported Zelle payment with what the office needs to match it to the bank. */
export interface ReportedZellePayment extends PaymentAwaitingVerification {
  /** Who reported it (the intent's tenant; falls back to the charge's tenant). */
  payer_name: string | null;
  /** The memo reference the portal gave the tenant ("LG-<charge>-<intent>"). */
  client_reference: string | null;
  /** The bank confirmation text the tenant typed in, when they supplied one. */
  bank_confirmation_ref: string | null;
}

function fullName(first?: string | null, last?: string | null): string | null {
  const name = [first, last]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || null;
}

/**
 * Every reported Zelle payment the office has not confirmed, oldest report
 * first, across all periods. RLS decides which rows the caller can read.
 */
export async function listReportedZellePayments(): Promise<ReportedZellePayment[]> {
  const awaiting = await listPaymentsAwaitingVerification();
  if (awaiting.length === 0) return [];

  const [refs, tenants] = await Promise.all([
    supabase
      .from("PaymentIntents")
      .select("id, client_reference, bank_confirmation_ref")
      .in(
        "id",
        awaiting.map((p) => p.id),
      ),
    supabase
      .from("Tenants")
      .select("id, first_name, last_name")
      .in("id", [...new Set(awaiting.map((p) => p.tenant_id))]),
  ]);
  if (refs.error) throwSb(refs.error, "Could not load payment references");
  // Names are a nicety: a caller who cannot read the tenant still gets the charge's tenant.
  const refById = new Map((refs.data ?? []).map((r) => [r.id, r]));
  const nameById = new Map((tenants.data ?? []).map((t) => [t.id, fullName(t.first_name, t.last_name)]));

  return awaiting.map((p) => ({
    ...p,
    payer_name:
      nameById.get(p.tenant_id) ?? fullName(p.charge?.tenant_first_name, p.charge?.tenant_last_name),
    client_reference: refById.get(p.id)?.client_reference?.trim() || null,
    bank_confirmation_ref: refById.get(p.id)?.bank_confirmation_ref?.trim() || null,
  }));
}

/** What `confirm_zelle_payment` leaves behind. */
export interface ConfirmedZellePayment {
  intent_id: number;
  charge_id: number;
  amount: number;
  /** "succeeded" once the payment is on the ledger. */
  status: string;
  /** The `Payments` row the confirmation recorded. */
  payment_id: number | null;
}

/**
 * Admin confirms a reported Zelle payment: records a Payment (method "zelle")
 * for the intent's amount against its charge, recomputes the charge's
 * amount_paid / status, and marks the intent succeeded. Admin-only; the
 * database refuses everyone else, and refuses an amount larger than what the
 * charge still owes.
 */
export async function confirmZellePayment(
  intentId: number,
  notes?: string | null,
): Promise<ConfirmedZellePayment> {
  const trimmed = notes?.trim();
  const { data, error } = await supabase.rpc("confirm_zelle_payment", {
    p_intent_id: intentId,
    // Omitted when blank so the database writes its own default note.
    ...(trimmed ? { p_notes: trimmed } : {}),
  });
  if (error) throwSb(error, "Could not confirm the Zelle payment");
  if (!data) throw new Error("Could not confirm the Zelle payment");
  return {
    intent_id: data.id,
    charge_id: data.charge_id,
    amount: Number(data.amount),
    status: data.status,
    payment_id: data.payment_id,
  };
}
