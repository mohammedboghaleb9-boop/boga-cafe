/** Contact fields shared by the sample request and the +10 kg request. */
import type { BusinessType } from '@/core/types';
import type { ContactRequestInput, RequestError } from '@/data/api';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Field } from '@/shared/ui/bits';

export const emptyRequest: ContactRequestInput = {
  businessType: 'cafe',
  company: '',
  contactName: '',
  phone: '',
  email: '',
  cityId: '',
  notes: '',
};

const TYPES: BusinessType[] = ['cafe', 'hotel', 'restaurant', 'company', 'individual', 'other'];

export function RequestFields({
  idPrefix,
  value,
  onChange,
  errors,
}: {
  idPrefix: string;
  value: ContactRequestInput;
  onChange: (v: ContactRequestInput) => void;
  errors: RequestError[];
}) {
  const { t, l } = useI18n();
  const { shippingRates } = useDb();
  const set = <K extends keyof ContactRequestInput>(k: K, v: ContactRequestInput[K]) => onChange({ ...value, [k]: v });
  const err = (k: RequestError) => (errors.includes(k) ? t.checkout.errors[k === 'product' ? 'cart_problem' : k] : undefined);

  return (
    <>
      <Field label={t.b2b.businessType} htmlFor={`${idPrefix}-type`}>
        <select
          id={`${idPrefix}-type`}
          className="select"
          value={value.businessType}
          onChange={(e) => set('businessType', e.target.value as BusinessType)}
        >
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t.b2b.types[ty]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.b2b.company} htmlFor={`${idPrefix}-company`} optional>
        <input id={`${idPrefix}-company`} className="input" value={value.company} onChange={(e) => set('company', e.target.value)} />
      </Field>
      <Field label={t.b2b.contactName} htmlFor={`${idPrefix}-name`} error={err('name')}>
        <input
          id={`${idPrefix}-name`}
          className="input"
          autoComplete="name"
          value={value.contactName}
          aria-invalid={errors.includes('name')}
          onChange={(e) => set('contactName', e.target.value)}
        />
      </Field>
      <Field label={t.checkout.phone} htmlFor={`${idPrefix}-phone`} error={err('phone')}>
        <input
          id={`${idPrefix}-phone`}
          className="input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="06 12 34 56 78"
          value={value.phone}
          aria-invalid={errors.includes('phone')}
          onChange={(e) => set('phone', e.target.value)}
        />
      </Field>
      <Field label={t.checkout.email} htmlFor={`${idPrefix}-email`} optional error={err('email')}>
        <input
          id={`${idPrefix}-email`}
          className="input"
          type="email"
          autoComplete="email"
          value={value.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </Field>
      <Field label={t.b2b.city} htmlFor={`${idPrefix}-city`} error={err('city')}>
        <select
          id={`${idPrefix}-city`}
          className="select"
          value={value.cityId}
          aria-invalid={errors.includes('city')}
          onChange={(e) => set('cityId', e.target.value)}
        >
          <option value="">{t.b2b.chooseCity}</option>
          {shippingRates
            .filter((r) => r.active)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {l(r.city)}
              </option>
            ))}
        </select>
      </Field>
    </>
  );
}
