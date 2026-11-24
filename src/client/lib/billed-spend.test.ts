import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/utils";
import { BILLED_LABEL, billedAmount, billedSpend, billedSpendText, billedYearStart } from "./billed-spend";
import type { WorkOrder } from "@/types";

const now = new Date(2026, 10, 16, 9, 30);

function order(partial: Partial<Pick<WorkOrder, "status" | "landlord_price" | "completed_at" | "created_at">>) {
  return {
    status: "closed" as WorkOrder["status"],
    landlord_price: null as number | null,
    completed_at: null as string | null,
    created_at: new Date(2026, 10, 1).toISOString(),
    ...partial,
  };
}

describe("billedSpend", () => {
  it("sums the billed price of requests completed this month and this year", () => {
    const spend = billedSpend(
      [
        order({ landlord_price: 120, completed_at: new Date(2026, 10, 10).toISOString() }),
        order({ landlord_price: 80, completed_at: new Date(2026, 2, 4).toISOString() }),
      ],
      now,
    );
    expect(spend).toEqual({ month: 120, year: 200 });
  });

  it("does not count a price on an open request (a quote, not a bill)", () => {
    const spend = billedSpend(
      [
        order({ status: "open", landlord_price: 400 }),
        order({ status: "on_hold", landlord_price: 90 }),
        order({ status: "in_progress", landlord_price: 60 }),
      ],
      now,
    );
    expect(spend).toEqual({ month: 0, year: 0 });
  });

  it("skips unpriced requests and last year's completions", () => {
    const spend = billedSpend(
      [
        order({ landlord_price: null, completed_at: new Date(2026, 10, 3).toISOString() }),
        order({ landlord_price: 500, completed_at: new Date(2025, 11, 30).toISOString() }),
        order({ landlord_price: Number.NaN, completed_at: new Date(2026, 10, 3).toISOString() }),
      ],
      now,
    );
    expect(spend).toEqual({ month: 0, year: 0 });
  });

  it("falls back to the created date when the completion date is missing", () => {
    expect(billedSpend([order({ landlord_price: 45, completed_at: null })], now)).toEqual({ month: 45, year: 45 });
  });

  it("reads the amount only from completed requests", () => {
    expect(billedAmount(order({ landlord_price: 120 }))).toBe(120);
    expect(billedAmount(order({ status: "scheduled", landlord_price: 120 }))).toBeNull();
    expect(billedAmount(order({ landlord_price: null }))).toBeNull();
  });
});

describe("billedSpendText", () => {
  it("labels the figure Billed, the same way on every page", () => {
    const text = billedSpendText({ month: 120, year: 1240 });
    expect(BILLED_LABEL).toBe("Billed");
    expect(text.month).toBe(`${formatMoney(120)} this month`);
    expect(text.year).toBe(`${formatMoney(1240)} this year`);
    expect(text.line).toBe(`Billed: ${formatMoney(120)} this month · ${formatMoney(1240)} this year`);
  });

  it("states zero instead of hiding the figure", () => {
    expect(billedSpendText({ month: 0, year: 0 }).both).toBe(`${formatMoney(0)} this month · ${formatMoney(0)} this year`);
  });

  it("starts the year at local midnight on 1 January", () => {
    expect(new Date(billedYearStart(now)).getTime()).toBe(new Date(2026, 0, 1).getTime());
  });
});
