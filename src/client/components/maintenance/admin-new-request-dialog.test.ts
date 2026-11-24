import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AdminNewRequestFields,
  COMMON_AREA,
  EMPTY_NEW_REQUEST,
  NO_TENANT,
  createdNotice,
  hasErrors,
  newRequestPayload,
  photoCounterLabel,
  tenantChoiceForUnit,
  tenantOptionLabel,
  validateNewRequest,
  type AdminNewRequestFieldsProps,
  type AdminNewRequestValues,
} from "@/components/maintenance/admin-new-request-dialog";

const filled: AdminNewRequestValues = {
  ...EMPTY_NEW_REQUEST,
  title: "  Dishwasher not draining ",
  propertyId: "3",
  unitChoice: "12",
  tenantChoice: "7",
  category: "Appliance",
  priority: "urgent",
  description: " Water pools after every cycle ",
};

describe("validateNewRequest", () => {
  it("asks for title, property and category on an empty form", () => {
    const errors = validateNewRequest(EMPTY_NEW_REQUEST);
    expect(errors).toEqual({
      title: "Enter a title.",
      property: "Choose a property.",
      category: "Choose a category.",
    });
    expect(hasErrors(errors)).toBe(true);
  });

  it("passes a filled form; unit and tenant are optional", () => {
    expect(hasErrors(validateNewRequest(filled))).toBe(false);
    expect(
      hasErrors(validateNewRequest({ ...filled, unitChoice: "", tenantChoice: NO_TENANT })),
    ).toBe(false);
  });

  it("rejects a category that is not a current one", () => {
    expect(validateNewRequest({ ...filled, category: "Plumbing & heating" }).category).toBe(
      "Choose a category.",
    );
  });
});

describe("tenantChoiceForUnit", () => {
  const tenants = [
    { id: 7, active_unit_id: 12 },
    { id: 8, active_unit_id: 13 },
    { id: 9, active_unit_id: null },
  ];
  it("fills in the unit's current tenant", () => {
    expect(tenantChoiceForUnit(tenants, "12")).toBe("7");
    expect(tenantChoiceForUnit(tenants, "13")).toBe("8");
  });
  it("is No tenant for a vacant unit, common area or no unit", () => {
    expect(tenantChoiceForUnit(tenants, "99")).toBe(NO_TENANT);
    expect(tenantChoiceForUnit(tenants, COMMON_AREA)).toBe(NO_TENANT);
    expect(tenantChoiceForUnit(tenants, "")).toBe(NO_TENANT);
  });
});

describe("newRequestPayload", () => {
  it("creates an Open request with trimmed text and numeric ids", () => {
    expect(newRequestPayload(filled)).toEqual({
      title: "Dishwasher not draining",
      description: "Water pools after every cycle",
      category: "Appliance",
      priority: "urgent",
      status: "open",
      property_id: 3,
      unit_id: 12,
      tenant_id: 7,
    });
  });

  it("maps Common area and No tenant to null, and never sends staff-only fields", () => {
    const payload = newRequestPayload({
      ...filled,
      unitChoice: COMMON_AREA,
      tenantChoice: NO_TENANT,
      description: "  ",
    });
    expect(payload.unit_id).toBeNull();
    expect(payload.tenant_id).toBeNull();
    expect(payload.description).toBeNull();
    for (const key of ["worker_price", "landlord_price", "vendor_id", "notes", "assigned_staff_id", "scheduled_at"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});

describe("copy helpers", () => {
  it("photo counter", () => {
    expect(photoCounterLabel(0)).toBe("0 of 5 · optional");
    expect(photoCounterLabel(2)).toBe("2 of 5 · optional");
  });
  it("tenant option label", () => {
    expect(tenantOptionLabel({ first_name: "Tina", last_name: "Renter", active_unit_name: "1A" })).toBe(
      "Tina Renter · Unit 1A",
    );
    expect(tenantOptionLabel({ first_name: "Tina", last_name: "Renter", active_unit_name: null })).toBe(
      "Tina Renter",
    );
  });
  it("created notice", () => {
    expect(createdNotice(false)).toBe("Request created.");
    expect(createdNotice(true)).toMatch(/photos couldn't be added/);
  });
});

describe("AdminNewRequestFields", () => {
  const base: AdminNewRequestFieldsProps = {
    values: EMPTY_NEW_REQUEST,
    errors: {},
    properties: [{ id: 3, name: "Maple Court" }],
    units: [{ id: 12, name: "1A" }],
    tenants: [{ id: 7, first_name: "Tina", last_name: "Renter", active_unit_name: "1A" }],
    photos: [],
    onChange: () => {},
    onAddPhotos: () => {},
    onRemovePhoto: () => {},
  };
  const render = (props: Partial<AdminNewRequestFieldsProps> = {}) =>
    renderToStaticMarkup(createElement(AdminNewRequestFields, { ...base, ...props }));

  it("shows the short Figma field list and none of the old staff fields", () => {
    const html = render();
    for (const label of ["What's the problem?", "Property", "Unit", "Tenant", "Category", "Priority", "Description", "Photos"]) {
      expect(html).toContain(label.replace("'", "&#x27;"));
    }
    expect(html).toContain("0 of 5 · optional");
    expect(html).toContain("Add photos");
    expect(html).toContain("Filled in from the unit. Change it if someone else reported this.");
    for (const old of ["Worker price", "Landlord price", "Vendor", "Internal notes", "Status"]) {
      expect(html).not.toContain(old);
    }
    // No raw file picker in the field list.
    expect(html).not.toContain('type="file"');
  });

  it("keeps Unit disabled until a property is chosen", () => {
    expect(render()).toContain("Choose a property first");
    expect(render({ values: { ...EMPTY_NEW_REQUEST, propertyId: "3" } })).toContain("Choose a unit");
  });

  it("renders validation messages", () => {
    const html = render({ errors: validateNewRequest(EMPTY_NEW_REQUEST) });
    expect(html).toContain("Enter a title.");
    expect(html).toContain("Choose a property.");
    expect(html).toContain("Choose a category.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("shows chosen photos with remove buttons and hides Add photos at 5", () => {
    const photos = Array.from({ length: 5 }, (_, i) => ({
      key: String(i),
      url: `blob:${i}`,
      name: `p${i}.jpg`,
    }));
    const html = render({ photos });
    expect(html).toContain("5 of 5 · optional");
    expect(html).toContain("Remove photo 1 of 5");
    expect(html).not.toContain("Add photos");
  });
});
