/**
 * How the Admin Panel's writes reach the database on the live site (./adminWrites.ts,
 * ./configWrites.ts): each through its database function, with the admin's session, then
 * the panel reads its data again. A refusal or no answer is never taken for a success.
 */
import type { AdminData } from '../types';
import type { Client } from './client';
import type { Database } from './database.types';

type Fns = Database['public']['Functions'];

/** What the database refused (its exception text), or 'failed' (no answer, or an error with no such text): the panel says "not saved". */
export class WriteFailed extends Error {
  constructor(readonly code: string) {
    super(`admin write failed: ${code}`);
  }
}

export type Call = <F extends keyof Fns>(fn: F, args: Fns[F]['Args']) => Promise<void>;

/** `client`: the admin's own (src/data/supabase/index.ts); `data`: what the panel shows, read again after each write. */
export function createCall(client: () => Client, data: AdminData): Call {
  /** Calls the function; throws WriteFailed. Logs the function and the refusal only (no customer detail). */
  return async (fn, args) => {
    const { error } = await client().rpc(fn, args as never);
    if (error) {
      const code = error.message && /^[a-z_]+$/.test(error.message) ? error.message : 'failed';
      console.error(`admin write ${fn}:`, code, error.code ?? '');
      // refused (the page was out of date) or no answer (it may have been saved all the same):
      // the panel reads again, so a second try starts from what is really saved
      await data.refresh();
      throw new WriteFailed(code);
    }
    await data.refresh();
  };
}

/**
 * No answer to a creation, but the read that followed shows the new row: it was saved. Said so,
 * since a second click would pick the next free id and create a copy.
 */
export async function creating(write: () => Promise<void>, isThere: () => boolean): Promise<void> {
  try {
    await write();
  } catch (e) {
    if (!(e instanceof WriteFailed && e.code === 'failed' && isThere())) throw e;
  }
}

/** A refusal (the database's reason) is answered `refused`; no answer is thrown: it may have been saved. */
export async function unlessRefused<T>(write: () => Promise<T>, refused: T): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof WriteFailed && e.code !== 'failed') return refused;
    throw e;
  }
}
