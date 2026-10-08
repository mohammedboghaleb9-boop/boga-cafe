import { useState } from 'react';

/**
 * Runs one action at a time: a call made while the previous one is still
 * running is ignored, so a double click never sends the same change twice.
 * `onBusy` hears when an action starts and ends. With `onFailed`, a failed
 * action is reported there (true; false again when the next one starts)
 * instead of thrown: the page shows "not saved", never the "saved" flash.
 */
export function exclusive(onBusy: (busy: boolean) => void, onFailed?: (failed: boolean) => void) {
  let running = false;
  return async (action: () => Promise<void>) => {
    if (running) return;
    running = true;
    onBusy(true);
    onFailed?.(false);
    try {
      await action();
    } catch (e) {
      if (!onFailed) throw e;
      // the error's message only: the code of a refusal, never a customer's details
      console.error('admin action:', e instanceof Error ? e.message : 'failed');
      onFailed(true);
    } finally {
      running = false;
      onBusy(false);
    }
  };
}

/**
 * `busy` disables the buttons while an admin call is saving; `run` wraps their
 * handlers; `failed`: the last call was refused or got no answer (show WriteError).
 */
export function useAction(): [busy: boolean, run: (action: () => Promise<void>) => Promise<void>, failed: boolean] {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // one runner for the component's life, so the guard holds across renders
  const [run] = useState(() => exclusive(setBusy, setFailed));
  return [busy, run, failed];
}

/** A write the backend answered "no" to (a refusal, or false): makes `run` report it as failed. */
export function refuse(reason: string): never {
  throw new Error(`refused: ${reason}`);
}
