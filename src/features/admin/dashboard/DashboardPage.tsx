import { Link, useNavigate } from 'react-router';
import { formatKg, formatNumber } from '@/core/format';
import { isLowStock } from '@/core/stock';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { can } from '../permissions';
import { useAdminRole } from '../session';
import { Kpi, OrderStatusPill, PaymentPill, RowLink, TableWrap, rowClick } from '../ui';

export function DashboardPage() {
  const { t, l, money, date } = useI18n();
  const db = useDb();
  const navigate = useNavigate();
  const role = useAdminRole()!;
  const orders = db.orders;
  const count = (f: (o: (typeof orders)[number]) => boolean) => orders.filter(f).length;
  const low = db.origins.filter(isLowStock);
  const revenue = orders.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0);
  const totalStock = db.origins.filter((o) => o.active).reduce((s, o) => s + o.stockKg, 0);
  const b2b = [
    ...db.samples.map((s) => ({ id: s.id, at: s.createdAt, ref: s.number, who: s.company || s.contactName, what: '500 g', status: t.admin.b2b.sampleStatus[s.status], isNew: s.status === 'new' })),
    ...db.quotes.map((q) => ({ id: q.id, at: q.createdAt, ref: q.number, who: q.company || q.contactName, what: formatKg(q.weightKg), status: t.admin.b2b.quoteStatus[q.status], isNew: q.status === 'new' })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.dashboard}</h1>
      </div>

      <div className="kpis">
        <Kpi label={t.admin.dash.newOrders} value={count((o) => o.status === 'new')} to="/admin/orders" tone="warn" />
        <Kpi
          label={t.admin.dash.inProgress}
          value={count((o) => ['confirmed', 'in_production', 'shipped'].includes(o.status))}
          to="/admin/orders"
        />
        <Kpi label={t.admin.dash.completed} value={count((o) => o.status === 'delivered')} tone="ok" to="/admin/orders" />
        <Kpi
          label={t.admin.dash.samples}
          value={db.samples.filter((s) => ['new', 'contacted'].includes(s.status)).length}
          to="/admin/b2b"
        />
        <Kpi label={t.admin.dash.toVerify} value={count((o) => o.paymentStatus === 'awaiting_verification')} to={can(role, 'payments') ? '/admin/payments' : '/admin/orders?view=verify'} />
        <Kpi label={t.admin.dash.stock} value={formatKg(totalStock)} to="/admin/stock" tone={low.length ? 'bad' : 'ok'} />
        <Kpi label={t.admin.dash.revenue} value={money(revenue)} />
      </div>

      <div className="admin-cols">
        <section className="stack">
          <div className="spread">
            <h2 className="admin-card-title">{t.admin.dash.recentOrders}</h2>
            <Link to="/admin/orders" className="small">
              {t.common.all} <span className="dir-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
          <TableWrap>
            <table className="table">
              <tbody>
                {orders.slice(0, 6).map((o) => (
                  <tr key={o.id} className="clickable" onClick={rowClick(navigate, `/admin/orders/${o.id}`)}>
                    <td>
                      <RowLink to={`/admin/orders/${o.id}`}>
                        <strong className="num">{o.number}</strong>
                      </RowLink>
                      <div className="small muted">{date(o.createdAt, true)}</div>
                    </td>
                    <td>{o.customer.fullName}</td>
                    <td className="num end">{money(o.total)}</td>
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
        </section>

        <div className="stack" style={{ ['--gap' as string]: '20px' }}>
          <section className="panel stack">
            <h2 className="admin-card-title">{t.admin.dash.lowStock}</h2>
            {low.length === 0 ? (
              <p className="small muted">{t.admin.dash.allGood}</p>
            ) : (
              low.map((o) => (
                <div key={o.id} className="spread">
                  <span className="cell-flag">
                    <Flag code={o.countryCode} /> {l(o.name)}
                  </span>
                  <span className={`pill ${o.stockKg === 0 ? 'pill-bad' : 'pill-warn'} num`}>
                    {formatNumber(o.stockKg, 2)} / {formatNumber(o.lowStockKg)} kg
                  </span>
                </div>
              ))
            )}
            <Link to="/admin/stock" className="small">
              {t.admin.nav.stock} <span className="dir-arrow" aria-hidden="true">→</span>
            </Link>
          </section>

          <section className="panel stack">
            <h2 className="admin-card-title">{t.admin.dash.recentB2B}</h2>
            {b2b.map((r) => (
              <Link key={r.id} to="/admin/b2b" className="spread small" style={{ textDecoration: 'none' }}>
                <span>
                  <strong className="num">{r.ref}</strong> · {r.who}
                </span>
                <span className="row" style={{ ['--gap' as string]: '6px' }}>
                  <span className="muted num">{r.what}</span>
                  <span className={`pill ${r.isNew ? 'pill-warn' : ''}`}>{r.status}</span>
                </span>
              </Link>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
