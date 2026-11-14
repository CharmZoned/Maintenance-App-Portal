import { describe, expect, it } from "vitest";
import { feedbackForGenerateCharges } from "./generate-charges-feedback";

describe("feedbackForGenerateCharges", () => {
  it("surfaces thrown failures as an error toast", () => {
    expect(feedbackForGenerateCharges(null, new Error("insert denied"))).toEqual({
      kind: "error",
      message: "insert denied",
    });
  });

  it("falls back when the thrown value is not an Error", () => {
    expect(feedbackForGenerateCharges(null, "boom")).toEqual({
      kind: "error",
      message: "Could not generate charges.",
    });
  });

  it("toasts a success notice with pluralization", () => {
    expect(
      feedbackForGenerateCharges({ created: 1, periodLabel: "June 2098" }, null),
    ).toEqual({
      kind: "notice",
      message: "Created 1 charge for June 2098.",
    });
    expect(
      feedbackForGenerateCharges({ created: 3, periodLabel: "June 2098" }, null),
    ).toEqual({
      kind: "notice",
      message: "Created 3 charges for June 2098.",
    });
  });

  it("toasts an informational notice when every lease already has a charge", () => {
    expect(
      feedbackForGenerateCharges({ created: 0, periodLabel: "June 2098" }, null),
    ).toEqual({
      kind: "notice",
      message: "All active leases already have a charge for this period.",
    });
  });
});
