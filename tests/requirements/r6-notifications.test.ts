/**
 * R6 — Notifications
 * Email / push notifications and messaging.
 *
 * Deferred (docs/phases/phase-6.md): nothing is built yet, so every check here
 * is a placeholder. Turn each `test.todo` into a real test as the feature lands
 * — the dashboard counts them as "planned" until then.
 */
import { describe, test } from "vitest";

describe("[R6] Notifications", () => {
  describe("email alerts", () => {
    test.todo("staff with alerts switched on are emailed when a tenant submits a request");
    test.todo("staff with alerts switched off are not emailed");
    test.todo("the assigned worker is emailed when a request is assigned to them");
    test.todo("the tenant is emailed when their request changes status");
    test.todo("each event sends exactly one email (no duplicates on retry)");
  });

  describe("in-app notifications", () => {
    test.todo("a user sees a list of their unread notifications");
    test.todo("opening a notification marks it read");
  });

  describe("messaging", () => {
    test.todo("staff and a tenant can exchange messages in a thread");
    test.todo("a tenant cannot read another tenant's thread");
  });

  describe("push", () => {
    test.todo("a mobile device receives a push when a request it follows changes");
  });
});
