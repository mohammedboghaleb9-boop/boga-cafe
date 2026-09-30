/**
 * Browser database: the whole state lives in memory and is saved in this
 * browser (localStorage), so each visitor only ever sees their own copy. It is
 * the only file that knows where data is kept. Phase 2 replaces it with
 * Supabase (docs/03-architecture.md, docs/05-roadmap.md).
 */
import {
  draftsToLogs,
  orderMessage,
  quoteMessage,
  sampleMessage,
} from '@/services/notifications';
import { templateContext } from './context';
import { uid } from './ids';
import { DEMO_DATA } from './mode';
import { buildDemoActivity, DEMO_PAYEE } from './seed/activity';
import { seedOrigins, seedProducts } from './seed/catalog';
import { seedContent, seedPaymentMethods, seedSettings, seedShippingRates } from './seed/config';
import { STATE_VERSION, type DbState } from './state';

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
    samples: [],
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
    ...s.samples.flatMap((x) => draftsToLogs('sample.created', sampleMessage(x, ctx), s.settings, x.createdAt, uid)),
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

let state: DbState = load() ?? initialState();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Keep several open tabs (shop + admin) in sync.
if (typeof window !== 'undefined') {
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
  get: (): DbState => state,
  update(recipe: (s: DbState) => DbState) {
    state = recipe(state);
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
