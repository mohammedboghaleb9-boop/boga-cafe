import { Link, useParams } from 'react-router';
import { formatKg, formatNumber, formatSize } from '@/core/format';
import { reservationDeadline } from '@/core/order';
import { canSetPayment, NEXT_STATUS, refundCancelsOrder, statusChangeRefusal } from '@/core/orderFlow';
import type { OrderStatus, PaymentStatus } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { Flag } from '@/shared/ui/Flag';
import { Icon } from '@/shared/ui/Icon';
import { useAdminRole } from '../session';
import { ConfirmButton, OrderStatusPill, PaymentPill, TableWrap } from '../ui';
import { useAction } from '../useAction';

export function OrderDetail() {
  const { id } = useParams();
  const { t, l, money, date } = useI18n();
  const { orders, origins, shippingRates, paymentMethods, settings } = useDb();
  const role = useAdminRole()!;
  const [busy, run] = useAction();
  const order = orders.find((o) => o.id === id);
  if (!order) return <p className="muted">{t.order.notFound}</p>;

  const origin = (oid: string) => origins.find((o) => o.id === oid);
  const city = shippingRates.find((r) => r.id === order.customer.cityId);
  const method = paymentMethods.find((m) => m.id === order.paymentMethod);
  const next = NEXT_STATUS[order.status];
  const nextRefusal = next ? statusChangeRefusal(order, next, role) : 'closed';
  const cancelRefusal = statusChangeRefusal(order, 'cancelled', role);
  const canCancel = cancelRefusal === null;
  const deadline = reservationDeadline(order, settings);
  const pay = (status: PaymentStatus) => canSetPayment(order, status, role);
  const setStatus = (status: OrderStatus) =>
    run(async () => {
      await api.setOrderStatus(order.id, status, role);
    });
  const setPayment = (status: PaymentStatus) =>
    run(async () => {
      await api.setPaymentStatus(order.id, status, role);
    });
  const c = order.customer;

  return (
    <>
      <div className="admin-head">
        <div className="stack" style={{ ['--gap' as string]: '4px' }}>
          <Link to="/admin/orders" className="small">
            <span className="dir-arrow" aria-hidden="true">←</span> {t.admin.nav.orders}
          </Link>
          <h1 className="num">{order.number}</h1>
          <span className="row small muted">
            {date(order.createdAt, true)} <OrderStatusPill status={order.status} /> <PaymentPill status={order.paymentStatus} />
          </span>
        </div>
        <div className="toolbar">
          {next && nextRefusal !== 'closed' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={nextRefusal !== null}
              aria-disabled={busy || undefined}
              aria-describedby={nextRefusal === 'needs_payment' ? 'next-hint' : undefined}
              onClick={() => setStatus(next)}
            >
              {fmt(t.admin.orders.next, { status: t.orderStatus[next] })}
            </button>
          )}
          {nextRefusal === 'needs_payment' && (
            <span id="next-hint" className="small muted">
              {t.admin.orders.needsPayment}
            </span>
          )}
          {canCancel && (
            <ConfirmButton
              label={t.admin.orders.cancel}
              confirmLabel={t.admin.orders.cancelConfirm}
              busy={busy}
              onConfirm={() => setStatus('cancelled')}
            />
          )}
          {(cancelRefusal === 'refund_instead' || cancelRefusal === 'owner_only') && (
            <span className="small muted">{cancelRefusal === 'refund_instead' ? t.admin.orders.cancelPaid : t.admin.orders.cancelOwnerOnly}</span>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack" style={{ ['--gap' as string]: '20px' }}>
          <section className="panel stack">
            <h2 className="admin-card-title">{t.admin.orders.items}</h2>
            <TableWrap label={t.admin.orders.items}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.admin.orders.items}</th>
                    <th>{t.admin.orders.composition}</th>
                    <th className="end">{t.common.qty}</th>
                    <th className="end">{t.common.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line, i) => (
                    <tr key={i}>
                      <td>
                        <strong>{l(line.name)}</strong>
                        <div className="small muted">
                          {formatSize(line.size)} · {money(line.unitPrice)}
                        </div>
                      </td>
                      <td className="small">
                        {line.composition.map((x) => {
                          const o = origin(x.originId);
                          return (
                            <div key={x.originId} className="cell-flag">
                              {o && <Flag code={o.countryCode} size={16} />} {o ? l(o.name) : x.originId} · {x.percent}% ·{' '}
                              <span className="num">{formatNumber(x.grams, 1)} g</span>
                            </div>
                          );
                        })}
                      </td>
                      <td className="num end">×{line.qty}</td>
                      <td className="num end">{money(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <dl className="kv">
              <div>
                <dt>{t.common.weight}</dt>
                <dd className="num">{formatKg(order.weightKg)}</dd>
              </div>
              <div>
                <dt>{t.common.subtotal}</dt>
                <dd className="num">{money(order.subtotal)}</dd>
              </div>
              <div>
                <dt>{t.common.delivery}</dt>
                <dd className="num">{money(order.shippingFee)}</dd>
              </div>
              <div>
                <dt>{t.common.total}</dt>
                <dd className="num">
                  <strong>{money(order.total)}</strong>
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel stack">
            <h2 className="admin-card-title">{t.admin.orders.stockUsed}</h2>
            <div className="row">
              {order.stockDeductions.map((d) => {
                const o = origin(d.originId);
                return (
                  <span key={d.originId} className="pill pill-plain num">
                    {o && <Flag code={o.countryCode} size={14} />} {o ? l(o.name) : d.originId} · {formatKg(d.kg)}
                  </span>
                );
              })}
            </div>
          </section>
        </div>

        <div className="stack" style={{ ['--gap' as string]: '20px' }}>
          <section className="panel stack">
            <h2 className="admin-card-title">{t.admin.orders.customer}</h2>
            <dl className="kv">
              <div>
                <dt>{t.checkout.fullName}</dt>
                <dd>{c.fullName}</dd>
              </div>
              <div>
                <dt>{t.checkout.phone}</dt>
                <dd className="num" dir="ltr">
                  {c.phone}
                </dd>
              </div>
              {c.email && (
                <div>
                  <dt>{t.checkout.email}</dt>
                  <dd>{c.email}</dd>
                </div>
              )}
              <div>
                <dt>{t.checkout.city}</dt>
                <dd>{city ? l(city.city) : c.cityId}</dd>
              </div>
              <div>
                <dt>{t.checkout.address}</dt>
                <dd>{c.address}</dd>
              </div>
              {c.notes && (
                <div>
                  <dt>{t.checkout.notes}</dt>
                  <dd>{c.notes}</dd>
                </div>
              )}
            </dl>
            <a
              className="btn btn-ghost btn-sm"
              style={{ alignSelf: 'flex-start' }}
              href={whatsappLink(c.phone, `Bonjour ${c.fullName.split(' ')[0]}, BOGA CAFÉ — commande ${order.number}.`)}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="whatsapp" size={16} /> {t.admin.orders.contactCustomer}
            </a>
          </section>

          <section className="panel stack">
            <h2 className="admin-card-title">{t.checkout.paymentTitle}</h2>
            <dl className="kv">
              <div>
                <dt>{t.admin.orders.method}</dt>
                <dd>{method ? l(method.label) : order.paymentMethod}</dd>
              </div>
              <div>
                <dt>{t.common.status}</dt>
                <dd>
                  <PaymentPill status={order.paymentStatus} />
                </dd>
              </div>
              {order.paymentRef && (
                <div>
                  <dt>{t.admin.orders.paymentRef}</dt>
                  <dd className="num">{order.paymentRef}</dd>
                </div>
              )}
            </dl>
            <div className="row">
              {pay('paid') && (
                <button type="button" className="btn btn-primary btn-sm" aria-disabled={busy || undefined} onClick={() => setPayment('paid')}>
                  {t.admin.orders.markPaid}
                </button>
              )}
              {pay('failed') && (
                <button type="button" className="btn btn-ghost btn-sm" aria-disabled={busy || undefined} onClick={() => setPayment('failed')}>
                  {t.admin.orders.markFailed}
                </button>
              )}
              {pay('refunded') && (
                <ConfirmButton
                  className="btn btn-ghost btn-sm"
                  label={t.admin.orders.markRefunded}
                  confirmLabel={refundCancelsOrder(order) ? t.admin.orders.refundCancelConfirm : t.admin.orders.refundConfirm}
                  busy={busy}
                  onConfirm={() => setPayment('refunded')}
                />
              )}
              {role !== 'owner' && <span className="small muted">{t.admin.orders.ownerPayments}</span>}
            </div>
            {pay('paid') && <p className="small muted">{t.admin.orders.paidMeans}</p>}
            {deadline !== null && <p className="small muted">{fmt(t.admin.orders.reservedUntil, { date: date(new Date(deadline).toISOString(), true) })}</p>}
          </section>

          <section className="panel stack">
            <h2 className="admin-card-title">{t.admin.orders.history}</h2>
            <ol className="history">
              {[...order.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="muted num">{date(h.at, true)}</span>
                  <span>{t.admin.orders.events[h.label] ?? h.label}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
