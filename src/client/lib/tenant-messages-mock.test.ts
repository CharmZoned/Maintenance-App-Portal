import { describe, expect, it } from "vitest";
import {
  createSyntheticRequestThread,
  loadTenantMessagesMock,
  MOCK_THREAD_IDS,
  resolveMessagesDeepLink,
  syntheticRequestThreadId,
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

  it("resolveMessagesDeepLink maps demo WO numbers and synthesizes real PKs", () => {
    const convos = TENANT_MESSAGES_MOCK.conversations;
    expect(resolveMessagesDeepLink("?request=1842", convos)).toEqual({
      kind: "request",
      requestId: "1842",
      threadId: MOCK_THREAD_IDS.leakingTap,
      synthetic: false,
    });
    expect(resolveMessagesDeepLink("?request=WO-1799", convos)).toEqual({
      kind: "request",
      requestId: "WO-1799",
      threadId: MOCK_THREAD_IDS.brokenHeater,
      synthetic: false,
    });

    // Real Requests CTA uses MaintenanceRequests primary key (numeric or uuid).
    expect(resolveMessagesDeepLink("?request=42", convos)).toEqual({
      kind: "request",
      requestId: "42",
      threadId: syntheticRequestThreadId("42"),
      synthetic: true,
    });
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(resolveMessagesDeepLink(`?request=${uuid}`, convos)).toEqual({
      kind: "request",
      requestId: uuid,
      threadId: syntheticRequestThreadId(uuid),
      synthetic: true,
    });

    expect(resolveMessagesDeepLink(`?thread=${MOCK_THREAD_IDS.parking}`, convos)).toEqual({
      kind: "thread",
      threadId: MOCK_THREAD_IDS.parking,
    });
    expect(resolveMessagesDeepLink("?thread=missing", convos)).toEqual({
      kind: "not-found",
      requestId: "missing",
    });
    // thread wins when both present
    expect(
      resolveMessagesDeepLink(
        `?request=1842&thread=${MOCK_THREAD_IDS.parking}`,
        convos,
      ),
    ).toEqual({ kind: "thread", threadId: MOCK_THREAD_IDS.parking });
  });

  it("createSyntheticRequestThread keys by request PK and links Open request", () => {
    const thread = createSyntheticRequestThread("99");
    expect(thread.id).toBe("mock:request:99");
    expect(thread.linkedRequestIds).toContain("99");
    expect(thread.openRequestPath).toBe("/maintenance?wo=99");
    expect(thread.messages).toEqual([]);
  });
});
