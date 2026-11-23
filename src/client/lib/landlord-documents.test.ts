import { describe, expect, it } from "vitest";
import {
  documentAudienceLabel,
  documentAudienceLine,
  documentBadge,
  documentFileKind,
  documentScopeGroupLabel,
  documentScopeLabel,
  formatDocumentBytes,
  formatDocumentDate,
  formatDocumentUploadedLine,
  groupLandlordDocuments,
  landlordDocumentRowModel,
} from "@/lib/landlord-documents";
import type { PropertyDocument } from "@/types";

const NOW = new Date("2026-11-17T12:00:00Z");

function doc(partial: Partial<PropertyDocument> = {}): PropertyDocument {
  return {
    id: 1,
    property_id: 1,
    unit_id: null,
    title: "House rules",
    file_name: "House rules.pdf",
    content_type: "application/pdf",
    byte_size: 419_430,
    storage_path: "1/house.pdf",
    visibility: "tenant",
    uploaded_by_role: "admin",
    notes: null,
    created_at: "2026-02-10T12:00:00Z",
    unit_name: null,
    property_name: "Maple Court",
    ...partial,
  };
}

describe("landlord document helpers", () => {
  it("formats byte sizes the way the document row writes them", () => {
    expect(formatDocumentBytes(null)).toBe("");
    expect(formatDocumentBytes(Number.NaN)).toBe("");
    expect(formatDocumentBytes(-1)).toBe("");
    expect(formatDocumentBytes(400)).toBe("400 B");
    expect(formatDocumentBytes(1536)).toBe("1.5 KB");
    expect(formatDocumentBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatDocumentBytes(419_430)).toBe("0.4 MB");
  });

  it("labels file kinds from mime type and extension", () => {
    expect(documentFileKind(doc())).toBe("PDF");
    expect(documentFileKind(doc({ content_type: null, file_name: "lease.docx" }))).toBe("DOC");
    expect(documentFileKind(doc({ content_type: "application/vnd.ms-excel", file_name: "rent.xls" }))).toBe("XLS");
    expect(documentFileKind(doc({ content_type: "image/png", file_name: "photo.png" }))).toBe("IMG");
    expect(documentFileKind(doc({ content_type: "text/plain", file_name: "notes.txt" }))).toBe("FILE");
  });

  it("maps the Figma badge set: Lease, Notice, Other", () => {
    expect(documentBadge(doc({ title: "House rules", file_name: "House rules.pdf" }))).toBe("Notice");
    expect(documentBadge(doc({ title: "Lease renewal 2027 – 1A", file_name: "Lease renewal 2027 – 1A.pdf" }))).toBe(
      "Lease",
    );
    expect(documentBadge(doc({ title: "Boiler service report", file_name: "Boiler service report.pdf" }))).toBe(
      "Other",
    );
    expect(documentBadge(doc({ title: "Lease addendum", file_name: "Lease addendum.pdf" }))).toBe("Other");
  });

  it("names whole-building and unit scope", () => {
    expect(documentScopeLabel(doc())).toBe("Whole building");
    expect(documentScopeLabel(doc({ unit_id: 11, unit_name: "1A" }))).toBe("Unit 1A");
    expect(documentScopeLabel(doc({ unit_id: 12, unit_name: null }))).toBe("Unit #12");
    expect(documentScopeGroupLabel(doc())).toBe("WHOLE BUILDING");
    expect(documentScopeGroupLabel(doc({ unit_id: 11, unit_name: "1A" }))).toBe("UNIT 1A");
    expect(documentScopeGroupLabel(doc({ unit_id: 11, unit_name: "1A" }), "Tina Renter")).toBe(
      "UNIT 1A · TINA RENTER",
    );
  });

  it("writes the shared-with line from visibility", () => {
    expect(documentAudienceLabel("tenant")).toBe("Tenant and you");
    expect(documentAudienceLabel("landlord")).toBe("You and Landlord Gopher");
    expect(documentAudienceLabel("staff")).toBe("Landlord Gopher");
    expect(documentAudienceLine("Whole building", "Tenant and you", true)).toBe(
      "Whole building · Shared with: Tenant and you",
    );
    expect(documentAudienceLine("Whole building", "Tenant and you", false)).toBe("Shared with: Tenant and you");
  });

  it("formats uploaded lines with a weekday only for the past week", () => {
    expect(formatDocumentDate("2026-11-16T12:00:00Z", NOW)).toBe("Mon 16 Nov");
    expect(formatDocumentDate("2026-11-15T12:00:00Z", NOW)).toBe("Sun 15 Nov");
    expect(formatDocumentDate("2026-02-10T12:00:00Z", NOW)).toBe("10 Feb");
    expect(formatDocumentDate("2025-01-03T12:00:00Z", NOW)).toBe("3 Jan 2025");
    expect(formatDocumentDate("2026-11-20T12:00:00Z", NOW)).toBe("20 Nov");
    expect(
      formatDocumentUploadedLine({
        uploader: "Ada Admin",
        createdAt: "2026-02-10T12:00:00Z",
        byteSize: 419_430,
        now: NOW,
      }),
    ).toBe("Uploaded by Ada Admin · 10 Feb · 0.4 MB");
  });

  it("builds the row model later screens render", () => {
    const house = landlordDocumentRowModel(doc(), { uploaderName: "Ada Admin", now: NOW });
    expect(house).toMatchObject({
      title: "House rules",
      fileKind: "PDF",
      badge: "Notice",
      scopeLabel: "Whole building",
      audienceLabel: "Tenant and you",
      uploadedLine: "Uploaded by Ada Admin · 10 Feb · 0.4 MB",
    });

    const own = landlordDocumentRowModel(
      doc({
        title: "Lease renewal 2027 – 1A",
        file_name: "Lease renewal 2027 – 1A.pdf",
        unit_id: 11,
        unit_name: "1A",
        visibility: "tenant",
        uploaded_by_role: "landlord",
        created_at: "2026-11-16T12:00:00Z",
        byte_size: Math.round(1.4 * 1024 * 1024),
      }),
      { uploaderName: "Lena Owner", uploadedByYou: true, now: NOW },
    );
    expect(own.badge).toBe("Lease");
    expect(own.scopeLabel).toBe("Unit 1A");
    expect(own.uploadedLine).toBe("Uploaded by Lena Owner (you) · Mon 16 Nov · 1.4 MB");

    const boiler = landlordDocumentRowModel(
      doc({
        title: "Boiler service report",
        file_name: "Boiler service report.pdf",
        visibility: "landlord",
        created_at: "2026-11-15T12:00:00Z",
      }),
      { uploaderName: "Ada Admin", now: NOW },
    );
    expect(boiler.badge).toBe("Other");
    expect(boiler.audienceLabel).toBe("You and Landlord Gopher");
    expect(boiler.uploadedLine.startsWith("Uploaded by Ada Admin · Sun 15 Nov")).toBe(true);

    expect(landlordDocumentRowModel(doc({ uploaded_by_role: "admin" }), { uploadedByYou: true, now: NOW }).uploadedLine).toContain(
      "Uploaded by You ·",
    );
  });

  it("groups by property, whole building first, then unit", () => {
    const sections = groupLandlordDocuments(
      [
        doc({ id: 3, property_id: 2, property_name: "Birch House", title: "Boiler", file_name: "Boiler.pdf" }),
        doc({ id: 2, property_id: 1, unit_id: 12, unit_name: "1B", title: "Notice 1B", file_name: "Notice 1B.pdf" }),
        doc({ id: 1, property_id: 1, title: "House rules", file_name: "House rules.pdf" }),
        doc({
          id: 4,
          property_id: 1,
          unit_id: 11,
          unit_name: "1A",
          title: "Lease",
          file_name: "Lease.pdf",
        }),
      ],
      { occupantNameByUnitId: new Map([[11, "Tina Renter"]]) },
    );

    expect(sections.map((section) => section.propertyName)).toEqual(["Birch House", "Maple Court"]);
    expect(sections[1].groups.map((group) => group.label)).toEqual([
      "WHOLE BUILDING",
      "UNIT 1A · TINA RENTER",
      "UNIT 1B",
    ]);
    expect(sections[1].groups[0].documents.map((row) => row.id)).toEqual([1]);
    expect(sections[1].groups[1].key).toBe("unit:11");
    expect(groupLandlordDocuments([])).toEqual([]);
  });
});
