import { useState } from 'react';
import { formatKg, formatSize } from '@/core/format';
import type { QuoteRequest, QuoteStatus, SampleRequest, SampleStatus } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '@/shared/ui/Icon';
import { Tabs } from '../ui';

const SAMPLE_STATUSES: SampleStatus[] = ['new', 'contacted', 'approved', 'shipped', 'closed', 'rejected'];
const QUOTE_STATUSES: QuoteStatus[] = ['new', 'negotiating', 'confirmed', 'closed'];

export function B2BRequestsPage() {
  const { t } = useI18n();
  const { samples, quotes } = useDb();
  const [tab, setTab] = useState<'samples' | 'quotes'>('samples');
  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.b2b}</h1>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'samples', label: t.admin.b2b.samplesTab, count: samples.length },
          { id: 'quotes', label: t.admin.b2b.quotesTab, count: quotes.length },
        ]}
      />
      <div className="stack" style={{ ['--gap' as string]: '14px' }}>
        {tab === 'samples' &&
          (samples.length ? samples.map((s) => <SampleCard key={s.id} s={s} />) : <p className="muted">{t.admin.b2b.empty}</p>)}
        {tab === 'quotes' &&
          (quotes.length ? quotes.map((q) => <QuoteCard key={q.id} q={q} />) : <p className="muted">{t.admin.b2b.empty}</p>)}
      </div>
    </>
  );
}

function Head({ number, createdAt, company, contactName, phone, cityId, businessType }: SampleRequest | QuoteRequest) {
  const { t, l, date } = useI18n();
  const { shippingRates } = useDb();
  const city = shippingRates.find((r) => r.id === cityId);
  return (
    <div className="spread">
      <div className="stack" style={{ ['--gap' as string]: '2px' }}>
        <strong>
          <span className="num">{number}</span> · {company || contactName}
        </strong>
        <span className="small muted">
          {t.b2b.types[businessType]} · {contactName} · <span dir="ltr">{phone}</span> · {city ? l(city.city) : cityId} ·{' '}
          {date(createdAt, true)}
        </span>
      </div>
      <a className="btn btn-ghost btn-sm" href={whatsappLink(phone, `Bonjour ${contactName.split(' ')[0]}, BOGA CAFÉ — ${number}.`)} target="_blank" rel="noreferrer">
        <Icon name="whatsapp" size={16} /> WhatsApp
      </a>
    </div>
  );
}

function SampleCard({ s }: { s: SampleRequest }) {
  const { t, l, money } = useI18n();
  const { products } = useDb();
  const product = products.find((p) => p.id === s.productId);
  const set = (patch: Partial<SampleRequest>) => api.updateSample(s.id, patch);
  return (
    <article className="panel stack">
      <Head {...s} />
      <dl className="kv">
        <div>
          <dt>{t.admin.b2b.requestedBlend}</dt>
          <dd>
            <strong>{product ? l(product.name) : s.productId}</strong> · 500 g
          </dd>
        </div>
        <div>
          <dt>{t.admin.b2b.monthly}</dt>
          <dd className="num">{s.estMonthlyKg} kg</dd>
        </div>
        {s.notes && (
          <div>
            <dt>{t.b2b.notes}</dt>
            <dd>{s.notes}</dd>
          </div>
        )}
        <div>
          <dt>{t.admin.b2b.deliveryFee}</dt>
          <dd className="num">{money(s.deliveryFee)}</dd>
        </div>
      </dl>
      <div className="form-grid">
        <label className="field">
          <span className="label">{t.common.status}</span>
          <select className="select" value={s.status} onChange={(e) => set({ status: e.target.value as SampleStatus })}>
            {SAMPLE_STATUSES.map((st) => (
              <option key={st} value={st}>
                {t.admin.b2b.sampleStatus[st]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t.admin.b2b.decision}</span>
          <select
            className="select"
            value={s.free === null ? '' : s.free ? 'free' : 'paid'}
            onChange={(e) => set({ free: e.target.value === '' ? null : e.target.value === 'free' })}
          >
            <option value="">{t.admin.b2b.undecided}</option>
            <option value="free">{t.admin.b2b.offered}</option>
            <option value="paid">{t.admin.b2b.paid}</option>
          </select>
        </label>
        <label className="field span-all">
          <span className="label">{t.admin.b2b.adminNotes}</span>
          <input className="input" value={s.adminNotes} onChange={(e) => set({ adminNotes: e.target.value })} />
        </label>
      </div>
    </article>
  );
}

function QuoteCard({ q }: { q: QuoteRequest }) {
  const { t, l, money } = useI18n();
  const set = (patch: Partial<QuoteRequest>) => api.updateQuote(q.id, patch);
  return (
    <article className="panel stack">
      <Head {...q} />
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {q.lines.map((line, i) => (
              <tr key={i}>
                <td>
                  {l(line.name)} · {formatSize(line.size)}
                </td>
                <td className="num end">×{line.qty}</td>
                <td className="num end">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="kv">
        <div>
          <dt>{t.common.weight}</dt>
          <dd className="num">
            <strong>{formatKg(q.weightKg)}</strong>
          </dd>
        </div>
        <div>
          <dt>{t.admin.b2b.indicative}</dt>
          <dd className="num">{money(q.indicativeTotal)}</dd>
        </div>
        {q.notes && (
          <div>
            <dt>{t.b2b.notes}</dt>
            <dd>{q.notes}</dd>
          </div>
        )}
      </dl>
      <div className="form-grid">
        <label className="field">
          <span className="label">{t.common.status}</span>
          <select className="select" value={q.status} onChange={(e) => set({ status: e.target.value as QuoteStatus })}>
            {QUOTE_STATUSES.map((st) => (
              <option key={st} value={st}>
                {t.admin.b2b.quoteStatus[st]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t.admin.b2b.finalPrice}</span>
          <input
            className="input num"
            type="number"
            min={0}
            value={q.finalPrice ?? ''}
            onChange={(e) => set({ finalPrice: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
        <label className="field span-all">
          <span className="label">{t.admin.b2b.adminNotes}</span>
          <input className="input" value={q.adminNotes} onChange={(e) => set({ adminNotes: e.target.value })} />
        </label>
      </div>
    </article>
  );
}
