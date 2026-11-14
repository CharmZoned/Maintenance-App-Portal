/** Parse a positive integer query id; null if missing/invalid. Digits only (no `1e2` / hex). */
export function queryId(search: string, param: string): number | null {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(param);
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

/** Read YYYY-MM period from query when well-formed. */
export function queryPeriod(search: string, param = "period"): string | null {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(param);
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  return null;
}

export type DeepLinkProps = {
  search?: string;
  replace?: (to: string) => void;
};

/**
 * Single-flight list loader: concurrent callers share one in-flight promise
 * so mount + deep-link effects do not double-fetch.
 */
export function createSingleFlightLoader<T>(fetchList: () => Promise<T[]>): {
  load: () => Promise<T[]>;
} {
  let inflight: Promise<T[]> | null = null;
  return {
    load: () => {
      if (!inflight) {
        inflight = fetchList().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
