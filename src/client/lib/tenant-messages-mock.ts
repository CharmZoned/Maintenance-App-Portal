/**
 * Legacy typed mock inbox for Tenant Messages demo states (`?demo=empty|error`)
 * and unit tests of the old Figma sample threads.
 *
 * Live tenant messaging uses OfficeMessages + MaintenanceRequestComments via
 * `tenant-messages-page.tsx`. Keep this module for demo scenario helpers only.
 */

export type MockMessageSide = "outgoing" | "incoming";

export type MockMessage = {
  id: string;
  sender: string;
  body: string;
  /** Display timestamp as shown in Figma (e.g. "Today 11:05 am"). */
  timeLabel: string;
  side: MockMessageSide;
};

export type MockConversationKind = "request" | "property" | "general";

export type MockConversation = {
  id: string;
  kind: MockConversationKind;
  title: string;
  preview: string;
  timeLabel: string;
  unread: boolean;
  /** Participant lines under the conversation header. */
  participants: string[];
  messages: MockMessage[];
  /**
   * Thin UI affordance only — path to open the linked request screen.
   * Not a real messages↔WO join.
   */
  openRequestPath?: string;
  /**
   * Demo WO number / id keys matched by `/messages?request=`.
   * // TODO(data-gap): messages backend not available
   */
  linkedRequestIds?: string[];
};

/**
 * Deep-link contract with Requests (“Open request conversation”):
 * - `/messages?request=<workOrderId>` — preferred inbound from Requests.
 *   `workOrderId` is the MaintenanceRequests **primary key** (`order.id`), not
 *   necessarily a Figma-style request_number. Resolve order:
 *   1) match demo `linkedRequestIds` / request_number soft keys (1842, WO-1842)
 *   2) otherwise always open a **synthetic** request thread keyed by that id
 *      so a real click never lands on a silent unselected inbox (esp. phone).
 * - `/messages?thread=<mockThreadId>` — internal inbox selection / phone thread
 *   (e.g. `mock:wo-1842`). Takes precedence when both params are present.
 *   Unknown `thread` → not-found empty (mobile + desktop).
 */
export type MessagesDeepLink =
  | { kind: "thread"; threadId: string }
  | {
      kind: "request";
      requestId: string;
      threadId: string;
      /** True when no demo thread matched — caller should ensure synthetic exists. */
      synthetic: boolean;
    }
  | { kind: "not-found"; requestId: string }
  | { kind: "none" };

export function normalizeRequestKey(raw: string): string {
  return raw.trim().replace(/^wo[-_]?/i, "").toLowerCase();
}

/** Stable thread id for a Requests deep-link that has no demo match. */
export function syntheticRequestThreadId(requestId: string): string {
  return `mock:request:${requestId.trim()}`;
}

/**
 * Placeholder conversation for any real `order.id` / uuid deep-link.
 * // TODO(data-gap): messages backend not available
 */
export function createSyntheticRequestThread(requestId: string): MockConversation {
  const id = requestId.trim();
  return {
    id: syntheticRequestThreadId(id),
    kind: "request",
    title: `Request ${id}`,
    preview: "No messages yet — messaging isn’t connected.",
    timeLabel: "Just now",
    unread: false,
    openRequestPath: `/maintenance?wo=${encodeURIComponent(id)}`,
    linkedRequestIds: [id],
    participants: [
      "You · property staff",
      "Assigned request members only · demo thread",
    ],
    messages: [],
  };
}

export function findMockThreadForRequest(
  conversations: MockConversation[],
  requestId: string,
): MockConversation | undefined {
  const raw = requestId.trim();
  const key = normalizeRequestKey(raw);
  if (!key) return undefined;

  // 1) Explicit linked keys (demo WO numbers + any stored PK strings).
  const byLinked = conversations.find((c) =>
    (c.linkedRequestIds ?? []).some((id) => {
      const linked = id.trim();
      return (
        linked === raw ||
        normalizeRequestKey(linked) === key ||
        normalizeRequestKey(linked) === normalizeRequestKey(raw)
      );
    }),
  );
  if (byLinked) return byLinked;

  // 2) Soft match title request_number (e.g. "WO-1842 · …") or synthetic id.
  const byTitleOrId = conversations.find((c) => {
    if (c.id === syntheticRequestThreadId(raw) || c.id === `mock:wo-${key}`) {
      return true;
    }
    const titleKey = c.title.match(/\bWO[-_]?(\w+)\b/i)?.[1];
    return titleKey != null && normalizeRequestKey(titleKey) === key;
  });
  return byTitleOrId;
}

export function resolveMessagesDeepLink(
  search: string,
  conversations: MockConversation[],
): MessagesDeepLink {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const thread = params.get("thread");
  if (thread) {
    if (conversations.some((c) => c.id === thread)) {
      return { kind: "thread", threadId: thread };
    }
    return { kind: "not-found", requestId: thread };
  }
  const request = params.get("request");
  if (request != null && request.trim() !== "") {
    const match = findMockThreadForRequest(conversations, request);
    if (match) {
      return {
        kind: "request",
        requestId: request.trim(),
        threadId: match.id,
        synthetic: false,
      };
    }
    // Always open a conversation for the PK Requests put in the URL.
    return {
      kind: "request",
      requestId: request.trim(),
      threadId: syntheticRequestThreadId(request.trim()),
      synthetic: true,
    };
  }
  if (request != null) {
    return { kind: "not-found", requestId: "" };
  }
  return { kind: "none" };
}

export type TenantMessagesMockBundle = {
  conversations: MockConversation[];
  /** Inbox footer copy (Figma “Property manager”). */
  propertyManagerTitle: string;
  propertyManagerDetail: string;
};

/** Stable ids used by deep-link `?thread=` and default desktop selection. */
export const MOCK_THREAD_IDS = {
  unitHome: "mock:unit-4b",
  leakingTap: "mock:wo-1842",
  parking: "mock:parking-permit",
  brokenHeater: "mock:wo-1799",
} as const;

// TODO(data-gap): messages backend not available
export const TENANT_MESSAGES_MOCK: TenantMessagesMockBundle = {
  propertyManagerTitle: "Property manager",
  propertyManagerDetail: "Name and contact not provided.",
  conversations: [
    {
      id: MOCK_THREAD_IDS.unitHome,
      kind: "property",
      title: "Unit 4B · Oak Street",
      preview: "Thanks — we’ll send Sam tomorrow morning.",
      timeLabel: "Today 2:14 pm",
      unread: true,
      participants: [
        "You · Ada Admin (Landlord Gopher)",
        "Property office · building notices",
      ],
      messages: [
        {
          id: "m-unit-1",
          sender: "You",
          body: "Any update on the hallway light?",
          timeLabel: "Today 1:50 pm",
          side: "outgoing",
        },
        {
          id: "m-unit-2",
          sender: "Ada Admin · Landlord Gopher",
          body: "Thanks — we’ll send Sam tomorrow morning.",
          timeLabel: "Today 2:14 pm",
          side: "incoming",
        },
      ],
    },
    {
      id: MOCK_THREAD_IDS.leakingTap,
      kind: "request",
      title: "WO-1842 · Leaking tap",
      preview: "Sam: I’m on my way — ETA 20 minutes.",
      timeLabel: "Today 11:05 am",
      unread: true,
      // Affordance only — opens Requests list; no messages table join.
      openRequestPath: "/maintenance",
      linkedRequestIds: ["1842", "WO-1842"],
      participants: [
        "You · Ada Admin (Landlord Gopher)",
        "Sam Fixit (Maintenance) · assigned request members only",
      ],
      messages: [
        {
          id: "m-1842-1",
          sender: "You",
          body: "The kitchen tap drips all night — can someone look?",
          timeLabel: "Mon 10 Nov · 8:40 am",
          side: "outgoing",
        },
        {
          id: "m-1842-2",
          sender: "Ada Admin · Landlord Gopher",
          body: "Thanks — we’ve raised WO-1842 and assigned Sam for Tuesday.",
          timeLabel: "Mon 10 Nov · 9:12 am",
          side: "incoming",
        },
        {
          id: "m-1842-3",
          sender: "Sam Fixit · Maintenance",
          body: "I’m on my way — ETA 20 minutes.",
          timeLabel: "Today 11:05 am",
          side: "incoming",
        },
      ],
    },
    {
      id: MOCK_THREAD_IDS.parking,
      kind: "general",
      title: "Parking permit",
      preview: "Your visitor permit is ready to download.",
      timeLabel: "Yesterday",
      unread: false,
      participants: ["You · Building office"],
      messages: [
        {
          id: "m-park-1",
          sender: "Building office",
          body: "Your visitor permit is ready to download.",
          timeLabel: "Yesterday",
          side: "incoming",
        },
      ],
    },
    {
      id: MOCK_THREAD_IDS.brokenHeater,
      kind: "request",
      title: "WO-1799 · Broken heater",
      preview: "Completed · Replaced thermostat.",
      timeLabel: "Mon 10 Nov",
      unread: false,
      openRequestPath: "/maintenance",
      linkedRequestIds: ["1799", "WO-1799"],
      participants: [
        "You · Ada Admin (Landlord Gopher)",
        "Sam Fixit (Maintenance) · assigned request members only",
      ],
      messages: [
        {
          id: "m-1799-1",
          sender: "You",
          body: "Heater won’t kick on this morning.",
          timeLabel: "Mon 10 Nov · 7:05 am",
          side: "outgoing",
        },
        {
          id: "m-1799-2",
          sender: "Sam Fixit · Maintenance",
          body: "Completed · Replaced thermostat.",
          timeLabel: "Mon 10 Nov · 2:40 pm",
          side: "incoming",
        },
      ],
    },
  ],
};

export function unreadCount(conversations: MockConversation[]): number {
  return conversations.filter((c) => c.unread).length;
}

export type TenantMessagesLoadScenario = "ok" | "empty" | "error";

/**
 * Demo load scenario for empty/error UI (Figma interface states).
 * Use `/messages?demo=empty` or `/messages?demo=error` (alias `?scenario=`).
 * Default is the Figma demo inbox (`ok`).
 */
export function messagesLoadScenarioFromSearch(search: string): TenantMessagesLoadScenario {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = (params.get("demo") ?? params.get("scenario") ?? "").trim().toLowerCase();
  if (raw === "empty" || raw === "error") return raw;
  return "ok";
}

/**
 * Simulated fetch for loading / empty / error UI states.
 * // TODO(data-gap): messages backend not available
 */
export async function loadTenantMessagesMock(opts?: {
  scenario?: TenantMessagesLoadScenario;
  delayMs?: number;
}): Promise<TenantMessagesMockBundle> {
  const scenario = opts?.scenario ?? "ok";
  const delayMs = opts?.delayMs ?? 280;
  await new Promise((r) => setTimeout(r, delayMs));
  if (scenario === "error") {
    // TODO(data-gap): messages backend not available
    throw new Error("Messages aren’t connected yet. Showing a demo failure state.");
  }
  if (scenario === "empty") {
    // TODO(data-gap): messages backend not available
    return {
      ...TENANT_MESSAGES_MOCK,
      conversations: [],
    };
  }
  // TODO(data-gap): messages backend not available — return static demo threads
  return {
    ...TENANT_MESSAGES_MOCK,
    conversations: TENANT_MESSAGES_MOCK.conversations.map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({ ...m })),
      participants: [...c.participants],
    })),
  };
}
