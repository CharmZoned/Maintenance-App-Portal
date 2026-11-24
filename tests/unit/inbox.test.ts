import { describe, expect, it, vi } from "vitest";
import {
  buildInbox,
  countUnreadConversations,
  createInboxReadMarker,
  hasRequestConversations,
  isConversationUnread,
  isOurs,
  OFFICE_VIEWER,
  requestReadThread,
  requestReadThreadsFor,
  type InboxConversation,
  type InboxReadMarker,
  type OfficeMessageRow,
  type RequestCommentRow,
} from "../../src/client/lib/inbox";

const T = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 20, hour, minute)).toISOString();

describe("isConversationUnread — the one unread rule", () => {
  it("is unread when someone outside the office wrote and nobody has read or answered", () => {
    expect(isConversationUnread([{ at: T(9), ours: false, readAt: null }])).toBe(true);
  });

  it("is read once this admin opened it after the message", () => {
    expect(isConversationUnread([{ at: T(9), ours: false, readAt: T(10) }])).toBe(false);
    // Read exactly through the latest message (the timestamp the app records).
    expect(isConversationUnread([{ at: T(9), ours: false, readAt: T(9) }])).toBe(false);
  });

  it("is answered — so not unread — when any admin replied after it", () => {
    expect(
      isConversationUnread([
        { at: T(9), ours: false, readAt: null },
        { at: T(10), ours: true, readAt: null },
      ]),
    ).toBe(false);
  });

  it("is unread again when they write after the office's reply", () => {
    expect(
      isConversationUnread([
        { at: T(9), ours: false, readAt: T(9) },
        { at: T(10), ours: true, readAt: T(9) },
        { at: T(11), ours: false, readAt: T(9) },
      ]),
    ).toBe(true);
  });

  it("never counts the office's own messages", () => {
    expect(isConversationUnread([{ at: T(9), ours: true, readAt: null }])).toBe(false);
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

  describe("the same rule for tenants, landlords and technicians", () => {
    const tina = { role: "tenant" as const, userId: "u-tenant" };
    const sam = { role: "maintenance" as const, userId: "u-maintenance" };

    it("whose side a message is on: the office for admins, the reader alone for everyone else", () => {
      expect(isOurs(OFFICE_VIEWER, { author_role: "admin", author_user_id: "u-other-admin" })).toBe(true);
      expect(isOurs(tina, { author_role: "tenant", author_user_id: "u-tenant" })).toBe(true);
      // Another tenant in the same home is not "us".
      expect(isOurs(tina, { author_role: "tenant", author_user_id: "u-flatmate" })).toBe(false);
      expect(isOurs(tina, { author_role: "admin", author_user_id: "u-admin" })).toBe(false);
    });

    it("an office reply is unread for the tenant until they read it, and answered once they reply", () => {
      const officeRows = [office(1, "u-tenant", "tenant", T(8)), office(2, "u-tenant", "admin", T(9))];
      const fresh = buildInbox({ officeMessages: officeRows, officeReads: [], comments: [], requestReads: [] }, tina);
      expect(fresh[0]).toMatchObject({ key: "office:u-tenant", unread: true });

      const read = buildInbox(
        { officeMessages: officeRows, officeReads: [{ thread_user_id: "u-tenant", last_read_at: T(9) }], comments: [], requestReads: [] },
        tina,
      );
      expect(read[0].unread).toBe(false);

      const replied = buildInbox(
        {
          officeMessages: [...officeRows, { ...office(3, "u-tenant", "tenant", T(10)), author_user_id: "u-tenant" }],
          officeReads: [],
          comments: [],
          requestReads: [],
        },
        tina,
      );
      expect(replied[0].unread).toBe(false);
    });

    it("a technician's comment is unread for the tenant; the tenant's own is not", () => {
      const rows = [comment(1, 5, "maintenance", T(9))];
      expect(buildInbox({ officeMessages: [], officeReads: [], comments: rows, requestReads: [] }, tina)[0].unread).toBe(true);
      const own = [{ ...comment(2, 5, "tenant", T(9)), author_user_id: "u-tenant" }];
      expect(buildInbox({ officeMessages: [], officeReads: [], comments: own, requestReads: [] }, tina)[0].unread).toBe(false);
    });

    it("a technician reads internal notes against their office-thread read", () => {
      const rows = [comment(1, 5, "admin", T(9), "internal")];
      const shared = [{ maintenance_request_id: 5, thread: "shared", last_read_at: T(10) }];
      expect(buildInbox({ officeMessages: [], officeReads: [], comments: rows, requestReads: shared }, sam)[0].unread).toBe(true);
      expect(requestReadThreadsFor("maintenance")).toEqual(["shared", "office"]);
      // RLS refuses tenants and landlords an office-thread read row, so they never write one.
      expect(requestReadThreadsFor("tenant")).toEqual(["shared"]);
      expect(requestReadThreadsFor("landlord")).toEqual(["shared"]);
    });

    it("landlords have no request conversations", () => {
      expect(hasRequestConversations("landlord")).toBe(false);
      expect(hasRequestConversations("tenant")).toBe(true);
      expect(hasRequestConversations("maintenance")).toBe(true);
    });
  });
});

describe("createInboxReadMarker — when the Messages page writes a read", () => {
  type Write = (conversation: InboxConversation, through: string) => Promise<void>;

  /**
   * A stand-in for AdminMessagesPage: an inbox in state, and a "render" that
   * re-runs the deep-link effect (follow) every time the inbox changes, just as
   * the page's effect re-runs whenever `threads` is rebuilt.
   */
  function harness(write: Write) {
    let inbox: InboxConversation[] = [
      {
        key: "wo:7",
        kind: "request",
        requestId: 7,
        last: { at: T(9), body: "Disposal jammed", authorRole: "tenant", authorUserId: "u-tina", authorTenantId: 1, authorStaffId: null },
        unread: true,
      },
      {
        key: "office:u-raj",
        kind: "office",
        threadUserId: "u-raj",
        last: { at: T(8), body: "Hi", authorRole: "tenant", authorUserId: "u-raj", authorTenantId: null, authorStaffId: null },
        unread: true,
      },
    ];
    let url: string | null = null;
    let renders = 0;
    const written = vi.fn();
    const render = () => {
      renders += 1;
      if (renders > 50) throw new Error("render loop");
      marker.follow(url);
    };
    const marker: InboxReadMarker = createInboxReadMarker({
      getConversation: (key) => inbox.find((c) => c.key === key),
      setUnread: (key, unread) => {
        inbox = inbox.map((c) => (c.key === key ? { ...c, unread } : c));
        render();
      },
      write,
      onWritten: written,
    });
    const visit = (key: string | null) => {
      url = key;
      render();
    };
    return {
      marker,
      written,
      unread: (key: string) => inbox.find((c) => c.key === key)!.unread,
      /** Navigate to ?thread=key (or to no thread) and render. */
      visit,
      /** The admin clicks a row: open it, then the URL follows (as openThread does). */
      click(key: string) {
        marker.open(key);
        visit(key);
      },
      renders: () => renders,
    };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("a rejected write is not written again on re-render; the conversation stays unread", async () => {
    const write = vi.fn<Write>(() => Promise.reject(new Error("503")));
    const page = harness(write);
    page.visit("wo:7");
    expect(page.unread("wo:7")).toBe(false); // shown read while the write is on its way
    await flush();
    expect(page.unread("wo:7")).toBe(true); // put back after the failure
    // The failure re-rendered the page; a few more renders change nothing.
    page.visit("wo:7");
    page.visit("wo:7");
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(page.written).not.toHaveBeenCalled();
    expect(page.renders()).toBeLessThan(10);
  });

  it("a failed write does not mark a conversation unread again once the office has replied", async () => {
    let rejectWrite: (err: Error) => void = () => {};
    let inbox: InboxConversation[] = [
      {
        key: "wo:7",
        kind: "request",
        requestId: 7,
        last: { at: T(9), body: "Disposal jammed", authorRole: "tenant", authorUserId: "u-tina", authorTenantId: 1, authorStaffId: null },
        unread: true,
      },
    ];
    const marker = createInboxReadMarker({
      getConversation: (key) => inbox.find((c) => c.key === key),
      setUnread: (key, unread) => {
        inbox = inbox.map((c) => (c.key === key ? { ...c, unread } : c));
      },
      write: () => new Promise<void>((_resolve, reject) => (rejectWrite = reject)),
    });
    marker.open("wo:7");
    expect(inbox[0].unread).toBe(false);
    await flush(); // the write has started
    // The admin answers before the read write settles (as recordReply does).
    inbox = [{ ...inbox[0], last: { ...inbox[0].last, at: T(10), body: "On it", authorRole: "admin" }, unread: false }];
    rejectWrite(new Error("503"));
    await flush();
    expect(inbox[0].unread).toBe(false);
  });

  it("a click on a conversation whose write failed is the retry, once per click", async () => {
    const write = vi.fn<Write>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const page = harness(write);
    page.click("wo:7");
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(page.unread("wo:7")).toBe(true);

    page.click("wo:7");
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(page.unread("wo:7")).toBe(false);
    expect(page.written).toHaveBeenCalledTimes(1);
  });

  it("the deep link marks each conversation once, and a click while it is being written adds nothing", async () => {
    const write = vi.fn<Write>(() => Promise.resolve());
    const page = harness(write);
    page.visit("wo:7");
    page.click("wo:7");
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ key: "wo:7" }), T(9));

    page.visit("office:u-raj");
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ key: "office:u-raj" }), T(8));
    // Already read: coming back to it writes nothing.
    page.visit(null);
    page.visit("wo:7");
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("reads through a newer message the open thread shows, after the first write and only once", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));
    const write = vi.fn<Write>((_c, through) => {
      order.push(`start ${through}`);
      return (order.length === 1 ? first : Promise.resolve()).then(() => {
        order.push(`done ${through}`);
      });
    });
    const page = harness(write);
    page.click("wo:7");
    // The thread loads and has a message the inbox did not know about yet.
    page.marker.seen("wo:7", T(9, 30));
    page.marker.seen("wo:7", T(9, 30));
    // Nothing newer than the inbox's latest message: nothing more to write.
    page.marker.seen("wo:7", T(9));
    release();
    await flush();
    await flush();
    expect(order).toEqual([`start ${T(9)}`, `done ${T(9)}`, `start ${T(9, 30)}`, `done ${T(9, 30)}`]);
    expect(page.written).toHaveBeenCalledTimes(2);
  });
});
