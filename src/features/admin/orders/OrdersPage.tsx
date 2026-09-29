import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { formatKg } from '@/core/format';
import type { Order } from '@/core/types';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { OrderStatusPill, PaymentPill, RowLink, TableWrap, Tabs, rowClick } from '../ui';

type View = 'all' | 'new' | 'verify' | 'progress' | 'delivered' | 'cancelled';

const inView: Record<View, (o: Order) => boolean> = {
  all: () => true,
  new: (o) => o.status === 'new',
  // the customer said "I have paid": the owner checks the payment
  verify: (o) => o.paymentStatus === 'awaiting_verification',
  progress: (o) => ['confirmed', 'in_production', 'shipped'].includes(o.status),
  delivered: (o) => o.status === 'delivered',
  cancelled: (o) => o.status === 'cancelled',
};

export function OrdersPage() {
  const { t, l, money, date } = useI18n();
  const { orders, shippingRates, paymentMethods } = useDb();
  const navigate = useNavigate();
  // the tab is part of the address (?view=verify, linked from the dashboard); unknown values show All
  const [params, setParams] = useSearchParams();
  const asked = params.get('view') ?? '';
  const view: View = Object.hasOwn(inView, asked) ? (asked as View) : 'all';
  const setView = (v: View) => setParams(v === 'all' ? {} : { view: v }, { replace: true });
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = orders.filter(
    (o) =>
      inView[view](o) &&
      (!needle ||
        o.number.toLowerCase().includes(needle) ||
        o.customer.fullName.toLowerCase().includes(needle) ||
        o.customer.phone.includes(needle.replace(/\s/g, ''))),
  );
  const city = (id: string) => {
    const r = shippingRates.find((x) => x.id === id);
    return r ? l(r.city) : id;
  };

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.orders}</h1>
        <div className="toolbar">
          <input
            className="input"
            type="search"
            placeholder={t.admin.orders.searchPlaceholder}
            aria-label={t.common.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <Tabs<View>
        value={view}
        onChange={setView}
        items={[
          { id: 'all', label: t.common.all, count: orders.length },
          { id: 'new', label: t.orderStatus.new, count: orders.filter(inView.new).length },
          { id: 'verify', label: t.admin.dash.toVerify, count: orders.filter(inView.verify).length },
          { id: 'progress', label: t.admin.dash.inProgress, count: orders.filter(inView.progress).length },
          { id: 'delivered', label: t.orderStatus.delivered, count: orders.filter(inView.delivered).length },
          { id: 'cancelled', label: t.orderStatus.cancelled, count: orders.filter(inView.cancelled).length },
        ]}
      />
      {list.length === 0 ? (
        <p className="muted">{t.admin.orders.empty}</p>
      ) : (
        <TableWrap label={t.admin.nav.orders}>
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.reference}</th>
                <th>{t.admin.orders.customer}</th>
                <th>{t.admin.orders.city}</th>
                <th className="end">{t.common.weight}</th>
                <th className="end">{t.common.total}</th>
                <th>{t.admin.orders.method}</th>
                <th>{t.checkout.paymentTitle}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="clickable" onClick={rowClick(navigate, `/admin/orders/${o.id}`)}>
                  <td>
                    <RowLink to={`/admin/orders/${o.id}`}>
                      <strong className="num">{o.number}</strong>
                    </RowLink>
                    <div className="small muted">{date(o.createdAt, true)}</div>
                  </td>
                  <td>
                    {o.customer.fullName}
                    <div className="small muted num" dir="ltr">
                      {o.customer.phone}
                    </div>
                  </td>
                  <td>{city(o.customer.cityId)}</td>
                  <td className="num end">{formatKg(o.weightKg)}</td>
                  <td className="num end">
                    <strong>{money(o.total)}</strong>
                  </td>
                  <td className="small">{l(paymentMethods.find((m) => m.id === o.paymentMethod)?.label ?? { ar: '', fr: o.paymentMethod, en: '' })}</td>
                  <td>
                    <PaymentPill status={o.paymentStatus} />
                  </td>
                  <td>
                    <OrderStatusPill status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
