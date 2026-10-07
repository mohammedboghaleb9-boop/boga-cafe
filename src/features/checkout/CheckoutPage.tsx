import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { summarizeCart } from '@/core/cart';
import { formatKg } from '@/core/format';
import type { CheckoutError } from '@/core/order';
import { shippingFee } from '@/core/shipping';
import type { CustomerInfo, PaymentMethodId } from '@/core/types';
import { api, GUARD_ERRORS, type GuardError } from '@/data/api';
import { methodAvailable } from '@/services/payments';
import { useCatalog, useDb } from '@/data/hooks';
import { useCart } from '@/shared/cart/CartProvider';
import { LineDetails } from '@/shared/cart/CartLineView';
import { fmt, useI18n } from '@/i18n';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Field } from '@/shared/ui/bits';
import './checkout.css';
import { TEXT_MAX } from '@/core/limits';
import { usePageTitle } from '@/shared/layout/usePageTitle';

const methodIcon: Record<PaymentMethodId, IconName> = { card: 'card', cashplus: 'cash', bank_transfer: 'bank' };

const emptyCustomer: CustomerInfo = {
  fullName: '',
  phone: '',
  email: '',
  cityId: '',
  address: '',
  company: '',
  notes: '',
};

/** One-page checkout, no account needed. */
/** Where the keyboard goes when an error needs fixing (fields first, in page order). */
const FIELD_OF: Partial<Record<CheckoutError | GuardError, string>> = {
  name: 'co-name',
  phone: 'co-phone',
  email: 'co-email',
  city: 'co-city',
  address: 'co-address',
};

function focusField(error: CheckoutError | GuardError | undefined) {
  if (!error) return;
  requestAnimationFrame(() => {
    const el =
      (FIELD_OF[error] && document.getElementById(FIELD_OF[error])) ||
      (error === 'payment_method' ? document.querySelector<HTMLElement>('.pay-options input') : null) ||
      document.querySelector<HTMLElement>('.checkout-errors');
    el?.focus();
  });
}

export function CheckoutPage() {
  const { t, l, money, locale } = useI18n();
  usePageTitle(t.checkout.title);
  const cart = useCart();
  const navigate = useNavigate();
  const { products, originIndex } = useCatalog();
  const { settings, shippingRates, paymentMethods } = useDb();
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer);
  // the card stays listed as "soon" while no gateway is connected (services/payments)
  const methods = paymentMethods.filter((m) => m.enabled);
  const [method, setMethod] = useState<PaymentMethodId | ''>(methods.find((m) => methodAvailable(m, settings))?.id ?? '');
  const [errors, setErrors] = useState<(CheckoutError | GuardError)[]>([]);
  const [busy, setBusy] = useState(false);

  const summary = summarizeCart(cart.items, { products, origins: originIndex }, settings);
  const rate = shippingRates.find((r) => r.id === customer.cityId && r.active);
  const fee = rate ? shippingFee(rate, summary.weightKg, summary.subtotal, settings) : null;
  const set = <K extends keyof CustomerInfo>(k: K, v: CustomerInfo[K]) => setCustomer((c) => ({ ...c, [k]: v }));
  const err = (k: CheckoutError) => (errors.includes(k) ? t.checkout.errors[k] : undefined);

  if (cart.items.length === 0) {
    return (
      <div className="container page stack" style={{ alignItems: 'flex-start' }}>
        <h1>{t.checkout.title}</h1>
        <p className="lead">{t.cart.empty}</p>
        <Link to="/shop" className="btn btn-primary">
          {t.cart.emptyCta}
        </Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!method) {
      setErrors(['payment_method']);
      focusField('payment_method');
      return;
    }
    setBusy(true);
    const r = await api.placeOrder({ items: cart.items, customer, paymentMethod: method, locale }).finally(() => setBusy(false));
    if (!r.ok) {
      setErrors(r.errors);
      focusField(r.errors.find((code) => code in FIELD_OF) ?? r.errors[0]);
      return;
    }
    cart.clear();
    navigate(`/order/${r.order.id}`);
  }

  const globalErrors = errors.filter((e) =>
    ([...GUARD_ERRORS, 'empty_cart', 'cart_problem', 'unavailable', 'b2b_required', 'out_of_stock'] as (CheckoutError | GuardError)[]).includes(e),
  );

  return (
    <div className="container page">
      <div className="page-head">
        <h1>{t.checkout.title}</h1>
        <p className="muted">{t.checkout.noAccount}</p>
      </div>

      {(summary.isB2B || summary.hasProblems) && (
        <p className="notice notice-warn" style={{ marginBlockEnd: 16 }}>
          {summary.isB2B
            ? t.checkout.errors.b2b_required
            : summary.lines.some((x) => x.problem === 'unavailable')
              ? t.checkout.errors.unavailable
              : t.checkout.errors.cart_problem}{' '}
          <Link to="/cart">
            {t.nav.cart} <span className="dir-arrow" aria-hidden="true">→</span>
          </Link>
        </p>
      )}

      <form className="checkout" onSubmit={submit} noValidate>
        <div className="checkout-main">
          <section className="panel stack">
            <h2 className="checkout-h2">
              <span className="step-n">1</span> {t.checkout.contactTitle}
            </h2>
            <div className="form-grid">
              <Field label={t.checkout.fullName} htmlFor="co-name" error={err('name')}>
                <input
                  id="co-name"
                  className="input"
                  maxLength={TEXT_MAX.name}
                  autoComplete="name"
                  value={customer.fullName}
                  aria-invalid={errors.includes('name')}
                  onChange={(e) => set('fullName', e.target.value)}
                />
              </Field>
              <Field label={t.checkout.phone} htmlFor="co-phone" error={err('phone')}>
                <input
                  id="co-phone"
                  className="input"
                  maxLength={TEXT_MAX.phone}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="06 12 34 56 78"
                  value={customer.phone}
                  aria-invalid={errors.includes('phone')}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </Field>
              <Field label={t.checkout.email} htmlFor="co-email" optional error={err('email')}>
                <input
                  id="co-email"
                  className="input"
                  maxLength={TEXT_MAX.email}
                  type="email"
                  autoComplete="email"
                  value={customer.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              <Field label={t.checkout.city} htmlFor="co-city" error={err('city')}>
                <select
                  id="co-city"
                  className="select"
                  value={customer.cityId}
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
              <Field label={t.checkout.address} htmlFor="co-address" error={err('address')} className="span-all">
                <input
                  id="co-address"
                  className="input"
                  maxLength={TEXT_MAX.address}
                  autoComplete="street-address"
                  value={customer.address}
                  aria-invalid={errors.includes('address')}
                  onChange={(e) => set('address', e.target.value)}
                />
              </Field>
              <Field label={t.checkout.notes} htmlFor="co-notes" optional className="span-all">
                <input id="co-notes" className="input" maxLength={TEXT_MAX.notes} value={customer.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="panel stack">
            <h2 className="checkout-h2">
              <span className="step-n">2</span> {t.checkout.paymentTitle}
            </h2>
            <div className="pay-options" role="radiogroup" aria-label={t.checkout.paymentTitle}>
              {methods.map((m) => {
                const available = methodAvailable(m, settings);
                return (
                  <label key={m.id} className="pay-option" data-checked={method === m.id} data-disabled={!available || undefined}>
                    <input
                      type="radio"
                      name="payment"
                      value={m.id}
                      checked={method === m.id}
                      disabled={!available}
                      onChange={() => setMethod(m.id)}
                    />
                    <Icon name={methodIcon[m.id]} size={22} />
                    <span className="stack" style={{ ['--gap' as string]: '2px' }}>
                      <strong>
                        {l(m.label)} {!available && <span className="pill">{t.checkout.cardSoon}</span>}
                      </strong>
                      <span className="small muted">
                        {available ? l(m.instructions) : m.id === 'card' ? t.checkout.cardSoonText : t.checkout.methodSoonText}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {!methods.some((m) => methodAvailable(m, settings)) && <p className="notice small">{t.checkout.noMethodYet}</p>}
            {err('payment_method') && <span className="field-error">{err('payment_method')}</span>}
            <p className="small muted icon-line">
              <Icon name="lock" size={16} /> {t.checkout.noCod}
            </p>
          </section>
        </div>

        <aside className="checkout-summary panel stack">
          <h2 className="checkout-h2">
            <span className="step-n">3</span> {t.checkout.summaryTitle}
          </h2>
          <ul className="co-lines">
            {summary.lines.map(({ item, line, problem }) =>
              line && problem !== 'unavailable' ? (
                <li key={item.id}>
                  <LineDetails line={line} />
                  <span className="num small">×{line.qty}</span>
                  <strong className="num">{money(line.lineTotal)}</strong>
                </li>
              ) : null,
            )}
          </ul>
          <div className="co-totals">
            <div className="spread">
              <span>{t.common.weight}</span>
              <span className="num">{formatKg(summary.weightKg)}</span>
            </div>
            <div className="spread">
              <span>{t.common.subtotal}</span>
              <span className="num">{money(summary.subtotal)}</span>
            </div>
            <div className="spread">
              <span>{t.common.delivery}</span>
              <span className="num">{fee === null ? '—' : fee === 0 ? t.common.free : money(fee)}</span>
            </div>
            <span className="small muted">
              {rate
                ? fmt(t.checkout.deliveryTo, {
                    city: l(rate.city),
                    days: rate.deliveryDays === '1' ? t.common.day1 : fmt(t.common.days, { d: rate.deliveryDays }),
                  })
                : t.checkout.chooseCityFirst}
            </span>
            {settings.freeShippingOver > 0 && (
              <span className="small muted">{fmt(t.checkout.freeFrom, { amount: money(settings.freeShippingOver) })}</span>
            )}
            <div className="spread co-total">
              <span>{t.common.total}</span>
              <strong className="num">{money(summary.subtotal + (fee ?? 0))}</strong>
            </div>
          </div>
          {globalErrors.length > 0 && (
            <div className="checkout-errors stack" tabIndex={-1} role="alert">
              {globalErrors.map((e) => (
                <p key={e} className="notice notice-bad small">
                  {t.checkout.errors[e]}
                </p>
              ))}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy || summary.isB2B || summary.hasProblems}
          >
            {busy ? t.common.loading : fmt(t.checkout.place, { total: money(summary.subtotal + (fee ?? 0)) })}
          </button>
        </aside>
      </form>
    </div>
  );
}
