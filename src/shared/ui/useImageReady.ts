import { useCallback, useEffect, useRef, useState } from 'react';
import { loadWhenNear } from './nearLoad';

type ImageState = 'loading' | 'ready' | 'failed';

/** A failed fetch is tried again twice (after 1.5 s, then 4 s) before the picture counts as failed. */
const RETRY_MS = [1500, 4000];
/** `decode()` can be slow to settle on some browsers: waiting longer than this only delays a paint, never blocks it. */
const DECODE_MAX_MS = 1500;

/**
 * Tells when an image is loaded and decoded, so what sits on top of it (a sticker) can appear with it and
 * never alone. Also starts it when it is near the screen. Put `key={attempt}` on the `<img>`: a retry is a new element.
 */
export function useImageReady() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ImageState>('loading');
  const timer = useRef<number | undefined>(undefined);
  // the retry timer outlives the ref's clean-up (it must fire after the failed <img> is gone): cleared here, on unmount
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return undefined;
      let gone = false;
      const stopNear = loadWhenNear(img);
      const ready = () => !gone && setState('ready');
      // decoded before it is shown: Safari paints a big image late when it decodes it on first paint
      const onLoad = () => {
        const decoded = img.decode ? img.decode().catch(() => undefined) : Promise.resolve();
        void Promise.race([decoded, new Promise((r) => window.setTimeout(r, DECODE_MAX_MS))]).then(ready);
      };
      const onError = () => {
        if (gone) return;
        if (attempt < RETRY_MS.length) {
          timer.current = window.setTimeout(() => {
            setState('loading');
            setAttempt(attempt + 1);
          }, RETRY_MS[attempt]);
        } else setState('failed');
      };
      // an image the browser already holds is shown at once
      if (img.complete && img.naturalWidth > 0) ready();
      // an eager image that failed before this ran has no event left to tell us (a lazy one has not started yet)
      else if (img.complete && img.loading !== 'lazy' && img.currentSrc) onError();
      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
      return () => {
        gone = true;
        stopNear?.();
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };
    },
    [attempt],
  );

  return { ref, attempt, state };
}
