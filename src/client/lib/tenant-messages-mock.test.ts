import { describe, expect, it } from "vitest";
import {
  loadTenantMessagesMock,
  MOCK_THREAD_IDS,
  TENANT_MESSAGES_MOCK,
  unreadCount,
} from "./tenant-messages-mock";

describe("tenant-messages-mock", () => {
  it("exposes Figma demo threads with unread counts", () => {
    expect(TENANT_MESSAGES_MOCK.conversations.map((c) => c.id)).toEqual([
      MOCK_THREAD_IDS.unitHome,
      MOCK_THREAD_IDS.leakingTap,
      MOCK_THREAD_IDS.parking,
      MOCK_THREAD_IDS.brokenHeater,
    ]);
    expect(unreadCount(TENANT_MESSAGES_MOCK.conversations)).toBe(2);
  });

  it("loadTenantMessagesMock returns a deep copy for ok", async () => {
    const bundle = await loadTenantMessagesMock({ scenario: "ok", delayMs: 0 });
    expect(bundle.conversations).toHaveLength(4);
    bundle.conversations[0]!.title = "mutated";
    expect(TENANT_MESSAGES_MOCK.conversations[0]!.title).toBe("Unit 4B · Oak Street");
  });

  it("loadTenantMessagesMock supports empty and error scenarios", async () => {
    const empty = await loadTenantMessagesMock({ scenario: "empty", delayMs: 0 });
    expect(empty.conversations).toEqual([]);
    await expect(
      loadTenantMessagesMock({ scenario: "error", delayMs: 0 }),
    ).rejects.toThrow(/Messages aren.t connected/i);
  });
});
