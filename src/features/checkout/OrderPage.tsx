import { Link, useParams } from 'react-router';
import { formatKg } from '@/core/format';
import type { OrderStatus } from '@/core/types';
import { templateContext } from '@/data/context';
import { useDb } from '@/data/hooks';
import { LineDetails } from '@/shared/cart/CartLineView';
import { fmt, useI18n } from '@/i18n';
import { orderMessage } from '@/services/notifications';
import { SendToBoga } from '@/shared/layout/SendToBoga';
import { CopyButton } from '@/shared/ui/bits';
import { PaymentPanel } from './PaymentPanel';
import './checkout.css';

const FLOW: OrderStatus[] = ['new', 'confirmed', 'in_production', 'shipped', 'delivered'];

export function OrderPage() {
  const { id } = useParams();
  const { t, l, money, date } = useI18n();
  const db = useDb();
  const { orders, shippingRates } = db;
  const order = orders.find((o) => o.id === id);

  if (!order) {
    return (
      <div className="container page stack" style={{ alignItems: 'flex-start' }}>
        <p className="lead">{t.order.notFound}</p>
        <Link to="/" className="btn btn-primary">
          {t.common.backHome}
        </Link>
      </div>
    );
  }

  const city = shippingRates.find((r) => r.id === order.customer.cityId);
  const reached = FLOW.indexOf(order.status);
  const firstName = order.customer.fullName.split(' ')[0];

  return (
    <div className="container page order-page">
      <div className="page-head">
        <span className="eyebrow">{date(order.createdAt, true)}</span>
        <h1>{fmt(t.order.thanks, { name: firstName })}</h1>
        <p className="lead row">
          {fmt(t.order.received, { ref: order.number })} <CopyButton text={order.number} />
        </p>
      </div>

      <div className="order-grid">
        <div className="stack" style={{ ['--gap' as string]: '20px' }}>
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <SendToBoga draft={orderMessage(order, templateContext(db))} refNumber={order.number} showSaved={false} />
          )}
          <PaymentPanel order={order} />

          <section className="panel stack">
            <h2 className="checkout-h2">{t.order.statusTitle}</h2>
            {order.status === 'cancelled' ? (
              <span className="pill pill-bad">{t.orderStatus.cancelled}</span>
            ) : (
              <ol className="timeline">
                {FLOW.map((s, i) => (
                  <li key={s} data-done={i <= reached} data-current={i === reached}>
                    <span className="timeline-dot" />
                    <span>{t.orderStatus[s]}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="small muted">
              {order.status === 'cancelled'
                ? t.order.cancelledText
                : order.status === 'delivered'
                  ? t.order.deliveredText
                  : order.paymentStatus === 'paid'
                    ? t.order.nextPaid
                    : t.order.nextPending}
            </p>
          </section>

        </div>

        <aside className="panel stack">
          <h2 className="checkout-h2">{t.order.itemsTitle}</h2>
          <ul className="co-lines">
            {order.lines.map((line, i) => (
              <li key={i}>
                <LineDetails line={line} />
                <span className="num small">×{line.qty}</span>
                <strong className="num">{money(line.lineTotal)}</strong>
              </li>
            ))}
          </ul>
          <div className="co-totals">
            <div className="spread">
              <span>{t.common.weight}</span>
              <span className="num">{formatKg(order.weightKg)}</span>
            </div>
            <div className="spread">
              <span>{t.common.subtotal}</span>
              <span className="num">{money(order.subtotal)}</span>
            </div>
            <div className="spread">
              <span>
                {t.common.delivery} {city && `· ${l(city.city)}`}
              </span>
              <span className="num">{order.shippingFee === 0 ? t.common.free : money(order.shippingFee)}</span>
            </div>
            <div className="spread co-total">
              <span>{t.common.total}</span>
              <strong className="num">{money(order.total)}</strong>
            </div>
          </div>
          <div className="small muted">
            {order.customer.fullName} · <span dir="ltr">{order.customer.phone}</span>
            <br />
            {order.customer.address}
          </div>
        </aside>
      </div>
    </div>
  );
}
