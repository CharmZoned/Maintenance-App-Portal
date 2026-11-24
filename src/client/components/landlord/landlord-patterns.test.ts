import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandlordPortalTitle } from "@/components/landlord/chrome";
import { LandlordDocumentMenuButton, LandlordDocumentRow } from "@/components/landlord/document-row";
import { LandlordPageIntro } from "@/components/landlord/page-intro";
import { LandlordPropertyHeading, LandlordScopeHeading } from "@/components/landlord/section-heading";
import type { LandlordDocumentRowModel } from "@/lib/landlord-documents";

const house: LandlordDocumentRowModel = {
  title: "House rules.pdf",
  fileKind: "PDF",
  badge: "Notice",
  scopeLabel: "Whole building",
  audienceLabel: "Tenant and you",
  uploadedLine: "Uploaded by Ada Admin · 10 Feb · 0.4 MB",
};

describe("landlord pattern components", () => {
  it("uses the frame breadcrumb on desktop and the brand on phone", () => {
    const html = renderToStaticMarkup(
      createElement(LandlordPortalTitle, { crumb: "Landlord portal / Properties / Maple Court" }),
    );
    expect(html).toContain("Landlord Gopher");
    expect(html).toContain("md:hidden");
    expect(html).toContain("Landlord portal / Properties / Maple Court");
    expect(html).toContain("hidden");
    expect(html).toContain("md:inline");
  });

  it("lets a screen replace the phone label without changing the breadcrumb", () => {
    const html = renderToStaticMarkup(
      createElement(LandlordPortalTitle, {
        crumb: "Landlord portal / Maintenance / #MR-001000",
        mobileLabel: "#MR-001000",
      }),
    );
    expect(html).toContain("#MR-001000");
    expect(html).toContain("Landlord portal / Maintenance / #MR-001000");
    expect(html).not.toContain("Landlord Gopher");
  });

  it("renders the document row copy for both layouts", () => {
    const html = renderToStaticMarkup(
      createElement(LandlordDocumentRow, {
        model: house,
        onDownload: () => undefined,
        menu: createElement(LandlordDocumentMenuButton, { label: "Actions for House rules.pdf" }),
      }),
    );
    expect(html).toContain("House rules.pdf");
    expect(html).toContain("PDF");
    expect(html).toContain("Notice");
    expect(html).toContain("Whole building · Shared with: Tenant and you");
    expect(html).toContain("Shared with");
    expect(html).toContain("Tenant and you");
    expect(html).toContain("Uploaded by Ada Admin · 10 Feb · 0.4 MB");
    expect(html).toContain("Download House rules.pdf");
    expect(html).toContain("Actions for House rules.pdf");
    expect(html).toContain("md:hidden");
    expect(html).toContain("md:grid");
  });

  it("drops the scope title when the section heading already states it", () => {
    const html = renderToStaticMarkup(
      createElement(LandlordDocumentRow, {
        model: house,
        showScope: false,
        onDownload: () => undefined,
      }),
    );
    expect(html).toContain("Shared with: Tenant and you");
    expect(html).not.toContain("Whole building");
  });

  it("renders the page intro and section headings later screens reuse", () => {
    const intro = renderToStaticMarkup(
      createElement(LandlordPageIntro, {
        eyebrow: "Your property records",
        title: "Documents",
        description: "Keep every lease, notice and shared document in one place.",
      }),
    );
    expect(intro).toContain("Your property records");
    expect(intro).toContain("Documents");
    expect(intro).toContain("Keep every lease, notice and shared document in one place.");
    expect(intro).toContain("<h1");
    expect(intro).toContain("lg-heading");
    expect(intro).toContain("md:lg-display");
    expect(intro).not.toContain("md:text-[2.125rem]");

    expect(renderToStaticMarkup(createElement(LandlordPropertyHeading, { name: "Maple Court" }))).toContain(
      "Maple Court",
    );
    expect(renderToStaticMarkup(createElement(LandlordScopeHeading, { label: "WHOLE BUILDING" }))).toContain(
      "WHOLE BUILDING",
    );
  });
});
