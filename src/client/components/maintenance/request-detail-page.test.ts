import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandlordRequestDetail } from "@/components/maintenance/request-detail-page";
import { formatDocumentDate } from "@/lib/landlord-documents";
import type { MaintenanceComment, MaintenancePhoto, MaintenanceStatusEvent, WorkOrder } from "@/types";

function order(partial: Partial<WorkOrder> & Pick<WorkOrder, "id" | "title">): WorkOrder {
  return {
    property_id: 1,
    unit_id: 1,
    tenant_id: 1,
    vendor_id: null,
    description: "Kitchen faucet drips constantly.",
    category: "Plumbing",
    priority: "high",
    status: "scheduled",
    permission_to_enter: true,
    assigned_staff_id: 4,
    request_number: "MR-001000",
    scheduled_at: "2026-11-17",
    completed_at: null,
    worker_price: null,
    landlord_price: null,
    notes: null,
    created_at: "2026-11-14T14:12:00.000Z",
    property_name: "Maple Court",
    unit_name: "1A",
    tenant_first_name: "Tina",
    tenant_last_name: "Renter",
    ...partial,
  };
}

const photos: MaintenancePhoto[] = [
  {
    id: 1,
    maintenance_request_id: 10,
    storage_path: "a.jpg",
    caption: null,
    created_at: "2026-11-14T14:20:00.000Z",
    uploaded_by_role: "tenant",
    url: "https://example.test/faucet.jpg",
  },
];

const comments: MaintenanceComment[] = [
  {
    id: 1,
    maintenance_request_id: 10,
    body: "The drip is getting worse.",
    visibility: "tenant_visible",
    author_role: "tenant",
    author_staff_id: null,
    author_tenant_id: 1,
    created_at: "2026-11-15T23:20:00.000Z",
  },
  {
    id: 2,
    maintenance_request_id: 10,
    body: "Office only: waiting on the owner.",
    visibility: "internal",
    author_role: "admin",
    author_staff_id: 1,
    author_tenant_id: null,
    created_at: "2026-11-15T23:30:00.000Z",
  },
];

const history: MaintenanceStatusEvent[] = [
  {
    id: 1,
    maintenance_request_id: 10,
    from_status: null,
    to_status: "Open",
    changed_by_role: "tenant",
    note: "Created",
    created_at: "2026-11-14T14:12:00.000Z",
  },
  {
    id: 2,
    maintenance_request_id: 10,
    from_status: "Open",
    to_status: "Scheduled",
    changed_by_role: "admin",
    note: null,
    created_at: "2026-11-16T13:30:00.000Z",
  },
];

function render(props: Partial<Parameters<typeof LandlordRequestDetail>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(LandlordRequestDetail, {
      loading: false,
      loadError: null,
      order: order({ id: 10, title: "Kitchen faucet leaking" }),
      photos,
      comments,
      history,
      onRetry: () => undefined,
      navigate: () => undefined,
      ...props,
    }),
  );
}

describe("landlord request detail", () => {
  it("renders the read-only assigned frame and only tenant-visible comments", () => {
    const html = render();
    const scheduled = formatDocumentDate("2026-11-17");
    expect(html).toContain("‹ Maintenance");
    expect(html).toContain("Landlord portal / Maintenance / #MR-001000");
    expect(html).toContain("#MR-001000");
    expect(html).toContain("Kitchen faucet leaking");
    expect(html).toContain("Assigned");
    expect(html).toContain("High priority");
    expect(html).toContain("Unit 1A · Maple Court · Reported by Tina Renter");
    expect(html).toContain("Plumbing");
    expect(html).toContain("Kitchen faucet drips constantly.");
    expect(html).toContain("OK to enter if Tina isn’t home");
    expect(html).toContain("Maintenance");
    expect(html).toContain(scheduled);
    expect(html).toContain("Photos · 1");
    expect(html).toContain("Tap a photo to see it full size.");
    expect(html).toContain("https://example.test/faucet.jpg");
    expect(html).toContain("Status timeline");
    expect(html).toContain("Tina Renter reported this");
    expect(html).toContain(`Visit scheduled for ${scheduled}`);
    expect(html).toContain("The drip is getting worse.");
    expect(html).not.toContain("Office only: waiting on the owner.");
    expect(html).not.toContain("Created");
    expect(html).not.toContain("Write to Landlord Gopher");
    expect(html).not.toContain(">Send<");
    expect(html).not.toContain("Your messages with Landlord Gopher");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="file"');
  });

  it("renders the completed cost summary without an entry row", () => {
    const html = render({
      photos: [],
      comments: [],
      history: [
        {
          id: 9,
          maintenance_request_id: 11,
          from_status: "In Progress",
          to_status: "Closed",
          changed_by_role: "maintenance",
          note: null,
          created_at: "2026-11-13T19:45:00.000Z",
        },
      ],
      order: order({
        id: 11,
        title: "Bathroom fan",
        request_number: "MR-000990",
        status: "closed",
        priority: "normal",
        category: "Electrical",
        description: "Bathroom fan stopped working.",
        unit_name: "1B",
        tenant_first_name: "Raj",
        tenant_last_name: "Patel",
        vendor_name: "Harbor Electric",
        vendor_id: 3,
        landlord_price: 180,
        resolution_notes: "Fan motor replaced",
        completed_at: "2026-11-13T19:45:00.000Z",
        scheduled_at: null,
        assigned_staff_id: null,
        permission_to_enter: false,
        created_at: "2026-11-09T15:00:00.000Z",
      }),
    });
    expect(html).toContain("#MR-000990");
    expect(html).toContain("Bathroom fan");
    expect(html).toContain("Completed");
    expect(html).toContain("Cost · Completed");
    expect(html).toContain("$180 · Harbor Electric");
    expect(html).toContain("Fan motor replaced · $180 · Harbor Electric");
    expect(html).toContain("Electrical");
    expect(html).not.toContain("High priority");
    expect(html).not.toContain("Entry");
    expect(html).not.toContain("Please schedule first");
    expect(html).toContain("Photos · 0");
    expect(html).toContain("No photos yet.");
  });

  it("renders loading, error, and not-available frames", () => {
    const loading = render({ loading: true, order: null, photos: [], comments: [], history: [] });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("‹ Maintenance");

    const error = render({
      loadError: "The network dropped.",
      order: null,
      photos: [],
      comments: [],
      history: [],
    });
    expect(error).toContain("Couldn’t load this request");
    expect(error).toContain("The network dropped.");
    expect(error).toContain("Retry");

    const missing = render({ order: null, photos: [], comments: [], history: [] });
    expect(missing).toContain("This request isn’t available");
    expect(missing).toContain(
      "It may have been removed, or it’s no longer linked to one of your properties. If you think this is a mistake, message Landlord Gopher.",
    );
    expect(missing).toContain("Back to Maintenance");
    expect(missing).toContain("Message Landlord Gopher");
    expect(missing).not.toContain("Write to Landlord Gopher");
  });
});
