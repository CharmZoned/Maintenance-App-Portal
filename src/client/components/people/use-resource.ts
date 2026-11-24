import { useCallback, useEffect, useRef, useState } from "react";

export type ResourceState = "idle" | "loading" | "ready" | "error";

export interface Resource<T> {
  state: ResourceState;
  data: T;
  error: string | null;
  /** `quiet` keeps the current rows on screen while refreshing (after a save). */
  reload: (opts?: { quiet?: boolean }) => Promise<void>;
}

/**
 * One independently loaded list: its own loading, error and retry, so a
 * failure in one People tab never blanks the others (audit UX-13).
 * Disabled resources stay `idle` with the initial value.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  initial: T,
  enabled = true,
): Resource<T> {
  const [state, setState] = useState<ResourceState>(enabled ? "loading" : "idle");
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!enabled) return;
      const mine = ++seq.current;
      if (!opts?.quiet) setState("loading");
      try {
        const next = await fetcherRef.current();
        if (mine !== seq.current) return;
        setData(next);
        setError(null);
        setState("ready");
      } catch (err) {
        if (mine !== seq.current) return;
        setError((err as Error).message || "Something went wrong.");
        setState("error");
      }
    },
    [enabled],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, data, error, reload };
}
