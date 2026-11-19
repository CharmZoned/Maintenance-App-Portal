import type {
  AdminDashboardModel,
  AdminDashboardState,
  DashboardIntroModel,
  RentModel,
} from "@/components/dashboard/admin-dashboard-model";

/**
 * The sample world drawn in Figma "001 - Admin Pages" (AH — Dashboard ·
 * Default), word for word. Used by the preview harness and by tests so a
 * render can be compared against the design frame directly.
 * "Today" in this world is Monday 16 November 2026.
 */

export const FIXTURE_TODAY = "2026-11-16";

export const fixtureIntro: DashboardIntroModel = {
  eyebrow: "Your portfolio, at a glance",
  greeting: "Good morning, Ada.",
  dateLine: "Your office command center · Monday 16 November 2026",
};

export const fixtureModel: AdminDashboardModel = {
  kpis: [
    { id: "open-requests", label: "Open requests", value: "3", detail: "0 emergency · 1 unassigned", href: "/maintenance" },
    { id: "rent-collected", label: "Rent collected", value: "94%", detail: "$10,575 of $11,300", href: "/rent" },
    { id: "occupancy", label: "Occupancy", value: "89%", detail: "8 of 9 units occupied", href: "/properties" },
    { id: "approvals", label: "Approvals waiting", value: "1", detail: "Riley Applicant", href: "/people" },
    { id: "unread-messages", label: "Unread messages", value: "3", detail: "Across your portfolio", href: "/messages" },
    { id: "homes-live", label: "Homes live online", value: "6", detail: "1 draft · 1 not listed", href: "/listings" },
  ],
  attention: {
    summaryLine: "6 items · Ranked by urgency. Only your office can resolve these.",
    resolvedLine: "Resolved today · Mon 16 Nov 2026",
    items: [
      {
        id: "verify-zelle",
        icon: "dollar",
        title: "Verify $725 Zelle from Raj Patel",
        context: "Tenant · Maple Court 1B · 15 days late",
        href: "/rent",
        actionLabel: "Verify",
      },
      {
        id: "assign-998",
        icon: "wrench",
        title: "Unassigned request: Hallway light out",
        context: "In progress → Assign a team member · #MR-000998",
        href: "/maintenance/998",
        actionLabel: "Assign",
      },
      {
        id: "approve-riley",
        icon: "user",
        title: "Riley Applicant is waiting for approval",
        context: "Applicant · Wants to be a tenant · Today, 16 Nov 2026",
        href: "/people",
        actionLabel: "Review",
      },
      {
        id: "lease-1b",
        icon: "calendar",
        title: "Lease ends in 29 days · Unit 1B",
        context: "Raj Patel, tenant · Tue 15 Dec 2026",
        href: "/leases",
        actionLabel: "Start renewal",
      },
      {
        id: "vacant-birch-1",
        icon: "building",
        title: "Birch House Unit 1 is vacant and not listed",
        context: "Lena Owner, landlord · Ready for move-in",
        href: "/properties",
        actionLabel: "Create listing",
        actionHref: "/listings",
      },
      {
        id: "follow-up-995",
        icon: "calendar",
        title: "Boiler follow-up due Fri 20 Nov",
        context: "On hold → Check part delivery · In 4 days, 20 Nov 2026",
        href: "/maintenance/995",
        actionLabel: "Open",
      },
    ],
  },
  calendar: {
    today: FIXTURE_TODAY,
    href: "/calendar",
    events: [
      {
        id: "rent-nov",
        kind: "rent_due",
        day: "2026-11-01",
        title: "Rent due · 9 units",
        record: "November rent · $11,300 expected",
        details: ["All 4 properties"],
        actionLabel: "Open rent",
        href: "/rent",
      },
      {
        id: "zelle-raj",
        kind: "follow_up",
        day: "2026-11-13",
        title: "Follow-up due · Verify payment",
        record: "$725 Zelle from Raj Patel",
        details: ["Raj Patel, tenant", "Maple Court · Unit 1B"],
        actionLabel: "Open rent",
        href: "/rent",
      },
      {
        id: "assign-998",
        kind: "follow_up",
        day: "2026-11-16",
        title: "Follow-up due · Assign a team member",
        record: "Hallway light out · #MR-000998",
        details: ["Unassigned · Office report", "Maple Court · Common area"],
        actionLabel: "Open request",
        href: "/maintenance/998",
      },
      {
        id: "visit-1000",
        kind: "visit",
        day: "2026-11-17",
        title: "Scheduled visit · 10:00–11:00 am",
        record: "Kitchen faucet leaking · #MR-001000",
        details: ["Sam Fixit, team · Tina Renter, tenant", "Maple Court · Unit 1A"],
        actionLabel: "Open request",
        href: "/maintenance/1000",
      },
      {
        id: "follow-up-995",
        kind: "follow_up",
        day: "2026-11-20",
        title: "Follow-up due · Check part delivery",
        record: "Boiler making noise · #MR-000995",
        details: ["Lena Owner, landlord", "Birch House"],
        actionLabel: "Open request",
        href: "/maintenance/995",
      },
      {
        id: "lease-start-cedar",
        kind: "lease_start",
        day: "2026-11-23",
        title: "Lease starts · Cedar Row Unit 3",
        record: "12 months · $1,250 a month",
        details: ["Oscar Owner, landlord", "Cedar Row · Unit 3"],
        actionLabel: "Open lease",
        href: "/leases",
      },
      {
        id: "move-in-cedar",
        kind: "move_in",
        day: "2026-11-27",
        title: "Move-in · Cedar Row Unit 3",
        record: "Keys and welcome walk-through",
        details: ["Oscar Owner, landlord", "Cedar Row · Unit 3"],
        actionLabel: "Open lease",
        href: "/leases",
      },
      {
        id: "lease-end-elm",
        kind: "lease_end",
        day: "2026-11-30",
        title: "Lease ends · Elm Street Duplex Unit 2",
        record: "Renewal not started",
        details: ["Oscar Owner, landlord", "Elm Street Duplex · Unit 2"],
        actionLabel: "Open lease",
        href: "/leases",
      },
    ],
  },
  activity: {
    summaryLine: "Across all properties · People shown by name and role",
    groups: [
      {
        id: "2026-11-16",
        label: "Today · Mon 16 Nov 2026",
        items: [
          {
            id: "a1",
            icon: "wrench",
            title: "Lee Wrench, team, updated Hallway light out",
            context: "Maple Court · common area · Today, 16 Nov 2026 · 9:15 am",
            href: "/maintenance/998",
          },
          {
            id: "a2",
            icon: "file",
            title: "Ada Admin, admin, shared Lease renewal 2027 — 1A.pdf",
            context: "Tina Renter, tenant · Maple Court 1A · Today, 16 Nov · 9:05 am",
            href: "/documents",
          },
        ],
      },
      {
        id: "2026-11-13",
        label: "Friday · 13 Nov 2026 · 3 days ago",
        items: [
          {
            id: "a3",
            icon: "dollar",
            title: "Raj Patel, tenant, sent $725 by Zelle",
            context: "Maple Court 1B · Awaiting verification · Fri 13 Nov · 6:12 pm",
            href: "/rent",
          },
          {
            id: "a4",
            icon: "check",
            title: "Bathroom fan completed · $180 · Harbor Electric, vendor",
            context: "Maple Court 1B · #MR-000990 · Fri 13 Nov 2026",
            href: "/maintenance/990",
          },
        ],
      },
    ],
  },
  rent: {
    scopeLine: "November 2026 · All 4 properties",
    headline: "$10,575 of $11,300 collected",
    progress: {
      percent: 94,
      label: "94% collected",
      caption: "$725 outstanding · 1 tenant 15 days late",
    },
    lines: [
      "Collected $10,575",
      "Outstanding $725 · 1 tenant 15 days late",
      "Awaiting verification $725 · Zelle",
    ],
    href: "/rent",
  },
  maintenance: {
    summaryLine: "3 open · 0 emergency · 1 unassigned",
    countLines: ["New 0 · Assigned 1 · In progress 1", "On hold 1 · Completed 1"],
    spendLine: "Spend · $180 this month · $1,240 this year",
    requests: [
      {
        id: "1000",
        heading: "#MR-001000 · Kitchen faucet leaking",
        context: "Maple Court · 1A · Tina Renter, tenant",
        statusLine: "High priority · Assigned → Attend scheduled visit",
        meta: "Sam Fixit, team · Tomorrow, Tue 17 Nov 2026",
        href: "/maintenance/1000",
      },
      {
        id: "998",
        heading: "#MR-000998 · Hallway light out",
        context: "Maple Court · Common area · Office report",
        statusLine: "In progress → Assign a team member",
        meta: "Unassigned · Updated today, Mon 16 Nov 2026",
        href: "/maintenance/998",
      },
      {
        id: "995",
        heading: "#MR-000995 · Boiler making noise",
        context: "Birch House · Lena Owner, landlord",
        statusLine: "On hold → Check part delivery",
        meta: "Follow-up in 4 days · Fri 20 Nov 2026",
        href: "/maintenance/995",
      },
    ],
    href: "/maintenance",
  },
  messages: {
    summaryLine: "3 unread · Latest conversations",
    threads: [
      {
        id: "t1",
        icon: "user",
        name: "Lena Owner · Landlord",
        preview: "Boiler follow-up — can we confirm the part?",
        time: "Today · 16 Nov",
        unread: true,
        href: "/messages",
      },
      {
        id: "t2",
        icon: "user",
        name: "Raj Patel · Tenant · 1B",
        preview: "Sent the rest by Zelle. Please verify.",
        time: "Fri · 13 Nov",
        unread: true,
        href: "/messages",
      },
      {
        id: "t3",
        icon: "wrench",
        name: "Sam Fixit · Team",
        preview: "Tomorrow’s faucet visit is confirmed.",
        time: "Today · 16 Nov",
        unread: true,
        href: "/messages",
      },
    ],
    href: "/messages",
  },
  listings: {
    summaryLine: "Homes on your public marketing site",
    headline: "6 live · 1 draft · 1 vacant not listed",
    inquiryLine: "3 new inquiries → Contact prospective renters",
    inquiryHref: "/applications",
    noteLines: ["Birch House · Unit 1", "Vacant, ready and not marketed"],
    href: "/listings",
  },
  portfolio: {
    groups: [
      {
        id: "lena",
        owner: "Lena Owner · Landlord",
        lines: ["Maple Court · 2 units", "Birch House · 1 vacant unit"],
      },
      {
        id: "oscar",
        owner: "Oscar Owner · Landlord",
        lines: ["Cedar Row · 4 units", "Elm Street Duplex · 2 units"],
      },
    ],
    totalsLine: "2 landlords · 4 properties · 9 units",
  },
};

/** Figma "All clear" · Rent this month. */
const fixtureAllClearRent: RentModel = {
  scopeLine: "",
  headline: "$11,300 of $11,300 collected",
  progress: null,
  lines: ["100% collected · $0 outstanding", "$0 awaiting verification · No late tenants"],
  noteLines: ["Raj Patel, tenant · $725 Zelle verified", "Today, Mon 16 Nov 2026"],
  href: "/rent",
};

/** Figma "All clear": nothing needs the office, rent fully collected, every home listed. */
export const fixtureAllClearModel: AdminDashboardModel = {
  ...fixtureModel,
  // No summary line under the heading in the all-clear frame (the card ignores it when empty).
  attention: {
    summaryLine: "",
    resolvedLine: "Resolved today · Mon 16 Nov 2026",
    items: [],
  },
  // The all-clear frame drops the scope line and the progress bar.
  rent: fixtureAllClearRent,
  // No summary line in the all-clear frame; two plain sentences replace the inquiry link.
  listings: {
    summaryLine: "",
    headline: "7 live · 1 draft · 0 not listed",
    inquiryLine: "Birch House Unit 1 is now live.\nNo new inquiries need a reply.",
    noteLines: [],
    href: "/listings",
  },
};

export const fixtureStates = {
  default: { status: "ready", model: fixtureModel },
  "all-clear": { status: "ready", model: fixtureAllClearModel },
  loading: { status: "loading" },
  empty: {
    status: "empty",
    statsLines: ["No properties · No units · No requests", "$0 expected · 0 live homes"],
    contactLines: ["Ada Admin · Admin · Landlord Gopher", "help@landlordgopher.example · (410) 555-0134"],
  },
  error: {
    status: "error",
    message: "I couldn’t retrieve your portfolio. Your saved records have not changed. Try again to get the latest data.",
    lastAttemptLine: "Last attempt · Just now, Mon 16 Nov 2026",
  },
} satisfies Record<string, AdminDashboardState>;

export type FixtureStateName = keyof typeof fixtureStates;
