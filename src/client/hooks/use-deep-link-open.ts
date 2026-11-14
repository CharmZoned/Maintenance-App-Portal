import { useEffect, useRef } from "react";
import { queryId } from "@/lib/deep-link";

/**
 * Open a record from `?param=id` once the list is ready.
 * Uses a single-flight `loadList` when the current list is empty; never applies
 * callbacks after unmount / search change (cancelled flag).
 *
 * `onFound` must clear/replace the URL itself. `onMiss` runs only when the id
 * is absent from the list (typically strip the query).
 */
export function useDeepLinkOpen<T extends { id: number }>(opts: {
  search: string;
  param: string;
  items: T[];
  loadList: () => Promise<T[]>;
  onFound: (item: T) => void;
  onMiss?: () => void;
  /** Optional: sync loaded list into page state when we had to fetch. */
  onList?: (list: T[]) => void;
}): void {
  const { search, param, items, loadList, onFound, onMiss, onList } = opts;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const id = queryId(search, param);
    if (id == null) return;
    let cancelled = false;
    (async () => {
      let list = itemsRef.current;
      if (!list.length) {
        list = await loadList();
        if (cancelled) return;
        onList?.(list);
      }
      if (cancelled) return;
      const found = list.find((row) => row.id === id);
      if (cancelled) return;
      if (found) onFound(found);
      else onMiss?.();
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only re-run when the query string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
}
