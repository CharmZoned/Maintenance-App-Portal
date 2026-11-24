import { describe, expect, it } from "vitest";
import type { PropertyDocument } from "@/types";
import { DOCUMENT_UNAVAILABLE, downloadLandlordDocument } from "./download-document";

const doc = { id: 1, file_name: "Lease.pdf", storage_path: "1/lease.pdf" } as PropertyDocument;

describe("downloadLandlordDocument", () => {
  it("replaces a raw Storage error with plain copy", async () => {
    await expect(
      downloadLandlordDocument(doc, async () => {
        throw new Error("Object not found");
      }),
    ).rejects.toThrow(DOCUMENT_UNAVAILABLE);
    expect(DOCUMENT_UNAVAILABLE).toBe("This file isn't available right now. Message the office.");
  });
});
