import type { Lease, Property, Unit } from "@/types";

/**
 * Which homes are on the public website, and which vacant ones are not.
 *
 * Shared by the Dashboard ("Homes live online", the vacancy attention items)
 * and the read-only Website listings page, so both always tell the same story.
 * A unit is "live" when `Units.currently_being_marketed` is set; the portal has
 * no draft state.
 */

/**
 * Vacant units nobody has a lease on yet (no upcoming or active lease) that
 * are not on the website. With `marketedUnitIds` null (flags unknown) every
 * such vacant unit is returned. Ready homes first, then property name, then
 * unit label.
 */
export function vacantUnlistedUnits(input: {
  units: Unit[];
  marketedUnitIds: Set<number> | null;
  leases: Lease[] | null;
  propertyById: Map<number, Property>;
}): Unit[] {
  const { units, marketedUnitIds, leases, propertyById } = input;
  // A vacant unit with a lease already signed (upcoming) or running is spoken for.
  const leasedUnitIds = new Set(
    (leases ?? [])
      .filter((l) => l.status === "upcoming" || l.status === "active")
      .map((l) => l.unit_id),
  );
  return units
    .filter(
      (u) =>
        u.status === "vacant" &&
        !leasedUnitIds.has(u.id) &&
        !(marketedUnitIds?.has(u.id) ?? false),
    )
    .sort((a, b) => {
      // Ready homes first: they are the ones that could be earning rent today.
      const ready = Number(b.readiness_status === "ready") - Number(a.readiness_status === "ready");
      if (ready !== 0) return ready;
      return byPlace(a, b, propertyById);
    });
}

/** Units on the website, by property name then unit label. */
export function liveUnits(input: {
  units: Unit[];
  marketedUnitIds: Set<number>;
  propertyById: Map<number, Property>;
}): Unit[] {
  return input.units
    .filter((u) => input.marketedUnitIds.has(u.id))
    .sort((a, b) => byPlace(a, b, input.propertyById));
}

function byPlace(a: Unit, b: Unit, propertyById: Map<number, Property>): number {
  const pa = propertyById.get(a.property_id)?.name ?? a.property_name ?? "";
  const pb = propertyById.get(b.property_id)?.name ?? b.property_name ?? "";
  return pa.localeCompare(pb) || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id;
}
