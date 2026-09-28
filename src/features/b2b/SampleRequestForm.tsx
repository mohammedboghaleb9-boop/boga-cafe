import { useState, type FormEvent } from 'react';
import { TEXT_MAX } from '@/core/limits';
import { api, type RequestError } from '@/data/api';
import { useCatalog, useDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import type { MessageDraft } from '@/services/notifications';
import { SendToBoga } from '@/shared/layout/SendToBoga';
import { Field } from '@/shared/ui/bits';
import { RequestFields, emptyRequest, focusFirstError } from './RequestFields';

export function SampleRequestForm({ initialProductId }: { initialProductId?: string }) {
  const { t, l, money } = useI18n();
  const { products } = useCatalog();
  const { shippingRates } = useDb();
  const b2bBlends = products.filter((p) => p.active && p.kind === 'b2b');
  const [contact, setContact] = useState(emptyRequest);
  const [productId, setProductId] = useState(initialProductId ?? b2bBlends[0]?.id ?? '');
  const [monthly, setMonthly] = useState(20);
  const [errors, setErrors] = useState<RequestError[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ ref: string; message: MessageDraft } | null>(null);
  const rate = shippingRates.find((r) => r.id === contact.cityId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api.requestSample({ ...contact, productId, estMonthlyKg: monthly });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.errors);
      focusFirstError('sample', r.errors, 'sample-blend');
      return;
    }
    setErrors([]);
    setSent({ ref: r.sample.number, message: r.message });
    setContact(emptyRequest);
  }

  if (sent) {
    return (
      <div className="stack">
        <SendToBoga draft={sent.message} refNumber={sent.ref} reveal />
        <button type="button" className="btn-link small" onClick={() => setSent(null)} style={{ alignSelf: 'flex-start' }}>
          {t.common.back}
        </button>
      </div>
    );
  }

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <RequestFields idPrefix="sample" value={contact} onChange={setContact} errors={errors} />
      <Field label={t.b2b.blend} htmlFor="sample-blend" error={errors.includes('product') ? t.b2b.blendError : undefined}>
        <select id="sample-blend" className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {b2bBlends.map((p) => (
            <option key={p.id} value={p.id}>
              {l(p.name)} · 500 g
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.b2b.monthly} htmlFor="sample-monthly">
        <input
          id="sample-monthly"
          className="input num"
          type="number"
          min={0}
          value={monthly}
          onChange={(e) => setMonthly(Math.max(0, Number(e.target.value)))}
        />
      </Field>
      <Field label={t.b2b.notes} htmlFor="sample-notes" optional className="span-all">
        <textarea
          id="sample-notes"
          className="textarea"
          maxLength={TEXT_MAX.notes}
          value={contact.notes}
          onChange={(e) => setContact({ ...contact, notes: e.target.value })}
        />
      </Field>
      <div className="span-all spread">
        <span className="small muted">
          {rate ? fmt(t.b2b.deliveryFee, { city: l(rate.city), fee: money(rate.baseFee) }) : t.b2b.rules[3]}
        </span>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t.common.sending : t.b2b.submitSample}
        </button>
      </div>
    </form>
  );
}
