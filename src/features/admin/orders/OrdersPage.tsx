import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatKg } from '@/core/format';
import type { Order } from '@/core/types';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { OrderStatusPill, PaymentPill, Tabs } from '../ui';

type View = 'all' | 'new' | 'progress' | 'delivered' | 'cancelled';

const inView: Record<View, (o: Order) => boolean> = {
  all: () => true,
  new: (o) => o.status === 'new',
  progress: (o) => ['confirmed', 'in_production', 'shipped'].includes(o.status),
  delivered: (o) => o.status === 'delivered',
  cancelled: (o) => o.status === 'cancelled',
};

export function OrdersPage() {
  const { t, l, money, date } = useI18n();
  const { orders, shippingRates, paymentMethods } = useDb();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('all');
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
          { id: 'progress', label: t.admin.dash.inProgress, count: orders.filter(inView.progress).length },
          { id: 'delivered', label: t.orderStatus.delivered, count: orders.filter(inView.delivered).length },
          { id: 'cancelled', label: t.orderStatus.cancelled, count: orders.filter(inView.cancelled).length },
        ]}
      />
      {list.length === 0 ? (
        <p className="muted">{t.admin.orders.empty}</p>
      ) : (
        <div className="table-wrap">
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
                <tr key={o.id} className="clickable" onClick={() => navigate(`/admin/orders/${o.id}`)}>
                  <td>
                    <strong className="num">{o.number}</strong>
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
        </div>
      )}
    </>
  );
}
