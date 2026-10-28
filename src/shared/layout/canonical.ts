import { useEffect } from 'react';

/** The public address of the site: the one place the full origin is written (og:image in index.html uses the same). */
export const SITE_ORIGIN = 'https://bogacafe.ma';

const PAGES = new Set(['/', '/shop', '/single-origin', '/custom-blend', '/b2b', '/contact']);

/**
 * The canonical address of a page a search engine may list, or null (cart, checkout, order, admin, unknown paths).
 * Product pages are not here: only the page knows whether the product exists (productCanonical). Every route is the same index.html, so the address is set per page here, never once in the HTML.
 * Query, hash and a trailing slash are not part of it.
 */
export function canonicalFor(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (!PAGES.has(path)) return null;
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
}

/** A product page's address; the page itself asks for it only once the product is shown. */
export function productCanonical(slug: string): string {
  return `${SITE_ORIGIN}/product/${encodeURIComponent(slug)}`;
}

/**
 * Keeps one `<link rel="canonical">` in the head that matches the page shown. `null`: none (pages not to be listed);
 * `undefined`: the page sets it itself, nothing changes here.
 */
export function useCanonical(href: string | null | undefined) {
  useEffect(() => {
    if (href === undefined) return;
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!href) {
      link?.remove();
      return;
    }
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.append(link);
    }
    link.href = href;
  }, [href]);
}
