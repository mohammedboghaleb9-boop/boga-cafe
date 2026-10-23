/**
 * Images stay `loading="lazy"`, but one that is about to arrive gets fetched before the visitor does:
 * browsers differ on how close a lazy image must be before they start it (Safari on a phone is late),
 * so this one rule starts the fetch when the image is within 1.2 screens of the viewport.
 * Setting `loading` to "eager" starts a lazy image at once, as the HTML spec says.
 * Far-away images are left alone: nothing is preloaded that the visitor may never reach.
 */
const MARGIN = '120% 0px';

let observer: IntersectionObserver | undefined;

/** A ref callback for an `<img loading="lazy">`; returns its clean-up. */
export function loadWhenNear(img: HTMLImageElement | null): (() => void) | undefined {
  if (!img || img.loading !== 'lazy' || typeof IntersectionObserver === 'undefined') return undefined;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLImageElement).loading = 'eager';
        observer?.unobserve(e.target);
      }
    },
    { rootMargin: MARGIN },
  );
  observer.observe(img);
  return () => observer?.unobserve(img);
}
