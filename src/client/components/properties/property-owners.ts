import type { Landlord, Property } from "@/types";

/**
 * The admin Properties page shows the portfolio by owner (the landlord a
 * property belongs to): one entry per landlord that owns at least one
 * property, with their property, unit and occupancy totals. Pure, so the
 * grouping and wording are unit-tested without rendering.
 */
export interface PropertyOwner {
  /** Landlord id (`Properties.landlord_id`). */
  id: number;
  /** "Lena Owner" — the person's name, else the company name. */
  name: string;
  /** "Owner Holdings LLC" when the landlord has a company besides a name; else null. */
  company: string | null;
  propertyCount: number;
  unitCount: number;
  occupiedCount: number;
}

/** Shown when a property's landlord can't be resolved to a name. */
export const UNKNOWN_OWNER = "Owner not set";

function personName(landlord: Pick<Landlord, "first_name" | "last_name">): string {
  return [landlord.first_name, landlord.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/** Name and company line for one landlord id. */
export function ownerIdentity(
  landlordId: number,
  landlordsById: ReadonlyMap<number, Landlord>,
  fallbackName?: string | null,
): { name: string; company: string | null } {
  const landlord = landlordsById.get(landlordId);
  if (landlord) {
    const person = personName(landlord);
    const company = landlord.company_name?.trim() || null;
    if (person) return { name: person, company };
    if (company) return { name: company, company: null };
  }
  return { name: fallbackName?.trim() || UNKNOWN_OWNER, company: null };
}

export function landlordIndex(landlords: readonly Landlord[]): Map<number, Landlord> {
  return new Map(landlords.map((landlord) => [landlord.id, landlord]));
}

/** Owners of `properties`, alphabetical by name (ties by id). */
export function buildPropertyOwners(
  properties: readonly Property[],
  landlordsById: ReadonlyMap<number, Landlord>,
): PropertyOwner[] {
  const owners = new Map<number, PropertyOwner>();
  for (const property of properties) {
    let owner = owners.get(property.landlord_id);
    if (!owner) {
      owner = {
        id: property.landlord_id,
        ...ownerIdentity(property.landlord_id, landlordsById, property.landlord_name),
        propertyCount: 0,
        unitCount: 0,
        occupiedCount: 0,
      };
      owners.set(property.landlord_id, owner);
    }
    owner.propertyCount += 1;
    owner.unitCount += property.unit_count ?? 0;
    owner.occupiedCount += property.occupied_count ?? 0;
  }
  return [...owners.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "4 properties · 11 units · 9/11 occupied" — the same shape as the page summary. */
export function portfolioSummary(totals: {
  propertyCount: number;
  unitCount: number;
  occupiedCount: number;
}): string {
  return [
    plural(totals.propertyCount, "property", "properties"),
    plural(totals.unitCount, "unit"),
    `${totals.occupiedCount}/${totals.unitCount} occupied`,
  ].join(" · ");
}

/** Owner filter in the URL: `?owner=<landlord id>`; null for all owners. */
export const OWNER_PARAM = "owner";

export function parseOwnerParam(search: string): number | null {
  const raw = new URLSearchParams(search).get(OWNER_PARAM);
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** `search` with the owner filter set (or removed for null), other params kept. */
export function withOwnerParam(search: string, ownerId: number | null): string {
  const params = new URLSearchParams(search);
  if (ownerId == null) params.delete(OWNER_PARAM);
  else params.set(OWNER_PARAM, String(ownerId));
  const next = params.toString();
  return next ? `?${next}` : "";
}
