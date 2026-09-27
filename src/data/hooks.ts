import { useMemo, useSyncExternalStore } from 'react';
import { indexOrigins } from '@/core/recipe';
import { db } from './store';

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
