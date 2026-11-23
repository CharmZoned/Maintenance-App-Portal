import type { DocumentVisibility, PropertyDocument } from "@/types";

/**
 * Shared landlord document copy (LP-A0).
 *
 * `docs/landlord-pages-plan.md` is not on staging or any fetched branch, so
 * these helpers are taken from Figma "001 - Landlord Pages" (document rows
 * `2037:560`, `2037:705`, `2037:585`, `2037:2040`, and the property documents
 * tab `2049:6098`) plus the fields already on `PropertyDocument`.
 *
 * Later landlord screens should build row copy through `landlordDocumentRowModel`
 * and group lists through `groupLandlordDocuments`. Share-direction filters
 * ("Shared with me" / "I shared") stay with the documents screen.
 *
 * TODO(data-gap): rows have `uploaded_by_role` but no uploader display name.
 * Pass `uploaderName` when the caller can resolve one.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type LandlordDocumentFileKind = "PDF" | "DOC" | "XLS" | "IMG" | "FILE";

/** Plain-fact badge. Lease and Notice are the named kinds; everything else is Other. */
export type LandlordDocumentBadge = "Lease" | "Notice" | "Other";

export type LandlordDocumentRowModel = {
  title: string;
  fileKind: LandlordDocumentFileKind;
  badge: LandlordDocumentBadge;
  /** "Whole building" or "Unit 1A". */
  scopeLabel: string;
  /** "Tenant and you" or "You and Landlord Gopher". */
  audienceLabel: string;
  /** "Uploaded by Ada Admin · 10 Feb · 0.4 MB". */
  uploadedLine: string;
};

type ScopeDoc = {
  unit_id?: number | null;
  unit_name?: string | null;
};

type GroupInput = ScopeDoc & {
  property_id: number;
  property_name?: string | null;
};

export type LandlordDocumentGroup<T> = {
  /** "building" or "unit:<id>". */
  key: string;
  /** "WHOLE BUILDING" or "UNIT 1A · TINA RENTER". */
  label: string;
  documents: T[];
};

export type LandlordPropertySection<T> = {
  propertyId: number;
  propertyName: string;
  groups: LandlordDocumentGroup<T>[];
};

/**
 * Byte size as written on the document row: "400 B", "1.5 KB", "0.4 MB".
 * Megabytes start at 0.1 MB so a 0.4 MB file stays "0.4 MB" (the frames),
 * not "409.6 KB".
 */
export function formatDocumentBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 0.1 * 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function documentFileKind(
  doc: Pick<PropertyDocument, "content_type" | "file_name">,
): LandlordDocumentFileKind {
  const mime = (doc.content_type || "").toLowerCase();
  const name = (doc.file_name || "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (mime.includes("word") || name.endsWith(".doc") || name.endsWith(".docx")) return "DOC";
  if (mime.includes("sheet") || mime.includes("excel") || name.endsWith(".xls") || name.endsWith(".xlsx")) {
    return "XLS";
  }
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return "IMG";
  return "FILE";
}

/**
 * No category column on PropertyDocuments. Addenda are Other so "Lease
 * addendum" is not a Lease. Notice is checked before lease so "Notice of
 * lease termination" stays a Notice. Only "house rules" is a Notice — bare
 * "rules" (community rules, parking rules) stays Other.
 */
export function documentBadge(
  doc: Pick<PropertyDocument, "title" | "file_name" | "notes">,
): LandlordDocumentBadge {
  const hay = `${doc.title} ${doc.file_name} ${doc.notes ?? ""}`.toLowerCase();
  if (/\b(addendum|addenda|amendment|rider)\b/.test(hay)) return "Other";
  if (/\b(notice|house\s+rules|fire\s+safety|announcement)\b/.test(hay)) return "Notice";
  if (/\b(lease|rental\s+agreement)\b/.test(hay)) return "Lease";
  return "Other";
}

export function documentScopeLabel(doc: ScopeDoc): string {
  if (doc.unit_id == null && !doc.unit_name?.trim()) return "Whole building";
  const name = doc.unit_name?.trim();
  if (name) return `Unit ${name}`;
  return `Unit #${doc.unit_id}`;
}

export function documentScopeGroupLabel(doc: ScopeDoc, occupantName?: string | null): string {
  if (doc.unit_id == null && !doc.unit_name?.trim()) return "WHOLE BUILDING";
  const unit = doc.unit_name?.trim() || `#${doc.unit_id}`;
  const who = occupantName?.trim();
  const unitLabel = `UNIT ${unit.toUpperCase()}`;
  return who ? `${unitLabel} · ${who.toUpperCase()}` : unitLabel;
}

/**
 * Who else can see the file, in the row's words.
 * Tenant-visible rows read "Tenant and you". Landlord-visible (not tenant)
 * rows read "You and Landlord Gopher".
 */
export function documentAudienceLabel(visibility: DocumentVisibility): string {
  switch (visibility) {
    case "tenant":
      return "Tenant and you";
    case "landlord":
      return "You and Landlord Gopher";
    case "staff":
      return "Landlord Gopher";
    default:
      return "You";
  }
}

/** Phone line under the badge. Scope is omitted when the section heading already says it. */
export function documentAudienceLine(scopeLabel: string, audienceLabel: string, showScope: boolean): string {
  if (showScope && scopeLabel) return `${scopeLabel} · Shared with: ${audienceLabel}`;
  return `Shared with: ${audienceLabel}`;
}

/**
 * Recent dates (today through six days ago) keep the weekday ("Mon 16 Nov").
 * Older dates in the same year are "10 Feb". A different year adds the year.
 */
export function formatDocumentDate(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parseDocumentDate(iso);
  if (!d) return "";
  const diff = calendarDaysBefore(d, now);
  const dayMonth = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (diff >= 0 && diff <= 6) return `${WEEKDAYS[d.getDay()]} ${dayMonth}`;
  if (d.getFullYear() !== now.getFullYear()) return `${dayMonth} ${d.getFullYear()}`;
  return dayMonth;
}

export function formatDocumentUploadedLine(
  parts: {
    uploader?: string | null;
    createdAt?: string | null;
    byteSize?: number | null;
    now?: Date;
  },
): string {
  const bits: string[] = [];
  const who = parts.uploader?.trim();
  if (who) bits.push(`Uploaded by ${who}`);
  const date = formatDocumentDate(parts.createdAt, parts.now);
  if (date) bits.push(date);
  const size = formatDocumentBytes(parts.byteSize);
  if (size) bits.push(size);
  return bits.join(" · ");
}

export function landlordDocumentRowModel(
  doc: Pick<
    PropertyDocument,
    | "title"
    | "file_name"
    | "content_type"
    | "notes"
    | "unit_id"
    | "unit_name"
    | "visibility"
    | "byte_size"
    | "created_at"
    | "uploaded_by_role"
  >,
  opts?: {
    uploaderName?: string | null;
    /** Append "(you)" when this viewer uploaded the file and a name is known. */
    uploadedByYou?: boolean;
    now?: Date;
  },
): LandlordDocumentRowModel {
  const title = doc.title?.trim() || doc.file_name?.trim() || "Document";
  return {
    title,
    fileKind: documentFileKind(doc),
    badge: documentBadge(doc),
    scopeLabel: documentScopeLabel(doc),
    audienceLabel: documentAudienceLabel(doc.visibility),
    uploadedLine: formatDocumentUploadedLine({
      uploader: uploaderLabel(doc.uploaded_by_role, opts?.uploaderName, opts?.uploadedByYou),
      createdAt: doc.created_at,
      byteSize: doc.byte_size,
      now: opts?.now,
    }),
  };
}

/**
 * Property sections, then whole-building before units. Document order inside a
 * group is the input order. Pass `occupantNameByUnitId` for "UNIT 1A · TINA RENTER".
 */
export function groupLandlordDocuments<T extends GroupInput>(
  docs: readonly T[],
  opts?: { occupantNameByUnitId?: ReadonlyMap<number, string | null | undefined> },
): LandlordPropertySection<T>[] {
  const properties = new Map<
    number,
    { propertyName: string; groups: Map<string, { label: string; documents: T[] }> }
  >();

  for (const doc of docs) {
    let property = properties.get(doc.property_id);
    if (!property) {
      property = {
        propertyName: propertyHeading(doc),
        groups: new Map(),
      };
      properties.set(doc.property_id, property);
    } else if (property.propertyName === `Property #${doc.property_id}` && doc.property_name?.trim()) {
      property.propertyName = doc.property_name.trim();
    }

    const key = scopeKey(doc);
    let group = property.groups.get(key);
    if (!group) {
      const occupant = doc.unit_id != null ? opts?.occupantNameByUnitId?.get(doc.unit_id) : null;
      group = { label: documentScopeGroupLabel(doc, occupant), documents: [] };
      property.groups.set(key, group);
    }
    group.documents.push(doc);
  }

  return [...properties.entries()]
    .map(([propertyId, property]) => ({
      propertyId,
      propertyName: property.propertyName,
      groups: [...property.groups.entries()]
        .map(([key, group]) => ({ key, label: group.label, documents: group.documents }))
        .sort((a, b) => {
          if (a.key === "building") return -1;
          if (b.key === "building") return 1;
          return a.label.localeCompare(b.label);
        }),
    }))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.propertyId - b.propertyId);
}

function propertyHeading(doc: GroupInput): string {
  return doc.property_name?.trim() || `Property #${doc.property_id}`;
}

function scopeKey(doc: ScopeDoc): string {
  if (doc.unit_id != null) return `unit:${doc.unit_id}`;
  const name = doc.unit_name?.trim();
  if (name) return `unit:name:${name.toLowerCase()}`;
  return "building";
}

function uploaderLabel(
  role: string | null | undefined,
  uploaderName: string | null | undefined,
  uploadedByYou: boolean | undefined,
): string | null {
  const name = uploaderName?.trim();
  if (uploadedByYou) return name ? `${name} (you)` : "You";
  if (name) return name;
  switch (role) {
    case "admin":
      return "Admin";
    case "staff":
      return "Staff";
    case "landlord":
      return "Landlord";
    case "tenant":
      return "Tenant";
    case "maintenance":
      return "Maintenance";
    default:
      return null;
  }
}

function parseDocumentDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Whole local days `now` is after `then` (negative when `then` is in the future). */
function calendarDaysBefore(then: Date, now: Date): number {
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.round((startNow.getTime() - startThen.getTime()) / 86_400_000);
}
