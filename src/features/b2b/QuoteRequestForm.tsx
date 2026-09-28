import { useState, type FormEvent } from 'react';
import { TEXT_MAX } from '@/core/limits';
import type { CartItem } from '@/core/types';
import { api, type RequestError } from '@/data/api';
import type { MessageDraft } from '@/services/notifications';
import { useI18n } from '@/i18n';
import { Field } from '@/shared/ui/bits';
import { RequestFields, emptyRequest, focusFirstError } from './RequestFields';

/** Sends a cart above 10 kg to the administration, which sets the final price. */
export function QuoteRequestForm({ items, onSent }: { items: CartItem[]; onSent: (ref: string, message: MessageDraft) => void }) {
  const { t } = useI18n();
  const [contact, setContact] = useState(emptyRequest);
  const [errors, setErrors] = useState<RequestError[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api.requestQuote({ ...contact, items });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.errors);
      focusFirstError('quote', r.errors);
      return;
    }
    onSent(r.quote.number, r.message);
  }

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <RequestFields idPrefix="quote" value={contact} onChange={setContact} errors={errors} />
      <Field label={t.b2b.notes} htmlFor="quote-notes" optional className="span-all">
        <textarea
          id="quote-notes"
          className="textarea"
          maxLength={TEXT_MAX.notes}
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
