import { describe, expect, test } from "vitest";
import { portalStatusFromAccounts } from "@/lib/people-portal-status";
import type { UserAccountRow } from "@/lib/data";

function account(partial: Partial<UserAccountRow> & Pick<UserAccountRow, "user_id" | "account_status">): UserAccountRow {
  return {
    email: null,
    role: null,
    landlord_id: null,
    tenant_id: null,
    staff_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("portalStatusFromAccounts", () => {
  test("prefers entity id over a mismatched contact email", () => {
    const accounts = [
      account({
        user_id: "u1",
        email: "login@example.com",
        tenant_id: 42,
        account_status: "approved",
      }),
      account({
        user_id: "u2",
        email: "contact@example.com",
        account_status: "pending",
      }),
    ];
    expect(
      portalStatusFromAccounts(accounts, {
        tenantId: 42,
        email: "contact@example.com",
      }),
    ).toBe("active");
  });

  test("rejected accounts get their own chip instead of not invited", () => {
    const accounts = [
      account({
        user_id: "u3",
        email: "gone@example.com",
        landlord_id: 7,
        account_status: "rejected",
      }),
    ];
    expect(
      portalStatusFromAccounts(accounts, {
        landlordId: 7,
        email: "gone@example.com",
      }),
    ).toBe("rejected");
    expect(
      portalStatusFromAccounts(accounts, { email: "gone@example.com" }),
    ).toBe("rejected");
  });

  test("falls back to email when no entity link matches", () => {
    const accounts = [
      account({
        user_id: "u4",
        email: "staff@example.com",
        staff_id: 3,
        account_status: "pending",
      }),
    ];
    expect(
      portalStatusFromAccounts(accounts, {
        staffId: 99,
        email: "staff@example.com",
      }),
    ).toBe("pending");
  });
});
