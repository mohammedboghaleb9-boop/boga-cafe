import { useEffect } from 'react';

export const SITE_NAME = 'BOGA CAFÉ';

/**
 * "Page — BOGA CAFÉ" while a page is shown (WCAG 2.4.2 Page Titled): the tab, the
 * history and screen readers tell pages apart. No title: the site name alone.
 */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  }, [title]);
}
