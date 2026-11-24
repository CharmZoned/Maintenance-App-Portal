import { describe, expect, it } from "vitest";
import {
  buildInbox,
  countUnreadConversations,
  isConversationUnread,
  requestReadThread,
  type OfficeMessageRow,
  type RequestCommentRow,
} from "../../src/client/lib/inbox";

const T = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 20, hour, minute)).toISOString();

describe("isConversationUnread — the one unread rule", () => {
  it("is unread when someone outside the office wrote and nobody has read or answered", () => {
    expect(isConversationUnread([{ at: T(9), fromOffice: false, readAt: null }])).toBe(true);
  });

  it("is read once this admin opened it after the message", () => {
    expect(isConversationUnread([{ at: T(9), fromOffice: false, readAt: T(10) }])).toBe(false);
    // Read exactly through the latest message (the timestamp the app records).
    expect(isConversationUnread([{ at: T(9), fromOffice: false, readAt: T(9) }])).toBe(false);
  });

  it("is answered — so not unread — when any admin replied after it", () => {
    expect(
      isConversationUnread([
        { at: T(9), fromOffice: false, readAt: null },
        { at: T(10), fromOffice: true, readAt: null },
      ]),
    ).toBe(false);
  });

  it("is unread again when they write after the office's reply", () => {
    expect(
      isConversationUnread([
        { at: T(9), fromOffice: false, readAt: T(9) },
        { at: T(10), fromOffice: true, readAt: T(9) },
        { at: T(11), fromOffice: false, readAt: T(9) },
      ]),
    ).toBe(true);
  });

  it("never counts the office's own messages", () => {
    expect(isConversationUnread([{ at: T(9), fromOffice: true, readAt: null }])).toBe(false);
    expect(isConversationUnread([])).toBe(false);
  });

  it("counts conversations, not messages", () => {
    expect(countUnreadConversations([{ unread: true }, { unread: false }, { unread: true }])).toBe(2);
  });
});

describe("buildInbox", () => {
  const office = (id: number, thread: string, role: OfficeMessageRow["author_role"], at: string, body = `m${id}`): OfficeMessageRow => ({
    id,
    created_at: at,
    thread_user_id: thread,
    author_user_id: role === "admin" ? "u-admin" : thread,
    author_role: role,
    body,
  });
  const comment = (
    id: number,
    request: number,
    role: RequestCommentRow["author_role"],
    at: string,
    visibility: "tenant_visible" | "internal" = "tenant_visible",
  ): RequestCommentRow => ({
    id,
    created_at: at,
    maintenance_request_id: request,
    author_user_id: `u-${role}`,
    author_role: role,
    author_tenant_id: role === "tenant" ? 7 : null,
    author_staff_id: role === "maintenance" ? 3 : null,
    visibility,
    body: `c${id}`,
  });

  it("groups both kinds into conversations, newest first, with the shared unread rule", () => {
    const inbox = buildInbox({
      officeMessages: [
        office(1, "u-sam", "maintenance", T(8)),
        office(2, "u-sam", "admin", T(8, 30)), // answered
        office(3, "u-lena", "landlord", T(7)),
      ],
      officeReads: [],
      comments: [
        comment(10, 5, "tenant", T(9)),
        comment(11, 6, "maintenance", T(6)),
      ],
      requestReads: [{ maintenance_request_id: 6, thread: "shared", last_read_at: T(6, 5) }],
    });
    expect(inbox.map((c) => [c.key, c.unread])).toEqual([
      ["wo:5", true],
      ["office:u-sam", false],
      ["office:u-lena", true],
      ["wo:6", false],
    ]);
    expect(inbox[0]).toMatchObject({ kind: "request", requestId: 5, last: { body: "c10", authorRole: "tenant", authorTenantId: 7 } });
    expect(inbox[1]).toMatchObject({ kind: "office", threadUserId: "u-sam", last: { body: "m2", authorRole: "admin" } });
    expect(countUnreadConversations(inbox)).toBe(2);
  });

  it("reads an internal comment against the admin's office-thread read, and a shared one against the shared read", () => {
    const comments = [comment(1, 9, "maintenance", T(9), "internal"), comment(2, 9, "tenant", T(8), "tenant_visible")];
    const onlySharedRead = buildInbox({
      officeMessages: [],
      officeReads: [],
      comments,
      requestReads: [{ maintenance_request_id: 9, thread: "shared", last_read_at: T(10) }],
    });
    expect(onlySharedRead[0].unread).toBe(true);
    const bothRead = buildInbox({
      officeMessages: [],
      officeReads: [],
      comments,
      requestReads: [
        { maintenance_request_id: 9, thread: "shared", last_read_at: T(10) },
        { maintenance_request_id: 9, thread: "office", last_read_at: T(10) },
      ],
    });
    expect(bothRead[0].unread).toBe(false);
    expect(requestReadThread("internal")).toBe("office");
    expect(requestReadThread("tenant_visible")).toBe("shared");
  });

  it("uses the office thread's read row", () => {
    const inbox = buildInbox({
      officeMessages: [office(1, "u-raj", "tenant", T(9))],
      officeReads: [{ thread_user_id: "u-raj", last_read_at: T(9, 1) }],
      comments: [],
      requestReads: [],
    });
    expect(inbox[0].unread).toBe(false);
  });
});
