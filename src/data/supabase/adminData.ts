/**
 * The Admin Panel's data on the live site (slice 7: reads only), read with the
 * admin's own session once it passed the second factor (aal2). Row level security
 * answers a session that is not (or no longer) an admin with empty lists, not an
 * error: so after the reads the same session asks is_admin(), and false is shown
 * as an error, never as "no orders", while the sign-in is checked again (an aal1
 * session goes back to the code). Customer details stay in this memory only:
 * never logged, never kept in the browser's storage, dropped at sign-out.
 */
import type { AdminRole } from '@/core/orderFlow';
import { seedContent, seedSettings } from '../seed/config';
import { STATE_VERSION, type DbState } from '../state';
import type { AdminAuth, AdminData, DataStatus } from '../types';
import { loadCatalog } from './catalog';
import { must, rows, type Client } from './client';
import { contentFromRow, notificationFromRow, orderFromRow, quoteFromRow, settingsFromRows, stockMovementFromRow } from './rows';

/** Newest first. Supabase answers at most 1000 rows per read (its default "max rows"). */
const MAX_ROWS = 1000;
/** The pages list the newest 40 movements and 60 messages. */
const RECENT_ROWS = 200;

const empty = (): DbState => ({
  version: STATE_VERSION,
  origins: [],
  products: [],
  shippingRates: [],
  paymentMethods: [],
  settings: seedSettings,
  content: seedContent,
  orders: [],
  quotes: [],
  stockMovements: [],
  notifications: [],
});

/** Everything this role may read. Throws the first failed read. */
async function readAll(db: Client, role: AdminRole): Promise<DbState> {
  const [catalog, orders, quotes, movements, outbox, adminConfig] = await Promise.all([
    // an admin's session sees the inactive products and origins too
    loadCatalog(db),
    db.from('orders').select('*, order_events(at, label)').order('created_at', { ascending: false }).limit(MAX_ROWS),
    db.from('quote_requests').select('*').order('created_at', { ascending: false }).limit(MAX_ROWS),
    db.from('stock_movements').select('*').order('at', { ascending: false }).order('id', { ascending: false }).limit(RECENT_ROWS),
    // owner and manager only (row level security); staff has no Notifications page
    role === 'staff' ? null : db.from('notification_outbox').select('*').order('created_at', { ascending: false }).limit(RECENT_ROWS),
    // who receives the messages: owner only
    role === 'owner' ? db.from('admin_config').select('*').eq('id', 1).maybeSingle() : null,
  ]);
  return {
    ...empty(),
    origins: catalog.origins,
    products: catalog.products,
    shippingRates: catalog.shippingRates,
    paymentMethods: catalog.paymentMethods,
    settings: settingsFromRows(catalog.siteSettings, adminConfig ? must(adminConfig) : null, seedSettings),
    content: contentFromRow(catalog.content, seedContent),
    orders: rows(orders).map(({ order_events, ...order }) => orderFromRow(order, order_events)),
    quotes: rows(quotes).map(quoteFromRow),
    stockMovements: rows(movements).map(stockMovementFromRow),
    notifications: outbox ? rows(outbox).map(notificationFromRow) : [],
  };
}

/** A failed read, for the console: its code and message only (never the rows it was about). */
function describe(e: unknown): string {
  if (e && typeof e === 'object') {
    const { code, message } = e as { code?: unknown; message?: unknown };
    return [code, message].filter((x) => typeof x === 'string' && x).join(' ') || 'failed';
  }
  return 'failed';
}

/** `client` is the admin's own (./index.ts); `auth` says when a session is signed in, and checks it again. */
export function createAdminData(client: () => Client, auth: AdminAuth): AdminData {
  let state = empty();
  let status: DataStatus = 'loading';
  /** The read in progress: an older one's answer (before a sign-out, a reload) is dropped. */
  let run = 0;
  let watching = false;
  let signedIn = false;
  /** The sign-in was checked again after is_admin() said no: once, so a disagreement cannot loop. */
  let rechecked = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  async function load() {
    const session = auth.session.get();
    if (session.state !== 'signed_in') return;
    const mine = ++run;
    status = 'loading';
    emit();
    try {
      const db = client();
      const next = await readAll(db, session.role);
      // asked after the reads: a session that lost aal2 meanwhile cannot pass for an admin
      const admin = must(await db.rpc('is_admin'));
      if (mine !== run) return;
      if (admin !== true) {
        state = empty();
        status = 'error';
        emit();
        if (!rechecked) {
          rechecked = true;
          auth.retry();
        }
        return;
      }
      rechecked = false;
      state = next;
      status = 'ready';
    } catch (e) {
      if (mine !== run) return;
      console.error('admin data:', describe(e));
      status = 'error';
    }
    emit();
  }

  /** Signed out (or back to the code): nothing of the last session stays in memory. */
  function clear() {
    run++;
    state = empty();
    status = 'loading';
    emit();
  }

  /** Reads on reaching the panel, clears on leaving it; started by the panel's first look at the data. */
  function watch() {
    if (watching) return;
    watching = true;
    signedIn = auth.session.get().state === 'signed_in';
    auth.session.subscribe(() => {
      const now = auth.session.get().state === 'signed_in';
      if (now && !signedIn) void load();
      if (!now && signedIn) clear();
      signedIn = now;
    });
    if (signedIn) void load();
  }

  const subscribe = (l: () => void) => {
    watch();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };

  return {
    db: { get: () => state, subscribe },
    status: { get: () => status, subscribe },
    reload: () => void load(),
  };
}
