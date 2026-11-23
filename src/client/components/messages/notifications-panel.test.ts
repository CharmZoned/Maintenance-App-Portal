import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationsPanel } from "./notifications-panel";
import type { NotificationItemData } from "@/lib/messages";

const today: NotificationItemData = {
  id: "today",
  sentence: "Work started on WO-1 · Leaking tap.",
  time: "Today 9:00 AM",
  unread: true,
  stub: true,
};

const yesterday: NotificationItemData = {
  id: "yesterday",
  sentence: "A tenant has an open request · Gate.",
  time: "Yesterday",
  unread: false,
  stub: true,
};

function markup(
  props: Partial<ComponentProps<typeof NotificationsPanel>> &
    Pick<ComponentProps<typeof NotificationsPanel>, "items">,
) {
  return renderToStaticMarkup(
    createElement(NotificationsPanel, {
      open: true,
      onClose: () => undefined,
      onMarkAllRead: () => undefined,
      ...props,
    }),
  );
}

describe("landlord notifications panel chrome", () => {
  it("renders the desktop frame header, mark-all control, and day groups", () => {
    const html = markup({
      chrome: "landlord",
      variant: "panel",
      items: [today, yesterday, { ...today, id: "today-2", sentence: "Hallway light out is in progress." }],
    });

    expect(html).toContain("Landlord portal");
    expect(html).toContain("uppercase");
    expect(html).toContain("Notifications");
    expect(html).toContain("lg-heading");
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("×");
    expect(html).toContain("Mark all as read");
    expect(html).toContain("w-[180px]");
    expect(html).toContain("border-ring");
    expect(html).toContain("Today · 2 updates");
    expect(html).toContain("Yesterday · 1 update");
    expect(html).toContain("Work started on WO-1 · Leaking tap.");
    expect(html).toContain("Today 9:00 AM");
    expect(html).toContain("min-h-[108px]");
    expect(html).toContain("bg-foreground");
    expect(html).toContain("w-[480px]");
    expect(html).toContain("lg-admin");
    expect(html).toContain('aria-label="Dismiss notifications"');
    expect(html).not.toContain("Stub · live push/email");
    expect(html).not.toContain("Mark all read");
  });

  it("renders the phone sheet without the desktop width", () => {
    const html = markup({ chrome: "landlord", variant: "sheet", items: [today] });
    expect(html).toContain("fixed inset-0");
    expect(html).not.toContain("w-[480px]");
    expect(html).not.toContain("Dismiss notifications");
    expect(html).toContain("Today · 1 update");
  });

  it("renders the empty frame with the caught-up copy and a full-width close", () => {
    const html = markup({ chrome: "landlord", variant: "panel", items: [] });
    expect(html).toContain("You&#x27;re all caught up.");
    expect(html).toContain("New updates will appear here.");
    expect(html).toContain(">Close<");
    expect(html).toContain("w-full");
    expect(html).not.toContain("Mark all as read");
    expect(html).not.toContain("Today ·");
  });

  it("hides mark-all when every row is already read", () => {
    const html = markup({
      chrome: "landlord",
      items: [{ ...yesterday, unread: false }],
    });
    expect(html).not.toContain("Mark all as read");
    expect(html).toContain("Yesterday · 1 update");
  });

  it("leaves the shared N5 flyout chrome unchanged", () => {
    const html = markup({ items: [today] });
    expect(html).toContain("Mark all read");
    expect(html).toContain(">Close<");
    expect(html).toContain("Stub · live push/email notifications are not wired yet.");
    expect(html).not.toContain("Landlord portal");
    expect(html).not.toContain("Mark all as read");
    expect(html).toContain("h-[560px]");
  });
});
