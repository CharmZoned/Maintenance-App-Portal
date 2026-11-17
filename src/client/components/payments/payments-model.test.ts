import { describe, expect, it } from "vitest";
import type { Payment, RentCharge } from "@/types";
import {
  buildBalanceSummary,
  buildLedgerEntries,
  chargeRemaining,
  filterLedgerEntries,
  formatUsd,
  parseCustomAmount,
  roundCents,
  toLocalCalendarDate,
} from "./payments-model";

function charge(
  partial: Partial<RentCharge> &
    Pick<RentCharge, "id" | "amount" | "amount_paid" | "status" | "due_date" | "period">,
): RentCharge {
  return {
    lease_id: 1,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function payment(partial: Payment): Payment {
  return partial;
}

describe("payments-model", () => {
  it("formats USD with cents", () => {
    expect(formatUsd(2400)).toBe("$2,400.00");
    expect(formatUsd(50.5)).toBe("$50.50");
  });

  it("summarizes outstanding and past due from charges", () => {
    const charges = [
      charge({
        id: 1,
        period: "2026-11",
        due_date: "2026-11-01",
        amount: 2400,
        amount_paid: 0,
        status: "overdue",
      }),
      charge({
        id: 2,
        period: "2026-12",
        due_date: "2026-12-01",
        amount: 2400,
        amount_paid: 0,
        status: "open",
      }),
    ];
    const summary = buildBalanceSummary(charges, null, new Date(2026, 10, 17, 12, 0, 0));
    expect(summary.outstanding).toBe(4800);
    expect(summary.pastDue).toBe(2400);
    expect(summary.nextDueDate).toBe("2026-12-01");
    expect(summary.statusLine).toContain("Overdue");
    expect(summary.rentRemaining).toBe(2400);
    expect(summary.otherRemaining).toBe(2400);
    expect(summary.pending).toBeNull();
  });

  it("breakdown uses remaining after partial payment, not full lease rent", () => {
    const charges = [
      charge({
        id: 1,
        period: "2026-11",
        due_date: "2026-11-01",
        amount: 2400,
        amount_paid: 2000,
        status: "partial",
        lease_rent: 2400,
      }),
    ];
    const summary = buildBalanceSummary(
      charges,
      {
        tenant_id: 1,
        tenant_name: null,
        unit_id: 1,
        unit_label: "1A",
        property_id: 1,
        property_name: "Maple",
        street_address: null,
        late_fee_policy: 75,
      },
      new Date(2026, 10, 17),
    );
    expect(summary.outstanding).toBe(400);
    expect(summary.rentRemaining).toBe(400);
    expect(summary.otherRemaining).toBe(0);
    expect(summary.lateFeeAssessed).toBeNull();
    expect(summary.lateFeePolicy).toBe(75);
  });

  it("multi-month outstanding splits rent remaining vs other open charges", () => {
    const charges = [
      charge({
        id: 1,
        period: "2026-10",
        due_date: "2026-10-01",
        amount: 2400,
        amount_paid: 0,
        status: "overdue",
      }),
      charge({
        id: 2,
        period: "2026-11",
        due_date: "2026-11-01",
        amount: 2400,
        amount_paid: 0,
        status: "overdue",
      }),
    ];
    const summary = buildBalanceSummary(charges, null, new Date(2026, 10, 17));
    expect(summary.outstanding).toBe(4800);
    expect(summary.rentRemaining).toBe(2400);
    expect(summary.otherRemaining).toBe(2400);
  });

  it("builds newest-first ledger with running balance", () => {
    const charges = [
      charge({
        id: 10,
        period: "2026-10",
        due_date: "2026-10-01",
        amount: 1000,
        amount_paid: 1000,
        status: "paid",
      }),
    ];
    const payments = new Map<number, Payment[]>([
      [
        10,
        [
          payment({
            id: 99,
            charge_id: 10,
            paid_at: "2026-10-05T12:00:00Z",
            amount: 1000,
            method: "ach",
            reference: "ABC",
            notes: null,
          }),
        ],
      ],
    ]);
    const ledger = buildLedgerEntries(charges, payments);
    expect(ledger).toHaveLength(2);
    expect(ledger[0].kind).toBe("payment");
    expect(ledger[0].signedAmount).toBe(-1000);
    expect(ledger[0].balanceAfter).toBe(0);
    expect(ledger[1].kind).toBe("charge");
    expect(ledger[1].balanceAfter).toBe(1000);

    const paymentsOnly = filterLedgerEntries(ledger, "payments", null);
    expect(paymentsOnly).toHaveLength(1);
    expect(paymentsOnly[0].kind).toBe("payment");
  });

  it("waived charge posts signed 0 so final balance matches outstanding", () => {
    const charges = [
      charge({
        id: 1,
        period: "2026-11",
        due_date: "2026-11-01",
        amount: 1000,
        amount_paid: 0,
        status: "waived",
      }),
    ];
    const summary = buildBalanceSummary(charges, null, new Date(2026, 10, 17));
    expect(summary.outstanding).toBe(0);
    const ledger = buildLedgerEntries(charges, new Map());
    const newest = ledger[0];
    expect(newest.balanceAfter).toBe(0);
    expect(ledger.some((e) => e.kind === "charge" && e.signedAmount === 0)).toBe(true);
  });

  it("carries overpayment as account credit without clamping it away", () => {
    const charges = [
      charge({
        id: 1,
        period: "2026-11",
        due_date: "2026-11-01",
        amount: 1000,
        amount_paid: 1200,
        status: "paid",
      }),
    ];
    const summary = buildBalanceSummary(charges, null, new Date(2026, 10, 17));
    expect(summary.outstanding).toBe(0);
    expect(summary.accountCredit).toBe(200);

    const payments = new Map<number, Payment[]>([
      [
        1,
        [
          payment({
            id: 1,
            charge_id: 1,
            paid_at: "2026-11-02T15:00:00Z",
            amount: 1200,
            method: "ach",
            reference: null,
            notes: null,
          }),
        ],
      ],
    ]);
    const ledger = buildLedgerEntries(charges, payments);
    // Charge +1200? No — charge posts +1000, payment -1200 → balance -200 (credit).
    expect(ledger[0].balanceAfter).toBe(-200);
  });

  it("orders charge before its payment even when paid before due date", () => {
    const charges = [
      charge({
        id: 1,
        period: "2026-11",
        due_date: "2026-11-01",
        amount: 2400,
        amount_paid: 2400,
        status: "paid",
      }),
    ];
    const payments = new Map<number, Payment[]>([
      [
        1,
        [
          payment({
            id: 7,
            charge_id: 1,
            paid_at: "2026-10-28T18:00:00-04:00",
            amount: 2400,
            method: "ach",
            reference: null,
            notes: null,
          }),
        ],
      ],
    ]);
    const ledger = buildLedgerEntries(charges, payments);
    // Chronological ascending for balance: charge then payment → newest is payment at 0.
    expect(ledger[0].kind).toBe("payment");
    expect(ledger[0].balanceAfter).toBe(0);
    expect(ledger[1].kind).toBe("charge");
    expect(ledger[1].balanceAfter).toBe(2400);
    // Display date still the local calendar paid day.
    expect(ledger[0].date).toBe(toLocalCalendarDate("2026-10-28T18:00:00-04:00"));
  });

  it("Outstanding filter uses remaining, not status label", () => {
    const charges = [
      charge({
        id: 1,
        period: "2026-11",
        due_date: "2026-11-01",
        amount: 1000,
        amount_paid: 1000,
        status: "open", // stale label — fully paid by amount
      }),
      charge({
        id: 2,
        period: "2026-12",
        due_date: "2026-12-01",
        amount: 1000,
        amount_paid: 0,
        status: "paid", // stale label — still remaining
      }),
    ];
    // Fix second charge to have remaining despite weird status for the filter test:
    const adjusted = [
      charges[0],
      { ...charges[1], amount_paid: 0, status: "paid" as const },
    ];
    // chargeRemaining for status paid with amount_paid 0 still returns 1000
    expect(chargeRemaining(adjusted[1])).toBe(1000);
    expect(chargeRemaining(adjusted[0])).toBe(0);

    const ledger = buildLedgerEntries(adjusted, new Map());
    const outstanding = filterLedgerEntries(ledger, "outstanding", null);
    expect(outstanding.map((e) => e.chargeId)).toEqual([2]);
  });

  it("uses local calendar date for asOf (not UTC slice)", () => {
    // 20:00 America/New_York on Nov 17 is already Nov 18 UTC.
    const localEvening = new Date(2026, 10, 17, 20, 0, 0);
    const summary = buildBalanceSummary(
      [
        charge({
          id: 1,
          period: "2026-11",
          due_date: "2026-11-17",
          amount: 100,
          amount_paid: 0,
          status: "open",
        }),
      ],
      null,
      localEvening,
    );
    expect(summary.asOf).toBe("2026-11-17");
    expect(summary.nextDueDate).toBe("2026-11-17");
    expect(summary.pastDue).toBe(0);
  });

  it("parses custom amounts with clamp, cents, and errors", () => {
    expect(parseCustomAmount("", 100).error).toMatch(/Enter an amount/);
    expect(parseCustomAmount("0", 100).error).toMatch(/greater than zero/);
    expect(parseCustomAmount("10.999", 100).error).toMatch(/cents/);
    expect(parseCustomAmount("1.2.3", 100).error).toMatch(/decimal/);
    expect(parseCustomAmount("150", 100).error).toMatch(/cannot exceed/);
    expect(parseCustomAmount("10.99", 100)).toEqual({
      value: 10.99,
      error: null,
      display: "10.99",
    });
    expect(parseCustomAmount("100", 100).value).toBe(100);
    expect(roundCents(10.999)).toBe(11);
  });
});
