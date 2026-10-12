import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * A form's draft that starts again from what is saved whenever the saved copy's version
 * changes: once a save is read back, or another admin's change is read (a refused save reads
 * again), so the next click never writes over the newer copy. `version`: the saved copy's
 * mark (its updated_at, or its JSON where there is none); null for a new item, never reset.
 */
export function useSavedDraft<T>(saved: T, version: string | null): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState(saved);
  const [seen, setSeen] = useState(version);
  if (version !== null && seen !== version) {
    setSeen(version);
    setDraft(saved);
  }
  return [draft, setDraft];
}
