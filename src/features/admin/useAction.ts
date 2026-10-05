import { useState } from 'react';

/**
 * Runs one action at a time: a call made while the previous one is still
 * running is ignored, so a double click never sends the same change twice.
 * `onBusy` hears when an action starts and ends.
 */
export function exclusive(onBusy: (busy: boolean) => void) {
  let running = false;
  return async (action: () => Promise<void>) => {
    if (running) return;
    running = true;
    onBusy(true);
    try {
      await action();
    } finally {
      running = false;
      onBusy(false);
    }
  };
}

/** `busy` disables the buttons while an admin call is saving; `run` wraps their handlers. */
export function useAction(): [busy: boolean, run: (action: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  // one runner for the component's life, so the guard holds across renders
  const [run] = useState(() => exclusive(setBusy));
  return [busy, run];
}
