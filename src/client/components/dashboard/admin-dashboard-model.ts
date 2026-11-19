/**
 * Admin Dashboard view model (Figma "001 - Admin Pages" · AH — Dashboard).
 *
 * The view is presentational: every string here is already worded and
 * formatted. `lib/admin-dashboard.ts` builds this from portal data; the cards
 * only lay it out. Clickable things carry an in-app `href` (path + query) that
 * the page hands to the router — cards never navigate on their own.
 */

/** Icon vocabulary shared by the admin cards (mapped to Lucide in dashboard-primitives). */
export type AdminIconName =
  | "home"
  | "dollar"
  | "wrench"
  | "user"
  | "calendar"
  | "building"
  | "file"
  | "check"
  | "message"
  | "clock"
  | "key"
  | "login"
  | "globe"
  | "settings"
  | "plus";

/** Shown in every state, including loading and error. */
export interface DashboardIntroModel {
  /** "Your portfolio, at a glance" — rendered uppercase. */
  eyebrow: string;
  /** "Good morning, Ada." */
  greeting: string;
  /** "Your office command center · Monday 16 November 2026" */
  dateLine: string;
}

export interface KpiTile {
  id: string;
  /** "Open requests" */
  label: string;
  /** "3", "94%", or "—" when the number is not available. */
  value: string;
  /** "0 emergency · 1 unassigned" */
  detail: string;
  /** Where the tile goes when clicked; omit for a static tile. */
  href?: string;
}

export interface AttentionItem {
  id: string;
  icon: AdminIconName;
  /** "Verify $725 Zelle from Raj Patel" */
  title: string;
  /** "Tenant · Maple Court 1B · 15 days late" */
  context: string;
  /** Opens the record the item is about (the row with the chevron). */
  href: string;
  /** "Verify" — the one action that resolves the item. */
  actionLabel: string;
  /** Where the action button goes; defaults to `href`. */
  actionHref?: string;
}

export interface AttentionModel {
  /** "6 items · Ranked by urgency. Only your office can resolve these." */
  summaryLine: string;
  /** Ranked most urgent first. Empty = all clear. */
  items: AttentionItem[];
  /** All-clear footer: "Resolved today · Mon 16 Nov 2026". */
  resolvedLine: string;
}

export type DashboardEventKind =
  | "visit"
  | "follow_up"
  | "rent_due"
  | "lease_start"
  | "lease_end"
  | "move_in";

export interface DashboardCalendarEvent {
  id: string;
  kind: DashboardEventKind;
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** "Scheduled visit · 10:00–11:00 am" */
  title: string;
  /** "Kitchen faucet leaking · #MR-001000" */
  record: string;
  /** People and place lines under the event: ["Sam Fixit, team · Tina Renter, tenant", "Maple Court · Unit 1A"]. */
  details: string[];
  /** "Open request" */
  actionLabel: string;
  href: string;
}

export interface DashboardCalendarModel {
  /** Local `YYYY-MM-DD` the dashboard treats as today. */
  today: string;
  events: DashboardCalendarEvent[];
  /** "Open full calendar" target. */
  href: string;
}

export interface ActivityItem {
  id: string;
  icon: AdminIconName;
  /** "Lee Wrench, team, updated Hallway light out" */
  title: string;
  /** "Maple Court · common area · Today, 16 Nov 2026 · 9:15 am" */
  context: string;
  href?: string;
}

export interface ActivityGroup {
  id: string;
  /** "Today · Mon 16 Nov 2026" — rendered uppercase. */
  label: string;
  items: ActivityItem[];
}

export interface ActivityModel {
  /** "Across all properties · People shown by name and role" */
  summaryLine: string;
  groups: ActivityGroup[];
}

export interface RentModel {
  /** "November 2026 · All 4 properties"; empty hides the line. */
  scopeLine: string;
  /** "$10,575 of $11,300 collected" */
  headline: string;
  /** Progress block; null when nothing is expected this month. */
  progress: {
    /** 0–100, drives the bar fill. */
    percent: number;
    /** "94% collected" */
    label: string;
    /** "$725 outstanding · 1 tenant 15 days late" */
    caption: string;
  } | null;
  /** "Collected $10,575", "Outstanding $725 · 1 tenant 15 days late", … */
  lines: string[];
  /** Latest rent event in the caption style: ["Raj Patel, tenant · $725 Zelle verified", "Today, Mon 16 Nov 2026"]. */
  noteLines?: string[];
  /** "Open rent" target. */
  href: string;
}

export interface RequestSummary {
  id: string;
  /** "#MR-001000 · Kitchen faucet leaking" */
  heading: string;
  /** "Maple Court · 1A · Tina Renter, tenant" */
  context: string;
  /** Status, always followed by the next step: "High priority · Assigned → Attend scheduled visit". */
  statusLine: string;
  /** "Sam Fixit, team · Tomorrow, Tue 17 Nov 2026" */
  meta: string;
  href: string;
}

export interface MaintenanceSnapshotModel {
  /** "3 open · 0 emergency · 1 unassigned" */
  summaryLine: string;
  /** ["New 0 · Assigned 1 · In progress 1", "On hold 1 · Completed 1"] */
  countLines: string[];
  /** "Spend · $180 this month · $1,240 this year"; null when spend is unknown. */
  spendLine: string | null;
  requests: RequestSummary[];
  /** "View queue" target. */
  href: string;
}

export interface ThreadSummary {
  id: string;
  icon: AdminIconName;
  /** "Lena Owner · Landlord" */
  name: string;
  /** "Boiler follow-up — can we confirm the part?" */
  preview: string;
  /** "Today · 16 Nov" */
  time: string;
  unread: boolean;
  href: string;
}

export interface MessagesModel {
  /** "3 unread · Latest conversations" */
  summaryLine: string;
  threads: ThreadSummary[];
  /** "Open messages" target. */
  href: string;
}

export interface ListingsModel {
  /** "Homes on your public marketing site"; empty hides the line. */
  summaryLine: string;
  /** "6 live · 1 draft · 1 vacant not listed" */
  headline: string;
  /**
   * "3 new inquiries → Contact prospective renters"; null when there is nothing
   * to say. A link when `inquiryHref` is set, otherwise plain text; line
   * breaks are kept.
   */
  inquiryLine: string | null;
  inquiryHref?: string;
  /** ["Birch House · Unit 1", "Vacant, ready and not marketed"] */
  noteLines: string[];
  /** "Manage listings" target. */
  href: string;
}

export interface PortfolioGroup {
  id: string;
  /** "Lena Owner · Landlord" */
  owner: string;
  /** ["Maple Court · 2 units", "Birch House · 1 vacant unit"] */
  lines: string[];
}

export interface PortfolioModel {
  groups: PortfolioGroup[];
  /** "2 landlords · 4 properties · 9 units" */
  totalsLine: string;
}

export interface AdminDashboardModel {
  kpis: KpiTile[];
  attention: AttentionModel;
  calendar: DashboardCalendarModel;
  activity: ActivityModel;
  rent: RentModel;
  maintenance: MaintenanceSnapshotModel;
  messages: MessagesModel;
  listings: ListingsModel;
  portfolio: PortfolioModel;
}

export type AdminDashboardState =
  | { status: "loading" }
  | {
      status: "error";
      /** "I couldn’t retrieve your portfolio. Your saved records have not changed. Try again to get the latest data." (the card adds the "Error · " prefix) */
      message: string;
      /** "Last attempt · Just now, Mon 16 Nov 2026" */
      lastAttemptLine: string;
    }
  | {
      /** No properties yet. */
      status: "empty";
      /** ["No properties · No units · No requests", "$0 expected · 0 live homes"] */
      statsLines: string[];
      /** ["Ada Admin · Admin · Landlord Gopher", "help@landlordgopher.example · (410) 555-0134"] */
      contactLines: string[];
    }
  | { status: "ready"; model: AdminDashboardModel };

/** Page-level strip under the intro (Figma "Success notice" frame). */
export interface DashboardNoticeModel {
  tone: "success" | "error";
  message: string;
}
