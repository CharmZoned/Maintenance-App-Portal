/**
 * Typed mock inbox + threads for the Tenant Messages screen (Figma M/T/D).
 *
 * // TODO(data-gap): messages backend not available
 * No conversations / messages tables exist in Supabase. This module is the
 * sole data source until a messages/chat migration is approved. Do not wire
 * Supabase `.from(...)` for chat here.
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
};

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
      preview: "Closed · Replaced thermostat.",
      timeLabel: "Mon 10 Nov",
      unread: false,
      openRequestPath: "/maintenance",
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
          body: "Closed · Replaced thermostat.",
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

/**
 * Simulated fetch for loading / empty / error UI states.
 * // TODO(data-gap): messages backend not available
 */
export async function loadTenantMessagesMock(opts?: {
  scenario?: "ok" | "empty" | "error";
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
