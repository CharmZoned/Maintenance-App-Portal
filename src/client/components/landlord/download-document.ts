import type { PropertyDocument } from "@/types";

/** Shown instead of a raw Storage error such as "Object not found". */
export const DOCUMENT_UNAVAILABLE = "This file isn't available right now. Message the office.";

/**
 * Downloads a document for an owner. The signed URL is minted with
 * `download: file_name` (getPropertyDocumentDownloadUrl), so Storage sends it
 * as an attachment under its real name; the anchor's `download` attribute
 * covers same-origin hosts. Any failure to sign the link throws
 * DOCUMENT_UNAVAILABLE, never the Storage message.
 */
export async function downloadLandlordDocument(
  doc: PropertyDocument,
  getUrl: (doc: PropertyDocument) => Promise<string>,
): Promise<void> {
  let url: string;
  try {
    url = await getUrl(doc);
  } catch {
    throw new Error(DOCUMENT_UNAVAILABLE);
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = doc.file_name;
  anchor.rel = "noreferrer";
  anchor.target = "_blank";
  anchor.click();
}
