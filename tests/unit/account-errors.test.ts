import { describe, expect, test } from "vitest";
import { friendlyAccountError } from "@/lib/account-errors";

describe("friendlyAccountError", () => {
  test("rewrites raw constraint names into plain language", () => {
    expect(
      friendlyAccountError(
        'new row for relation "user_roles" violates check constraint "user_roles_subject_matches_role"',
      ),
    ).toMatch(/needs a linked record/i);
    expect(friendlyAccountError('duplicate key value violates unique constraint "user_roles_one_tenant"')).toBe(
      "That Tenant record is already linked to another login.",
    );
    expect(friendlyAccountError("Cannot clear Landlord link while approved; suspend or reject first")).toMatch(
      /stay linked to a Landlord record/,
    );
  });

  test("explains unconfirmed email, last admin and network failures", () => {
    expect(friendlyAccountError("Email must be confirmed before approving")).toMatch(/confirmed their email/);
    expect(friendlyAccountError("Cannot remove the last approved admin")).toMatch(/last admin/);
    expect(friendlyAccountError("TypeError: Failed to fetch")).toMatch(/Can't reach the server/);
  });

  test("passes through messages that are already written for people", () => {
    const msg = "That Staff record is already linked to another login (sam@x.test)";
    expect(friendlyAccountError(msg)).toBe(msg);
    expect(friendlyAccountError("")).toMatch(/Something went wrong/);
  });
});
