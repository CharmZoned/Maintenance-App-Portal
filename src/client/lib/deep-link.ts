/** Parse a positive numeric query id; null if missing/invalid. */
export function queryId(search: string, param: string): number | null {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(param);
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

/** Read YYYY-MM period from query when well-formed. */
export function queryPeriod(search: string, param = "period"): string | null {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(param);
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  return null;
}
