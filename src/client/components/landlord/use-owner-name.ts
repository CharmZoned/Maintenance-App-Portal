import { useEffect, useState } from "react";
import type { Landlord } from "@/types";

/**
 * The owner's own name from their Landlords record ("Lena Owner"), the same
 * name the office sees. Auth metadata usually has no full name for owners, so
 * without this the chrome fell back to the email and greeted "Landlord".
 *
 * Pass the signed-in landlord's id, or null for any other role. Returns null
 * until the record loads, or when it can't be read.
 */
export function useOwnerName(landlordId: number | null): string | null {
  const [name, setName] = useState<{ id: number; value: string | null } | null>(null);

  useEffect(() => {
    if (landlordId == null) return;
    let cancelled = false;
    void import("@/lib/data")
      .then((data) => data.getLandlord(landlordId))
      .then(
        (row) => {
          if (!cancelled) setName({ id: landlordId, value: ownerDisplayName(row) });
        },
        () => {
          if (!cancelled) setName({ id: landlordId, value: null });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [landlordId]);

  return landlordId != null && name?.id === landlordId ? name.value : null;
}

export function ownerDisplayName(row: Pick<Landlord, "first_name" | "last_name" | "company_name">): string | null {
  const person = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean).join(" ");
  return person || row.company_name?.trim() || null;
}
