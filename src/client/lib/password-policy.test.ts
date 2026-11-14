import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "./password-policy";

describe("password-policy", () => {
  it("keeps UI minimum at least 8 (aligned with Auth policy target)", () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
  });
});
