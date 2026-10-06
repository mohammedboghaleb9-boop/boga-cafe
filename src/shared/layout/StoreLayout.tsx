import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useCart } from '@/shared/cart/CartProvider';
import { useDataStatus, useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '../ui/Icon';
import { Footer } from './Footer';
import { Header } from './Header';
import { SkipLink } from './SkipLink';
import { sectionId } from './sectionId';
import './layout.css';
import { api } from '@/data/api';

export function StoreLayout() {
  const { pathname, hash } = useLocation();
  const { toast, dismissToast } = useCart();
  const { settings } = useDb();
  const { status, retry } = useDataStatus();
  const { t } = useI18n();

  // new page: back to the top, or to the section named in the link (/page#section)
  useEffect(() => {
    const target = hash ? document.getElementById(sectionId(hash)) : null;
    if (!target) {
      window.scrollTo({ top: 0 });
      return;
    }
    const land = () => target.scrollIntoView({ block: 'start' });
    land();
    if (typeof ResizeObserver === 'undefined') return;
    // web fonts and images arriving just after change the height of what is above:
    // keep the section in place while the page settles, until the visitor moves
    const settle = new ResizeObserver(land);
    settle.observe(document.body);
    const stop = () => settle.disconnect();
    const timer = window.setTimeout(stop, 1500);
    const moves = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    moves.forEach((e) => window.addEventListener(e, stop, { passive: true, once: true }));
    return () => {
      stop();
      window.clearTimeout(timer);
      moves.forEach((e) => window.removeEventListener(e, stop));
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- runs again on each new page, on purpose
  }, [pathname, hash]);

  // unpaid orders past the time limit give their stock back
  useEffect(() => {
    void api.expireUnpaidOrders();
  }, []);

  // the live catalog has not arrived (or failed): no page, and never example products instead
  if (status !== 'ready') return <DataPending failed={status === 'error'} retry={retry} />;

  return (
    <div className="store">
      <SkipLink />
      <Header />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
      <a
        className="wa-fab"
        href={whatsappLink(settings.contact.whatsapp, t.contact.whatsappText)}
        target="_blank"
        rel="noreferrer"
        aria-label="WhatsApp"
      >
        <Icon name="whatsapp" size={26} />
      </a>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Icon name="check" size={16} /> {toast}
          </span>
          <Link to="/cart" onClick={dismissToast}>
            {t.common.viewCart}
          </Link>
        </div>
      )}
    </div>
  );
}

function DataPending({ failed, retry }: { failed: boolean; retry: () => void }) {
  const { t } = useI18n();
  return (
    <main id="main" className="container page stack" aria-busy={!failed}>
      <p className="lead" role={failed ? 'alert' : 'status'}>
        {failed ? t.common.loadFailed : t.common.loading}
      </p>
      {failed && (
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={retry}>
          {t.common.retry}
        </button>
      )}
    </main>
  );
}
