/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppContext } from "@/context";
import type { Property, PropertyDocument } from "@/types";
import { LandlordDocumentsPage } from "./landlord-documents-page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function doc(partial: Partial<PropertyDocument> & Pick<PropertyDocument, "id" | "title" | "property_id">): PropertyDocument {
  return {
    unit_id: null,
    file_name: `${partial.title}.pdf`,
    content_type: "application/pdf",
    byte_size: 400,
    storage_path: `${partial.property_id}/${partial.id}.pdf`,
    visibility: "tenant",
    uploaded_by_role: "admin",
    notes: null,
    created_at: "2026-02-10T12:00:00Z",
    unit_name: null,
    property_name: partial.property_id === 2 ? "Birch House" : "Maple Court",
    ...partial,
  };
}

const house = doc({
  id: 1,
  title: "House rules",
  property_id: 1,
  created_at: "2026-02-10T12:00:00Z",
});
const renewal = doc({
  id: 2,
  title: "Lease renewal",
  property_id: 1,
  unit_id: 11,
  unit_name: "1A",
  uploaded_by_role: "landlord",
  created_at: "2026-11-16T12:00:00Z",
});
const boiler = doc({
  id: 3,
  title: "Boiler service report",
  property_id: 2,
  property_name: "Birch House",
  created_at: "2026-11-15T12:00:00Z",
});

function property(id: number, name: string): Property {
  return {
    id,
    name,
    type: "multi_family",
    address: null,
    city: null,
    state: null,
    zip: null,
    year_built: null,
    notes: null,
    color: "#19394d",
    landlord_id: 1,
    created_at: "2026-01-01T00:00:00Z",
  };
}

const maple = property(1, "Maple Court");
const birch = property(2, "Birch House");
const cedar = property(3, "Cedar Lane");

describe("landlord documents filters", () => {
  let host: HTMLDivElement;
  let root: Root;
  let docs: PropertyDocument[];
  let properties: Property[];
  let fail: boolean;
  let listPropertyDocuments: () => Promise<PropertyDocument[]>;
  const setError = vi.fn();

  beforeEach(() => {
    docs = [house, renewal, boiler];
    properties = [maple, birch, cedar];
    fail = false;
    listPropertyDocuments = () => {
      if (fail) return Promise.reject(new Error("network"));
      return Promise.resolve(docs);
    };
    setError.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function paint() {
    const list = listPropertyDocuments;
    await act(async () => {
      root.render(
        createElement(
          AppContext.Provider,
          {
            value: {
              listPropertyDocuments: list,
              getPropertyDocumentDownloadUrl: async () => "https://example.test/doc",
              setError,
              properties,
            } as never,
          },
          createElement(LandlordDocumentsPage),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function button(name: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === name);
  }

  function body(): string {
    return document.body.textContent ?? "";
  }

  async function chooseProperty(name: string) {
    const trigger = document.querySelector('[role="combobox"]');
    if (!trigger) throw new Error("property filter missing");
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent?.trim() === name);
    if (!option) throw new Error(`property option ${name} missing`);
    await act(async () => {
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("hides I shared and lists every document on All", async () => {
    await paint();
    expect(button("I shared")).toBeUndefined();
    expect(button("All")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Shared with me")?.getAttribute("aria-pressed")).toBe("false");
    expect(body()).toContain("Your property records");
    expect(body()).toContain("Keep every lease, notice and shared document in one place.");
    expect(body()).toContain("House rules");
    expect(body()).toContain("Lease renewal");
    expect(body()).toContain("Boiler service report");
    expect(body()).toContain("Property: All properties");
    // Exactly one page heading: the intro h1 (the toolbar title is a label).
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("filters to documents shared with the landlord", async () => {
    await paint();
    await act(async () => {
      button("Shared with me")?.click();
    });
    expect(button("Shared with me")?.getAttribute("aria-pressed")).toBe("true");
    expect(body()).toContain("House rules");
    expect(body()).toContain("Boiler service report");
    expect(body()).not.toContain("Lease renewal");

    await act(async () => {
      button("All")?.click();
    });
    expect(body()).toContain("Lease renewal");
  });

  it("filters by property and clears an empty result", async () => {
    await paint();
    await chooseProperty("Cedar Lane");
    expect(body()).toContain("Property: Cedar Lane");
    expect(body()).toContain("No documents for Cedar Lane yet. Try another property.");
    expect(body()).not.toContain("House rules");

    await act(async () => {
      button("Clear filter")?.click();
    });
    expect(body()).toContain("Property: All properties");
    expect(body()).toContain("House rules");
    expect(body()).toContain("Lease renewal");
    expect(body()).toContain("Boiler service report");
    expect(button("Clear filter")).toBeUndefined();
  });

  it("resets a property filter whose option disappeared", async () => {
    await paint();
    await chooseProperty("Birch House");
    expect(body()).toContain("Property: Birch House");
    expect(body()).toContain("Boiler service report");
    expect(body()).not.toContain("House rules");

    docs = [house, renewal];
    properties = [maple];
    listPropertyDocuments = () => Promise.resolve(docs);
    await paint();

    expect(body()).toContain("Property: All properties");
    expect(body()).toContain("House rules");
    expect(body()).toContain("Lease renewal");
    expect(body()).not.toContain("Boiler service report");
  });

  it("retries a failed load from the error pattern", async () => {
    fail = true;
    await paint();
    expect(body()).toContain("Documents could not load. Please try again.");
    expect([...document.querySelectorAll("button")].filter((el) => el.textContent?.trim() === "Retry")).toHaveLength(1);
    expect(setError).toHaveBeenCalledWith("network");

    fail = false;
    await act(async () => {
      button("Retry")?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(body()).not.toContain("Documents could not load. Please try again.");
    expect(body()).toContain("House rules");
    expect(button("Retry")).toBeUndefined();
  });
});
