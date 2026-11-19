/**
 * Price fields on the admin work order form.
 * A save must never delete a stored price by accident or save a mistyped value.
 */
import { describe, expect, test } from "vitest";
import { changedPriceFields, parsePriceInput } from "@/components/maintenance/work-order-status";

describe("parsePriceInput", () => {
  test("accepts plain amounts of 0 or more, with up to two decimals", () => {
    expect(parsePriceInput("140")).toEqual({ ok: true, value: 140 });
    expect(parsePriceInput(" 140.5 ")).toEqual({ ok: true, value: 140.5 });
    expect(parsePriceInput("0")).toEqual({ ok: true, value: 0 });
  });

  test("blank means no price", () => {
    expect(parsePriceInput("")).toEqual({ ok: true, value: null });
    expect(parsePriceInput("   ")).toEqual({ ok: true, value: null });
  });

  test.each(["12abc", "-5", "1e3", "12.345", "abc", "1,200", ".", "Infinity", "NaN"])(
    "rejects %s instead of guessing a number",
    (raw) => {
      expect(parsePriceInput(raw)).toEqual({ ok: false });
    },
  );
});

describe("changedPriceFields", () => {
  const stored = { worker_price: 140, landlord_price: 190 };

  test("sends nothing when neither field was touched", () => {
    expect(changedPriceFields({ workerPrice: "140", landlordPrice: "190" }, stored)).toEqual({});
  });

  test("sends only the field that changed", () => {
    expect(changedPriceFields({ workerPrice: "150", landlordPrice: "190" }, stored)).toEqual({ worker_price: 150 });
    expect(changedPriceFields({ workerPrice: "140", landlordPrice: "210.50" }, stored)).toEqual({
      landlord_price: 210.5,
    });
  });

  test("a blank field that was already empty is not sent, so nothing is deleted", () => {
    expect(
      changedPriceFields({ workerPrice: "", landlordPrice: "" }, { worker_price: null, landlord_price: null }),
    ).toEqual({});
    expect(
      changedPriceFields({ workerPrice: "140", landlordPrice: "" }, { worker_price: 140, landlord_price: null }),
    ).toEqual({});
  });

  test("clearing a price that was set is an explicit removal", () => {
    expect(changedPriceFields({ workerPrice: "140", landlordPrice: "" }, stored)).toEqual({ landlord_price: null });
  });

  test("an invalid value stops the save with a message naming the field", () => {
    expect(() => changedPriceFields({ workerPrice: "12abc", landlordPrice: "190" }, stored)).toThrow(/Worker price/);
    expect(() => changedPriceFields({ workerPrice: "140", landlordPrice: "-1" }, stored)).toThrow(/Landlord price/);
  });
});
