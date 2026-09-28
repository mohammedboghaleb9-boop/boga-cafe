import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useCart } from '@/features/cart/CartProvider';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '../ui/Icon';
import { Footer } from './Footer';
import { Header } from './Header';
import './layout.css';
import { api } from '@/data/api';

export function StoreLayout() {
  const { pathname, hash } = useLocation();
  const { toast, dismissToast } = useCart();
  const { settings } = useDb();
  const { t } = useI18n();

  // new page: back to the top, or to the section named in the link (/b2b#sample)
  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [pathname, hash]);

  // unpaid orders past the time limit give their stock back
  useEffect(() => {
    api.expireUnpaidOrders();
  }, []);

  return (
    <div className="store">
      <Header />
      <main id="main">
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
