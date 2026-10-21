/**
 * The site's copy of the live catalog (VITE_DATA_MODE=supabase): one read of
 * what a visitor may see (row level security shows active rows only), kept in
 * the same DbState the pages already read. Until it answers the catalog is
 * empty, never the seed's examples; the layout shows "loading" or the error.
 * While the sales are closed it adds the catalog listed for display, without prices (./showcase.ts).
 * Orders: only the ones this visitor placed or opened by their link.
 */
import type { Order } from '@/core/types';
import { EMPTY_CONTENT, LIVE_DEFAULT_SETTINGS } from '../defaults';
import { STATE_VERSION, type DbState } from '../state';
import type { DataStatus, ReadStore } from '../types';
import { loadCatalog } from './catalog';
import type { Client } from './client';
import { contentFromRow, settingsFromRows } from './rows';
import { loadShowcase, SHOWCASE_READ, withShowcase } from './showcase';

// settings and texts: stored values over the live defaults (../defaults.ts: the database's own, no example), like the server does
const empty = (): DbState => ({
  version: STATE_VERSION,
  origins: [],
  products: [],
  shippingRates: [],
  paymentMethods: [],
  settings: LIVE_DEFAULT_SETTINGS,
  content: EMPTY_CONTENT,
  orders: [],
  quotes: [],
  stockMovements: [],
  notifications: [],
});

export interface CatalogStore {
  db: ReadStore<DbState>;
  status: ReadStore<DataStatus>;
  /** Reads the catalog; a call while one is running waits for that one. */
  load(): Promise<void>;
  /**
   * Reads it again without the "loading" screen (the page and its form stay):
   * after the server refused a product the site still showed as available.
   * A failed read keeps the copy it has.
   */
  refresh(): Promise<void>;
  /** Adds or replaces one order the visitor placed or opened (the catalog read never touches orders). */
  putOrder(order: Order): void;
}

/** `showcase`: read the catalog listed for display while the sales are closed (VITE_SHOWCASE, ./showcase.ts). */
export function createCatalogStore(client: Client, { showcase = SHOWCASE_READ }: { showcase?: boolean } = {}): CatalogStore {
  let state = empty();
  let status: DataStatus = 'loading';
  let running: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  async function read(quiet = false) {
    if (!quiet) {
      status = 'loading';
      emit();
    }
    try {
      const c = await loadCatalog(client);
      const settings = settingsFromRows(c.siteSettings, null, LIVE_DEFAULT_SETTINGS);
      // the display read failing leaves the site as it is without it (empty lists), never in the error screen
      const shown =
        showcase && !settings.salesOpen
          ? await loadShowcase(client).catch((e: unknown) => {
              console.error('showcase:', e);
              return null;
            })
          : null;
      const catalog = withShowcase({ products: c.products, origins: c.origins }, shown);
      state = {
        ...state,
        origins: catalog.origins,
        products: catalog.products,
        shippingRates: c.shippingRates,
        paymentMethods: c.paymentMethods,
        settings,
        content: contentFromRow(c.content, EMPTY_CONTENT),
      };
      status = 'ready';
    } catch (e) {
      console.error('catalog:', e);
      if (!quiet) status = 'error';
    }
    emit();
  }

  return {
    db: { get: () => state, subscribe },
    status: { get: () => status, subscribe },
    load: () => (running ??= read().finally(() => (running = null))),
    refresh: () => (running ??= read(true).finally(() => (running = null))),
    putOrder(order) {
      state = { ...state, orders: [order, ...state.orders.filter((o) => o.id !== order.id)] };
      emit();
    },
  };
}
