import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { indexOrigins } from '@/core/recipe';
import { backend } from './backend';
import { SERVER_DATA } from './mode';
import type { AdminWriteArea } from './types';
import type { DbState } from './state';

const { db, status, adminData } = backend;

/** Whole state; re-renders when anything changes. */
export const useDb = () => useSyncExternalStore(db.subscribe, db.get, db.get);

function useCatalogOf(s: DbState) {
  return useMemo(
    () => ({
      products: [...s.products].sort((a, b) => a.sortOrder - b.sortOrder),
      origins: s.origins,
      originIndex: indexOrigins(s.origins),
    }),
    [s.products, s.origins],
  );
}

export const useCatalog = () => useCatalogOf(useDb());

export const useSettings = () => useDb().settings;

/**
 * The Admin Panel's state: on the live site, what the admin's session reads
 * (every order, inactive products…), apart from the shop's copy; in the
 * prototype, the same browser store.
 */
export const useAdminDb = () => useSyncExternalStore(adminData.db.subscribe, adminData.db.get, adminData.db.get);
export const useAdminCatalog = () => useCatalogOf(useAdminDb());

/** Whether the admin data has arrived, and a way to read it again. */
export function useAdminDataStatus() {
  return { status: useSyncExternalStore(adminData.status.subscribe, adminData.status.get, adminData.status.get), reload: adminData.reload };
}

/** Whether the panel can save this part yet (live site: slices 8-10). */
export const canWrite = (area: AdminWriteArea) => backend.adminWrites.includes(area);

/** The admin's sign-in state (starts the live session check on first use). */
export const useAdminSession = () => useSyncExternalStore(backend.admin.session.subscribe, backend.admin.session.get, backend.admin.session.get);

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
