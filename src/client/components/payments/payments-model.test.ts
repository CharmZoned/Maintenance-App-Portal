import { describe, expect, it } from "vitest";
import type { Payment, RentCharge } from "@/types";
import {
  buildBalanceSummary,
  buildLedgerEntries,
  filterLedgerEntries,
  formatUsd,
} from "./payments-model";

function charge(partial: Partial<RentCharge> & Pick<RentCharge, "id" | "amount" | "amount_paid" | "status" | "due_date" | "period">): RentCharge {
  return {
    lease_id: 1,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
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
    const summary = buildBalanceSummary(charges, null, new Date("2026-11-17T12:00:00"));
    expect(summary.outstanding).toBe(4800);
    expect(summary.pastDue).toBe(2400);
    expect(summary.nextDueDate).toBe("2026-12-01");
    expect(summary.statusLine).toContain("Overdue");
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
          {
            id: 99,
            charge_id: 10,
            paid_at: "2026-10-05T12:00:00Z",
            amount: 1000,
            method: "ach",
            reference: "ABC",
            notes: null,
          },
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
});
