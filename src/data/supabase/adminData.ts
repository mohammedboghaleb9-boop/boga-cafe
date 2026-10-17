/**
 * The Admin Panel's data on the live site (slice 7: reads only), read with the
 * admin's own session once it passed the second factor (aal2). Row level security
 * answers a session that is not (or no longer) an admin with empty lists, not an
 * error: so after the reads the same session asks is_admin() for the role the panel
 * shows (an owner made manager would read no recipients), and false is shown as an
 * error, never as "no orders", while the sign-in is checked again (an aal1 session
 * goes back to the code, a changed role is read again). Customer details stay in this memory only:
 * never logged, never kept in the browser's storage, dropped at sign-out.
 */
import type { AdminRole } from '@/core/orderFlow';
import { seedContent, seedSettings } from '../seed/config';
import { STATE_VERSION, type ConfigPart, type DbState } from '../state';
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

const CONFIG_PARTS: readonly ConfigPart[] = ['rules', 'freeShipping', 'payee', 'content', 'contact', 'recipients', 'sales'];

/** Each settings part's version mark (site_config.versions), as the save functions compare it. */
function versionsFrom(j: unknown): DbState['configVersions'] {
  const marks = (j ?? {}) as Record<string, unknown>;
  return Object.fromEntries(CONFIG_PARTS.filter((p) => typeof marks[p] === 'string').map((p) => [p, marks[p] as string]));
}

/**
 * When the payee details last changed and by whom (owner only). A line under the form, not
 * the page's data: a failed read says "unknown" instead of the error screen.
 */
async function readPayeeChange(db: Client): Promise<DbState['payeeChange']> {
  const [change, admins] = await Promise.all([
    db.from('config_changes').select('at, actor').eq('area', 'payee').order('at', { ascending: false }).limit(1).maybeSingle(),
    db.from('admin_users').select('user_id, full_name'),
  ]);
  if (change.error || admins.error) return 'unknown';
  if (!change.data) return undefined;
  const { at, actor } = change.data;
  return { at, by: admins.data.find((a) => a.user_id === actor)?.full_name || '—' };
}

/** Everything this role may read. Throws the first failed read. */
async function readAll(db: Client, role: AdminRole): Promise<DbState> {
  const [catalog, orders, quotes, movements, outbox, adminConfig, site, payeeChange] = await Promise.all([
    // an admin's session sees the inactive products and origins too
    loadCatalog(db),
    db.from('orders').select('*, order_events(at, label)').order('created_at', { ascending: false }).limit(MAX_ROWS),
    db.from('quote_requests').select('*').order('created_at', { ascending: false }).limit(MAX_ROWS),
    db.from('stock_movements').select('*').order('at', { ascending: false }).order('id', { ascending: false }).limit(RECENT_ROWS),
    // owner and manager only (row level security); staff has no Notifications page
    role === 'staff' ? null : db.from('notification_outbox').select('*').order('created_at', { ascending: false }).limit(RECENT_ROWS),
    // who receives the messages: owner only
    role === 'owner' ? db.from('admin_config').select('*').eq('id', 1).maybeSingle() : null,
    // the settings, the texts and their version marks from one read of one row (slice 10): a
    // mark read apart from its values could pass the stale check over another admin's save
    db.from('site_config').select('*').eq('id', 1).maybeSingle(),
    role === 'owner' ? readPayeeChange(db) : undefined,
  ]);
  const recipients = adminConfig ? must(adminConfig) : null;
  const siteRow = must(site);
  return {
    ...empty(),
    origins: catalog.origins,
    products: catalog.products,
    shippingRates: catalog.shippingRates,
    paymentMethods: catalog.paymentMethods,
    settings: settingsFromRows(siteRow?.settings, recipients, seedSettings),
    content: contentFromRow(siteRow?.content, seedContent),
    orders: rows(orders).map(({ order_events, ...order }) => orderFromRow(order, order_events)),
    quotes: rows(quotes).map(quoteFromRow),
    stockMovements: rows(movements).map(stockMovementFromRow),
    notifications: outbox ? rows(outbox).map(notificationFromRow) : [],
    configVersions: { ...versionsFrom(siteRow?.versions), ...(recipients?.updated_at && { recipients: recipients.updated_at }) },
    payeeChange,
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

  /** `quiet`: after a write, the page stays on screen while it reads again (a failure still shows the error). */
  async function load(quiet = false) {
    const session = auth.session.get();
    if (session.state !== 'signed_in') return;
    const mine = ++run;
    if (!quiet) {
      status = 'loading';
      emit();
    }
    try {
      const db = client();
      const next = await readAll(db, session.role);
      // asked after the reads: a session that lost aal2, or this role, meanwhile cannot pass for it
      const admin = must(await db.rpc('is_admin', { allowed: [session.role] }));
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
      const at = auth.session.get().state;
      const now = at === 'signed_in';
      // a new sign-in (not the check again, which passes through 'loading') may check again once more
      if (at === 'signed_out' || at === 'denied' || at === 'second_factor') rechecked = false;
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
    refresh: () => load(true),
  };
}
