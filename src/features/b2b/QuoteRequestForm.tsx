import { useState, type FormEvent } from 'react';
import type { CartItem } from '@/core/types';
import { api, type RequestError } from '@/data/api';
import { fmt, useI18n } from '@/i18n';
import { Field } from '@/shared/ui/bits';
import { RequestFields, emptyRequest } from './RequestFields';

/** Sends a cart above 10 kg to the administration, which sets the final price. */
export function QuoteRequestForm({ items, onSent }: { items: CartItem[]; onSent: () => void }) {
  const { t } = useI18n();
  const [contact, setContact] = useState(emptyRequest);
  const [errors, setErrors] = useState<RequestError[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api.requestQuote({ ...contact, items });
    setBusy(false);
    if (!r.ok) return setErrors(r.errors);
    setSent(r.quote.number);
    onSent();
  }

  if (sent) return <p className="notice notice-ok">{fmt(t.cart.b2bSent, { ref: sent })}</p>;

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <RequestFields idPrefix="quote" value={contact} onChange={setContact} errors={errors} />
      <Field label={t.b2b.notes} htmlFor="quote-notes" optional className="span-all">
        <textarea
          id="quote-notes"
          className="textarea"
          value={contact.notes}
          onChange={(e) => setContact({ ...contact, notes: e.target.value })}
        />
      </Field>
      <div className="span-all">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t.common.sending : t.cart.b2bSend}
        </button>
      </div>
    </form>
  );
}
