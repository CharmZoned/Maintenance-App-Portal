// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
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

const earlier: NotificationItemData = {
  id: "earlier",
  sentence: "Boiler service was filed.",
  time: "Mon 10 Nov",
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

function buttonByText(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll("button")).find((button) => button.textContent === text);
}

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("landlord notifications panel chrome", () => {
  it("renders the header, mark-all control, and day groups", () => {
    const html = markup({
      chrome: "landlord",
      variant: "panel",
      items: [today, yesterday, { ...today, id: "today-2", sentence: "Hallway light out is in progress." }],
    });

    expect(html).toContain("Landlord portal");
    expect(html).toContain("Notifications");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('aria-label="Dismiss notifications"');
    expect(html).toContain("Mark all as read");
    expect(html).toContain("Today · 2 updates");
    expect(html).toContain("Yesterday · 1 update");
    expect(html).toContain("Work started on WO-1 · Leaking tap.");
    expect(html).toContain("Today 9:00 AM");
    expect(html).not.toContain("Stub · live push/email");
    expect(html).not.toContain("Mark all read");
  });

  it("groups an older short date in Earlier", () => {
    const html = markup({
      chrome: "landlord",
      items: [today, earlier, { ...earlier, id: "blank", sentence: "Undated note.", time: "" }],
    });
    expect(html).toContain("Today · 1 update");
    expect(html).toContain("Earlier · 2 updates");
    expect(html).toContain("Boiler service was filed.");
    expect(html).toContain("Mon 10 Nov");
    expect(html).toContain("Undated note.");
  });

  it("renders the phone sheet without a dismiss control", () => {
    const html = markup({ chrome: "landlord", variant: "sheet", items: [today] });
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("Today · 1 update");
    expect(html).not.toContain("Dismiss notifications");
    expect(html).not.toContain("Stub · live push/email");
  });

  it("renders the empty frame with the caught-up copy and Close", () => {
    const html = markup({ chrome: "landlord", variant: "panel", items: [] });
    expect(html).toContain("You&#x27;re all caught up.");
    expect(html).toContain("New updates will appear here.");
    expect(html).toContain(">Close<");
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain("Mark all as read");
    expect(html).not.toContain("Today ·");
    expect(html).not.toContain("Retry");
  });

  it("shows an error with retry when the load failed and there are no rows", () => {
    const html = markup({
      chrome: "landlord",
      items: [],
      loadFailed: true,
      onRetry: () => undefined,
    });
    expect(html).toContain("We couldn&#x27;t load this list. Check your connection and try again.");
    expect(html).toContain('role="alert"');
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("You&#x27;re all caught up.");
    expect(html).not.toContain("New updates will appear here.");
  });

  it("keeps the last rows visible when a later refresh failed", () => {
    const html = markup({ chrome: "landlord", items: [yesterday], loadFailed: true });
    expect(html).toContain("Yesterday · 1 update");
    expect(html).toContain("A tenant has an open request · Gate.");
    expect(html).not.toContain("You&#x27;re all caught up.");
    expect(html).not.toContain("Retry");
  });

  it("hides mark-all when every row is already read", () => {
    const html = markup({
      chrome: "landlord",
      items: [{ ...yesterday, unread: false }],
    });
    expect(html).not.toContain("Mark all as read");
    expect(html).toContain("Yesterday · 1 update");
    expect(html).toContain('aria-label="Close"');
  });

  it("moves focus to Close after Mark all as read unmounts", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const read = { ...today, unread: false };

    await act(async () => {
      root.render(
        createElement(NotificationsPanel, {
          open: true,
          chrome: "landlord",
          items: [today],
          onClose: () => undefined,
          onMarkAllRead: () => undefined,
        }),
      );
    });
    await flushFrame();

    const markAll = buttonByText(host, "Mark all as read");
    expect(markAll).toBeTruthy();
    markAll!.focus();
    expect(document.activeElement).toBe(markAll);

    await act(async () => {
      root.render(
        createElement(NotificationsPanel, {
          open: true,
          chrome: "landlord",
          items: [read],
          onClose: () => undefined,
          onMarkAllRead: () => undefined,
        }),
      );
    });
    await flushFrame();

    expect(buttonByText(host, "Mark all as read")).toBeUndefined();
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Close"]'));

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("leaves the shared N5 flyout chrome unchanged", () => {
    const html = markup({ items: [today] });
    expect(html).toContain("Mark all read");
    expect(html).toContain(">Close<");
    expect(html).toContain("Stub · live push/email notifications are not wired yet.");
    expect(html).toContain('aria-label="Dismiss notifications"');
    expect(html).not.toContain("Landlord portal");
    expect(html).not.toContain("Mark all as read");
  });

  it("does not call a failed N5 load caught up", () => {
    const html = markup({ items: [], loadFailed: true, onRetry: () => undefined });
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("You&#x27;re all caught up.");
  });
});
