import { Link } from 'react-router';
import { useI18n } from '@/i18n';

/**
 * The cart and the checkout while the sales are closed (src/core/showcase.ts): no line, total or form, whatever the
 * browser kept from earlier; the catalog and the contact instead. The notice itself is said once, in the header.
 */
export function OrdersClosed({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <div className="container page stack" style={{ alignItems: 'flex-start' }}>
      <h1>{title}</h1>
      <p className="lead">{t.common.browseOnly}</p>
      <div className="row">
        <Link to="/shop" className="btn btn-primary">
          {t.cart.emptyCta}
        </Link>
        <Link to="/contact" className="btn btn-ghost">
          {t.nav.contact}
        </Link>
      </div>
    </div>
  );
}
