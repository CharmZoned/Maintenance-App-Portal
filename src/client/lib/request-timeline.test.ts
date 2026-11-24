import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MaintenanceComment, MaintenanceStatusEvent, WorkOrder } from "@/types";
import { buildTimeline, compareTimeline, initialsOf, type TimelineEntry } from "@/lib/request-timeline";
import { RequestTimeline } from "@/components/maintenance/request/request-timeline";

function wo(partial: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 1000,
    request_number: "MR-001000",
    property_id: 1,
    unit_id: 1,
    tenant_id: 11,
    vendor_id: null,
    title: "Kitchen faucet leaking",
    description: "Drips about once a second.",
    category: "Plumbing",
    priority: "high",
    status: "in_progress",
    permission_to_enter: true,
    assigned_staff_id: 4,
    scheduled_at: "2026-11-17",
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-14T09:00:00Z",
    ...partial,
  };
}

let nextId = 1;
function ev(
  from: string | null,
  to: string,
  at: string,
  role: string | null,
  note: string | null = null,
  id = nextId++,
): MaintenanceStatusEvent {
  return { id, maintenance_request_id: 1000, from_status: from, to_status: to, changed_by_role: role, note, created_at: at };
}

function msg(
  id: number,
  at: string,
  body: string,
  author: { role: string; staff?: number; tenant?: number },
  visibility: MaintenanceComment["visibility"] = "tenant_visible",
): MaintenanceComment {
  return {
    id,
    maintenance_request_id: 1000,
    body,
    visibility,
    author_role: author.role,
    author_staff_id: author.staff ?? null,
    author_tenant_id: author.tenant ?? null,
    created_at: at,
  };
}

const staffById = new Map([
  [4, { first_name: "Sam", last_name: "Fixit" }],
  [9, { first_name: "Ada", last_name: "Admin" }],
]);
const people = { staffById, tenantName: "Tina Renter" };
const day = (iso: string) => `D(${iso.slice(0, 10)})`;
const opts = { formatDay: day };

const texts = (entries: TimelineEntry[]) => entries.map((e) => e.text);

describe("timeline ordering", () => {
  it("fixes the tenant bug: 'In progress' sits at its own (today's) time, after older entries", () => {
    // Reported Nov 22, assigned Nov 23, started TODAY (Nov 24). History arrives
    // in any order; the old panel stamped the current status at created_at.
    const order = wo({ created_at: "2026-11-22T10:00:00Z", scheduled_at: null });
    const history = [
      ev("Scheduled", "In Progress", "2026-11-24T08:15:00Z", "maintenance", null, 3),
      ev(null, "Open", "2026-11-22T10:00:00Z", "tenant", "Created", 1),
      ev("Open", "Scheduled", "2026-11-23T09:00:00Z", "admin", null, 2),
    ];
    const entries = buildTimeline(order, history, [], people, "tenant", opts);
    expect(entries.map((e) => e.key)).toEqual(["reported", "status-2", "status-3"]);
    const started = entries[2];
    expect(started.at).toBe("2026-11-24T08:15:00Z");
    expect(started.status).toBe("In progress");
    expect(started.text).toBe("Sam Fixit started work");
    // The report never carries the current status.
    expect(entries[0]).toMatchObject({ at: "2026-11-22T10:00:00Z", status: "New" });
  });

  it("interleaves events and messages by full timestamp, oldest first", () => {
    const history = [
      ev(null, "Open", "2026-11-14T09:00:00Z", "tenant", "Created", 10),
      ev("Open", "Scheduled", "2026-11-15T10:00:00Z", "admin", null, 11),
      ev("Scheduled", "In Progress", "2026-11-17T08:00:00Z", "maintenance", null, 12),
    ];
    const comments = [
      msg(21, "2026-11-16T12:30:00Z", "Will bring a cartridge.", { role: "maintenance", staff: 4 }),
      msg(20, "2026-11-14T09:30:00Z", "Thanks!", { role: "tenant", tenant: 11 }),
    ];
    const entries = buildTimeline(wo(), history, comments, people, "admin", opts);
    expect(entries.map((e) => e.key)).toEqual(["reported", "message-20", "status-11", "message-21", "status-12"]);
  });

  it("breaks ties: report, then status, then message, then numeric id", () => {
    const at = "2026-11-14T09:00:00Z";
    const e = (key: string, kind: TimelineEntry["kind"]): TimelineEntry => ({
      key,
      kind,
      at,
      actor: { name: "X", role: "Admin", initials: "X" },
      text: key,
      internal: false,
    });
    const sorted = [e("message-10", "message"), e("message-9", "message"), e("status-2", "status"), e("reported", "reported")].sort(
      compareTimeline,
    );
    expect(sorted.map((x) => x.key)).toEqual(["reported", "status-2", "message-9", "message-10"]);
  });

  it("compares instants, not strings, across timezone offsets", () => {
    const history = [
      // 09:30Z expressed with +02:00 → 07:30Z, i.e. BEFORE the 08:00Z event.
      ev("Scheduled", "In Progress", "2026-11-17T09:30:00+02:00", "maintenance", null, 31),
      ev("Open", "Scheduled", "2026-11-17T08:00:00Z", "admin", null, 30),
    ];
    const entries = buildTimeline(wo(), history, [], people, "admin", opts);
    expect(entries.map((x) => x.key)).toEqual(["reported", "status-31", "status-30"]);
  });

  it("drops the 'Created' history row (the reported entry covers it)", () => {
    const history = [ev(null, "Open", "2026-11-14T09:00:00Z", "tenant", "Created", 40)];
    const entries = buildTimeline(wo(), history, [], people, "admin", opts);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "reported", text: "Tina Renter reported this" });
  });
});

describe("timeline sentences", () => {
  it("names the assignee and date on the latest assignment only", () => {
    const history = [
      ev("Open", "Scheduled", "2026-11-15T10:00:00Z", "admin", null, 50),
      ev("Scheduled", "Open", "2026-11-15T11:00:00Z", "admin", null, 51),
      ev("Open", "Scheduled", "2026-11-15T12:00:00Z", "admin", null, 52),
    ];
    const entries = buildTimeline(wo({ status: "scheduled" }), history, [], people, "admin", opts);
    expect(texts(entries).slice(1)).toEqual([
      "Landlord Gopher assigned this",
      "Landlord Gopher moved this back to New",
      "Landlord Gopher assigned Sam Fixit, scheduled D(2026-11-17)",
    ]);
  });

  it("uses the real person when changed_by_user_id can be named", () => {
    const history = [{ ...ev("Open", "Scheduled", "2026-11-15T10:00:00Z", "admin", null, 55), changed_by_user_id: "u-ada" }];
    const entries = buildTimeline(
      wo({ status: "scheduled", scheduled_at: null }),
      history,
      [],
      { ...people, nameForUserId: (id) => (id === "u-ada" ? "Ada Admin" : null) },
      "admin",
      opts,
    );
    expect(entries[1].text).toBe("Ada Admin assigned Sam Fixit");
    expect(entries[1].actor).toMatchObject({ name: "Ada Admin", role: "Admin", initials: "AA" });
  });

  it("writes start, hold (with reason and follow-up), resume and completion in plain words", () => {
    const order = wo({
      status: "closed",
      hold_reason: "waiting for part",
      next_follow_up_date: "2026-11-20",
      resolution_notes: "Replaced the faucet cartridge.",
    });
    const history = [
      ev("Scheduled", "In Progress", "2026-11-17T08:00:00Z", "maintenance", null, 60),
      ev("In Progress", "On Hold", "2026-11-17T09:00:00Z", "maintenance", null, 61),
      ev("On Hold", "In Progress", "2026-11-19T08:00:00Z", "maintenance", null, 62),
      ev("In Progress", "Closed", "2026-11-19T10:00:00Z", "maintenance", null, 63),
    ];
    const entries = buildTimeline(order, history, [], people, "admin", opts);
    expect(texts(entries).slice(1)).toEqual([
      "Sam Fixit started work",
      // Follow-up is only appended while the request is still on hold.
      "Sam Fixit put this on hold: “Waiting for part”",
      "Sam Fixit resumed work",
      "Sam Fixit completed this: “Replaced the faucet cartridge.”",
    ]);
  });

  it("appends the follow-up date on the latest hold while on hold, and uses older notes for older events", () => {
    const order = wo({ status: "on_hold", hold_reason: "waiting for part", next_follow_up_date: "2026-11-20" });
    const history = [
      ev("In Progress", "On Hold", "2026-11-16T09:00:00Z", "maintenance", "Tenant away", 70),
      ev("On Hold", "In Progress", "2026-11-16T12:00:00Z", "maintenance", null, 71),
      ev("In Progress", "On Hold", "2026-11-17T09:00:00Z", "maintenance", null, 72),
    ];
    const entries = buildTimeline(order, history, [], people, "admin", opts);
    expect(texts(entries).slice(1)).toEqual([
      "Sam Fixit put this on hold: “Tenant away”",
      "Sam Fixit resumed work",
      "Sam Fixit put this on hold: “Waiting for part” · follow-up D(2026-11-20)",
    ]);
  });

  it("says reopened for anything leaving Completed", () => {
    const history = [
      ev("In Progress", "Closed", "2026-11-18T10:00:00Z", "maintenance", "Tightened nut", 80),
      ev("Closed", "Scheduled", "2026-11-19T10:00:00Z", "admin", null, 81),
    ];
    const entries = buildTimeline(wo({ status: "scheduled", resolution_notes: null }), history, [], people, "admin", opts);
    expect(texts(entries).slice(1)).toEqual([
      "Sam Fixit completed this: “Tightened nut”",
      "Landlord Gopher reopened this",
    ]);
  });

  it("never shows internal event names or arrows; pool events are staff-only sentences", () => {
    const order = wo({ status: "scheduled", scheduled_at: "2026-11-17" });
    const history = [
      ev(null, "Open", "2026-11-14T09:00:00Z", "tenant", "Created", 90),
      ev("Open", "Open", "2026-11-14T10:00:00Z", "admin", "Offered to workers", 91),
      ev("Open", "Scheduled", "2026-11-14T11:00:00Z", "maintenance", "Accepted by worker", 92),
    ];
    const admin = buildTimeline(order, history, [], people, "admin", opts);
    expect(texts(admin)).toEqual([
      "Tina Renter reported this",
      "Landlord Gopher offered this job to workers",
      "Sam Fixit accepted the job, scheduled D(2026-11-17)",
    ]);
    expect(admin[1].internal).toBe(true);
    const all = texts(admin).join("\n");
    expect(all).not.toMatch(/Offered to workers|Accepted by worker|→|Open|Scheduled/);

    const tenant = buildTimeline(order, history, [], { ...people, viewerTenantId: 11 }, "tenant", opts);
    expect(texts(tenant)).toEqual(["You reported this", "Sam Fixit accepted the job, scheduled D(2026-11-17)"]);
  });

  it("writes the tenant fix confirmation as a sentence", () => {
    const history = [ev("Closed", "Closed", "2026-11-20T10:00:00Z", "tenant", "Tenant confirmed it is fixed", 95)];
    const entries = buildTimeline(wo({ status: "closed" }), history, [], people, "admin", opts);
    expect(entries[1].text).toBe("Tina Renter confirmed it’s fixed");
  });

  it("reads 'You' for the viewer's own actions", () => {
    const history = [ev("Scheduled", "In Progress", "2026-11-17T08:00:00Z", "maintenance", null, 99)];
    const entries = buildTimeline(wo(), history, [], { ...people, viewerStaffId: 4 }, "maintenance", opts);
    expect(entries[1].text).toBe("You started work");
  });
});

describe("people, role tags and visibility", () => {
  const comments = [
    msg(1, "2026-11-15T09:00:00Z", "Part on back-order.", { role: "maintenance", staff: 4 }, "internal"),
    msg(2, "2026-11-15T10:00:00Z", "Thanks!", { role: "tenant", tenant: 11 }),
    msg(3, "2026-11-15T11:00:00Z", "Sam is coming Tuesday.", { role: "admin", staff: 9 }),
  ];

  it("staff see names, role tags and internal notes", () => {
    const entries = buildTimeline(wo(), [], comments, people, "admin", opts);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey["message-1"]).toMatchObject({ internal: true, actor: { name: "Sam Fixit", role: "Maintenance", initials: "SF" } });
    expect(byKey["message-2"].actor).toMatchObject({ name: "Tina Renter", role: "Tenant" });
    expect(byKey["message-3"].actor).toMatchObject({ name: "Ada Admin", role: "Admin" });
  });

  it("tenants never get internal notes, and admins read as Landlord Gopher", () => {
    const entries = buildTimeline(wo(), [], comments, { ...people, viewerTenantId: 11 }, "tenant", opts);
    expect(entries.map((e) => e.key)).toEqual(["reported", "message-2", "message-3"]);
    expect(entries.some((e) => e.internal)).toBe(false);
    expect(entries[1].actor.name).toBe("You");
    expect(entries[2].actor).toMatchObject({ name: "Landlord Gopher", role: "Landlord Gopher" });
  });

  it("landlords get status events only", () => {
    const history = [
      ev("Open", "Open", "2026-11-14T10:00:00Z", "admin", "Offered to workers", 200),
      ev("Scheduled", "In Progress", "2026-11-17T08:00:00Z", "maintenance", null, 201),
    ];
    const entries = buildTimeline(wo(), history, comments, people, "landlord", opts);
    expect(entries.map((e) => e.key)).toEqual(["reported", "status-201"]);
  });

  it("falls back to role phrases, never ids", () => {
    const entries = buildTimeline(
      wo({ assigned_staff_id: 77 }),
      [ev("Scheduled", "In Progress", "2026-11-17T08:00:00Z", "maintenance", null, 300)],
      [],
      { staffById },
      "landlord",
      opts,
    );
    expect(texts(entries)).toEqual(["The tenant reported this", "The worker started work"]);
  });

  it("names a staff reporter from the creation row when there is no tenant", () => {
    const entries = buildTimeline(
      wo({ tenant_id: null }),
      [ev(null, "Open", "2026-11-14T09:00:00Z", "admin", "Created", 400)],
      [],
      { staffById },
      "admin",
      opts,
    );
    expect(entries[0]).toMatchObject({ text: "Landlord Gopher reported this", actor: { role: "Admin" } });
  });

  it("makes two-letter initials", () => {
    expect(initialsOf("Sam Fixit")).toBe("SF");
    expect(initialsOf("Landlord Gopher")).toBe("LG");
    expect(initialsOf("You")).toBe("YO");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("RequestTimeline markup", () => {
  const history = [ev("Scheduled", "In Progress", "2026-11-17T08:00:00Z", "maintenance", null, 500)];
  const comments = [msg(1, "2026-11-15T09:00:00Z", "Part on back-order.", { role: "maintenance", staff: 4 }, "internal")];

  it("staff composer has the Internal only switch, not the old checkbox", () => {
    const html = renderToStaticMarkup(
      createElement(RequestTimeline, {
        entries: buildTimeline(wo(), history, comments, people, "admin", opts),
        formatWhen: (iso: string) => iso.slice(0, 10),
        composer: { showInternalToggle: true, onSend: () => undefined },
      }),
    );
    expect(html).toContain("Internal — not visible to tenant or landlord");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Internal only");
    expect(html).toContain("Sam Fixit started work");
    expect(html).toContain("bg-warning-tint");
    expect(html).not.toContain("Visible to tenant");
    expect(html).not.toContain('type="checkbox"');
  });

  it("tenant composer has no switch and no link off the page", () => {
    const html = renderToStaticMarkup(
      createElement(RequestTimeline, {
        entries: buildTimeline(wo(), history, comments, { ...people, viewerTenantId: 11 }, "tenant", opts),
        formatWhen: (iso: string) => iso.slice(0, 10),
        composer: { showInternalToggle: false, onSend: () => undefined },
      }),
    );
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("Internal");
    expect(html).not.toContain("Open request conversation");
    expect(html).toContain("Write a message…");
    expect(html).toContain("Send");
  });

  it("completed request shows the locked strip with Reopen for admin", () => {
    const html = renderToStaticMarkup(
      createElement(RequestTimeline, {
        entries: [],
        formatWhen: (iso: string) => iso,
        composer: null,
        readOnlyNote: "This request is completed. Messages are closed.",
        onReopen: () => undefined,
      }),
    );
    expect(html).toContain("This request is completed. Messages are closed.");
    expect(html).toContain("Reopen");
    expect(html).not.toContain("Send");
  });
});
