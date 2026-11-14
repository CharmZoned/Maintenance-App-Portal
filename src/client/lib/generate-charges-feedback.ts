/** Toast/banner copy for Rent → Generate charges (WS-N soft-fail leftover). */

export type GenerateChargesFeedback =
  | { kind: "notice"; message: string }
  | { kind: "error"; message: string };

/**
 * Map generateCharges success / soft outcomes / thrown failures to the
 * portal’s NoticeBanner (green) or ErrorBanner (red) toast slots.
 */
export function feedbackForGenerateCharges(
  result: { created: number; periodLabel: string } | null,
  error: unknown,
): GenerateChargesFeedback {
  if (error != null) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Could not generate charges.";
    return { kind: "error", message };
  }
  const created = result?.created ?? 0;
  if (created > 0) {
    const noun = created === 1 ? "charge" : "charges";
    return {
      kind: "notice",
      message: `Created ${created} ${noun} for ${result!.periodLabel}.`,
    };
  }
  return {
    kind: "notice",
    message: "All active leases already have a charge for this period.",
  };
}
