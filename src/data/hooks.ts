import { useMemo, useSyncExternalStore } from 'react';
import { indexOrigins } from '@/core/recipe';
import { backend } from './backend';

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
