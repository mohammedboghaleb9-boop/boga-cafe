import { useState } from 'react';
import { formatKg, formatSize } from '@/core/format';
import type { QuoteRequest, QuoteStatus } from '@/core/types';
import { api } from '@/data/api';
import { canWrite, useAdminDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '@/shared/ui/Icon';
import { ComingSoon, SavedFlash, TableWrap, WriteError, useSavedFlash } from '../ui';
import { useAction } from '../useAction';

const QUOTE_STATUSES: QuoteStatus[] = ['new', 'negotiating', 'confirmed', 'closed'];

/** Carts above the B2B threshold. Samples are ordinary paid 250 g / 500 g bags now (owner, 2026-09-30): they arrive as orders. */
export function B2BRequestsPage() {
  const { t } = useI18n();
  const { quotes, settings } = useAdminDb();
  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.b2b}</h1>
      </div>
      <h2 className="admin-card-title">
        {fmt(t.admin.b2b.quotesTab, { kg: settings.b2bThresholdKg })} <span className="muted num">({quotes.length})</span>
      </h2>
      <div className="stack" style={{ ['--gap' as string]: '14px' }}>
        {quotes.length ? quotes.map((q) => <QuoteCard key={q.id} q={q} />) : <p className="muted">{t.admin.b2b.empty}</p>}
      </div>
    </>
  );
}

function Head({ number, createdAt, company, contactName, phone, cityId, businessType }: QuoteRequest) {
  const { t, l, date } = useI18n();
  const { shippingRates } = useAdminDb();
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

function QuoteCard({ q }: { q: QuoteRequest }) {
  const { t, l, money } = useI18n();
  // the follow-up is edited here and saved by the button, not on every keystroke
  const [form, setForm] = useState({ status: q.status, finalPrice: q.finalPrice, adminNotes: q.adminNotes });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [busy, run, failed] = useAction();
  const [saved, flash] = useSavedFlash();
  const writable = canWrite('b2b');
  const priceOk = form.finalPrice === null || (Number.isFinite(form.finalPrice) && form.finalPrice >= 0);
  const save = () =>
    run(async () => {
      await api.updateQuote(q.id, form);
      flash();
    });
  return (
    <article className="panel stack">
      <Head {...q} />
      <TableWrap label={t.admin.nav.b2b}>
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
      </TableWrap>
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
      {!writable && <ComingSoon />}
      <fieldset className="plain-fieldset form-grid" disabled={!writable}>
        <label className="field">
          <span className="label">{t.common.status}</span>
          <select className="select" value={form.status} onChange={(e) => set({ status: e.target.value as QuoteStatus })}>
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
            value={form.finalPrice ?? ''}
            onChange={(e) => set({ finalPrice: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
        <label className="field span-all">
          <span className="label">{t.admin.b2b.adminNotes}</span>
          <input className="input" maxLength={500} value={form.adminNotes} onChange={(e) => set({ adminNotes: e.target.value })} />
        </label>
        <div className="row span-all">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!priceOk}
            aria-disabled={busy || undefined}
            aria-label={`${t.common.save} · ${q.number}`}
            onClick={save}
          >
            {t.common.save}
          </button>
          <SavedFlash show={saved} />
        </div>
      </fieldset>
      <WriteError show={failed} />
    </article>
  );
}
