import { describe, expect, it } from "vitest";
import type { InboxConversation } from "../../src/client/lib/inbox";
import {
  buildNotifications,
  conversationsToMarkRead,
  READ_ALL_KEY,
  type NotificationRequestRow,
  type NotificationViewer,
  type StatusEventRow,
} from "../../src/client/lib/notifications";

const now = new Date("2026-11-24T15:00:00Z");
const H = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();

const tina: NotificationViewer = { role: "tenant", userId: "u-tina", tenantId: 7, staffId: null };
const sam: NotificationViewer = { role: "maintenance", userId: "u-sam", tenantId: null, staffId: 3 };
const lena: NotificationViewer = { role: "landlord", userId: "u-lena", tenantId: null, staffId: null };
const admin: NotificationViewer = { role: "admin", userId: "u-admin", tenantId: null, staffId: null };

const request = (partial: Partial<NotificationRequestRow> & Pick<NotificationRequestRow, "id" | "title">): NotificationRequestRow => ({
  priority: "Normal",
  created_at: H(48),
  scheduled_for: null,
  submitted_by_tenant_id: 7,
  assigned_staff_id: 3,
  property_id: 1,
  ...partial,
});

const event = (
  id: number,
  requestId: number,
  to: string,
  hoursAgo: number,
  by: { user: string; role: StatusEventRow["changed_by_role"] } = { user: "u-admin", role: "admin" },
): StatusEventRow => ({
  id,
  created_at: H(hoursAgo),
  maintenance_request_id: requestId,
  from_status: "Open",
  to_status: to,
  changed_by_user_id: by.user,
  changed_by_role: by.role,
});

const tap = request({ id: 5, title: "Kitchen tap" });

function build(viewer: NotificationViewer, input: Partial<Parameters<typeof buildNotifications>[0]> = {}) {
  return buildNotifications({
    viewer,
    inbox: [],
    statusEvents: [],
    urgent: [],
    requests: [tap],
    reads: [],
    now,
    ...input,
  });
}

describe("buildNotifications — the bell, from real events", () => {
  it("tells a tenant about their own request in the second person", () => {
    const items = build(tina, {
      statusEvents: [
        event(1, 5, "Scheduled", 30),
        event(2, 5, "In Progress", 20, { user: "u-sam", role: "maintenance" }),
        event(3, 5, "Closed", 10, { user: "u-sam", role: "maintenance" }),
      ],
    });
    expect(items.map((i) => i.sentence)).toEqual([
      "Your request “Kitchen tap” was completed",
      "Work started on your request “Kitchen tap”",
      "Your request “Kitchen tap” is booked",
    ]);
    expect(items.every((i) => i.unread && i.href === "/maintenance/5")).toBe(true);
  });

  it("never tells someone about their own change, and skips the creation row", () => {
    const items = build(sam, {
      statusEvents: [
        event(1, 5, "In Progress", 5, { user: "u-sam", role: "maintenance" }),
        { ...event(2, 5, "Open", 4), from_status: null },
      ],
    });
    expect(items).toEqual([]);
  });

  it("turns new messages from the other side into rows that share the conversation's read state", () => {
    const fromTech: InboxConversation = {
      key: "wo:5",
      kind: "request",
      requestId: 5,
      unread: true,
      last: { at: H(1), body: "On my way now", authorRole: "maintenance", authorUserId: "u-sam", authorTenantId: null, authorStaffId: 3 },
    };
    const office: InboxConversation = {
      key: "office:u-tina",
      kind: "office",
      threadUserId: "u-tina",
      unread: false,
      last: { at: H(3), body: "Your rent receipt is ready.", authorRole: "admin", authorUserId: "u-admin", authorTenantId: null, authorStaffId: null },
    };
    const mine: InboxConversation = {
      key: "wo:6",
      kind: "request",
      requestId: 6,
      unread: false,
      last: { at: H(2), body: "Thanks", authorRole: "tenant", authorUserId: "u-tina", authorTenantId: 7, authorStaffId: null },
    };
    const items = build(tina, { inbox: [fromTech, office, mine] });
    expect(items).toMatchObject([
      {
        id: "msg:wo:5",
        sentence: "Your technician replied on your request “Kitchen tap”",
        detail: "On my way now",
        unread: true,
        href: "/messages?thread=wo%3A5",
      },
      { id: "msg:office:u-tina", sentence: "Landlord Gopher sent you a message", unread: false },
    ]);
  });

  it("keeps status rows read once opened or covered by Mark all read, and new ones unread", () => {
    const statusEvents = [event(1, 5, "Closed", 10), event(2, 5, "Scheduled", 30), event(3, 5, "In Progress", 50)];
    const items = build(tina, {
      statusEvents,
      reads: [
        { item_key: "status:1", read_at: H(9) },
        { item_key: READ_ALL_KEY, read_at: H(40) },
      ],
    });
    expect(items.map((i) => [i.id, i.unread])).toEqual([
      ["status:1", false], // opened
      ["status:2", true], // after the mark-all point
      ["status:3", false], // covered by Mark all read
    ]);
  });

  it("books a technician's own jobs only", () => {
    const visit = request({ id: 8, title: "Radiator", scheduled_for: "2026-11-26T09:00:00Z", assigned_staff_id: 3 });
    const other = request({ id: 9, title: "Gate", assigned_staff_id: 4 });
    const items = build(sam, {
      requests: [visit, other],
      statusEvents: [event(1, 8, "Scheduled", 2), event(2, 9, "Scheduled", 1)],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.sentence).toMatch(/^You’re booked for “Radiator” on /);
  });

  it("gives owners completions and High or Emergency requests on their properties", () => {
    const burst = request({ id: 11, title: "Burst pipe", priority: "Urgent", created_at: H(2) });
    const leak = request({ id: 12, title: "Roof leak", priority: "High", created_at: H(3) });
    const calm = request({ id: 13, title: "Squeaky door", priority: "Normal", created_at: H(1) });
    const items = build(lena, {
      urgent: [burst, leak, calm],
      statusEvents: [event(1, 5, "Closed", 4, { user: "u-sam", role: "maintenance" }), event(2, 5, "Scheduled", 5)],
      propertyNames: new Map([[1, "Maple Court"]]),
    });
    expect(items.map((i) => i.sentence)).toEqual([
      "Emergency request at Maple Court: “Burst pipe”",
      "High-priority request at Maple Court: “Roof leak”",
      "“Kitchen tap” at Maple Court was completed",
    ]);
  });

  it("does not echo the office's own status changes back to admins", () => {
    const items = build(admin, {
      statusEvents: [event(1, 5, "Closed", 2), event(2, 5, "In Progress", 3, { user: "u-sam", role: "maintenance" })],
    });
    expect(items.map((i) => i.sentence)).toEqual(["Work started on “Kitchen tap”"]);
  });

  it("drops status rows older than the window and caps the list", () => {
    const old = build(tina, { statusEvents: [event(1, 5, "Closed", 24 * 40)] });
    expect(old).toEqual([]);
    const many = build(tina, {
      requests: Array.from({ length: 50 }, (_, i) => request({ id: 100 + i, title: `Job ${i}` })),
      statusEvents: Array.from({ length: 50 }, (_, i) => event(i + 1, 100 + i, "Closed", i + 1)),
    });
    expect(many.length).toBe(30);
    expect(many[0]!.id).toBe("status:1");
  });

  it("shows one row per request and kind of change: the latest", () => {
    const items = build(tina, { statusEvents: [event(1, 5, "Closed", 30), event(2, 5, "Closed", 5)] });
    expect(items.map((i) => i.id)).toEqual(["status:2"]);
  });
});

describe("conversationsToMarkRead — Mark all read clears the inbox too", () => {
  it("marks every unread conversation, including ones past the bell's message cap", () => {
    const inbox: InboxConversation[] = Array.from({ length: 25 }, (_, i) => ({
      key: `wo:${100 + i}`,
      kind: "request" as const,
      requestId: 100 + i,
      unread: i !== 3,
      last: { at: H(i + 1), body: `Update ${i}`, authorRole: "admin", authorUserId: "u-admin", authorTenantId: null, authorStaffId: null },
    }));
    const shownMessageRows = build(tina, { inbox }).filter((item) => item.id.startsWith("msg:"));
    expect(shownMessageRows.length).toBeLessThan(24);

    const marked = conversationsToMarkRead({ inbox });
    expect(marked).toHaveLength(24);
    expect(marked.every((c) => c.unread)).toBe(true);
  });
});
