import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { indexOrigins } from '@/core/recipe';
import { backend } from './backend';
import { SERVER_DATA } from './mode';

const { db, status } = backend;

/** Whole state; re-renders when anything changes. */
export const useDb = () => useSyncExternalStore(db.subscribe, db.get, db.get);

export function useCatalog() {
  const s = useDb();
  return useMemo(
    () => ({
      products: [...s.products].sort((a, b) => a.sortOrder - b.sortOrder),
      origins: s.origins,
      originIndex: indexOrigins(s.origins),
    }),
    [s.products, s.origins],
  );
}

export const useSettings = () => useDb().settings;

/** Whether the data has arrived (always 'ready' for the browser store), and a way to ask again after an error. */
export function useDataStatus() {
  return { status: useSyncExternalStore(status.subscribe, status.get, status.get), retry: backend.retry };
}

/**
 * One order, by its link. The browser store has it already; the live site
 * reads it from this tab's copy or from the server (src/data/supabase/api.ts loadOrder).
 */
export function useOrder(id: string | undefined) {
  const order = useDb().orders.find((o) => o.id === id);
  const [checked, setChecked] = useState<{ id?: string; failed: boolean }>({ failed: false });
  useEffect(() => {
    if (!id) return;
    let live = true;
    backend.api.loadOrder(id).then(
      () => live && setChecked({ id, failed: false }),
      () => live && setChecked({ id, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  const done = checked.id === id;
  // the browser store already holds every order: an unknown link is "not found" at once, as before
  return { order, loading: SERVER_DATA && !order && Boolean(id) && !done, failed: !order && done && checked.failed };
}
