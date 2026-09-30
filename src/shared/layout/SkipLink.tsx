import { useI18n } from '@/i18n';

/**
 * First stop of the keyboard on every page: jumps over the header to the page's own
 * content (WCAG 2.4.1). It moves the focus itself: a "#main" address would be read
 * as a route by the demo's hash router.
 */
export function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById('main');
        main?.focus();
        main?.scrollIntoView({ block: 'start' });
      }}
    >
      {t.a11y.skipToContent}
    </a>
  );
}
