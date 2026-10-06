/**
 * Browser database: the whole state lives in memory and is saved in this
 * browser (localStorage), so each visitor only ever sees their own copy.
 * Used by the demo and, until the Supabase backend exists (P5), by the real
 * site with the catalog only. Pages never import it: they go through
 * src/data/api.ts and src/data/hooks.ts (tests/architecture.test.ts).
 */
import {
  draftsToLogs,
  orderMessage,
  quoteMessage,
} from '@/services/notifications';
import { templateContext } from '../context';
import { uid } from '../ids';
import { DEMO_DATA } from '../mode';
import { buildDemoActivity, DEMO_PAYEE } from '../seed/activity';
import { seedOrigins, seedProducts } from '../seed/catalog';
import { seedContent, seedPaymentMethods, seedSettings, seedShippingRates } from '../seed/config';
import { STATE_VERSION, type DbState } from '../state';

const STORAGE_KEY = 'boga-cafe-demo-db';

/** The catalog and rules; with the demo, example activity and payment details marked DÉMO. */
export function initialState(demo: boolean = DEMO_DATA): DbState {
  const base: DbState = {
    version: STATE_VERSION,
    origins: seedOrigins,
    products: seedProducts,
    shippingRates: seedShippingRates,
    paymentMethods: seedPaymentMethods,
    settings: seedSettings,
    content: seedContent,
    orders: [],
    quotes: [],
    stockMovements: [],
    notifications: [],
  };
  // written out (not only DEMO_DATA) so the real build drops the example data entirely
  if (import.meta.env.VITE_DATA_MODE !== 'demo' || !demo) return base;
  const s = buildDemoActivity({ ...base, settings: { ...base.settings, ...DEMO_PAYEE } });
  const ctx = templateContext(s);
  const notifications = [
    ...s.orders.flatMap((o) => draftsToLogs('order.created', orderMessage(o, ctx), s.settings, o.createdAt, uid)),
    ...s.quotes.flatMap((q) => draftsToLogs('quote.created', quoteMessage(q, ctx), s.settings, q.createdAt, uid)),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { ...s, notifications };
}

function load(): DbState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DbState;
    return parsed.version === STATE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function save(s: DbState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode): the demo still works in memory */
  }
}

// read on first use: a build that never uses this store (VITE_DATA_MODE=supabase) drops it, example catalog included
let state: DbState | null = null;
const current = (): DbState => {
  watchOtherTabs();
  return (state ??= load() ?? initialState());
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Keep several open tabs (shop + admin) in sync, from the first read of the store.
let watching = false;
function watchOtherTabs() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = load();
    if (next) {
      state = next;
      emit();
    }
  });
}

export const db = {
  get: current,
  update(recipe: (s: DbState) => DbState) {
    state = recipe(current());
    save(state);
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  reset() {
    state = initialState();
    save(state);
    emit();
  },
};
