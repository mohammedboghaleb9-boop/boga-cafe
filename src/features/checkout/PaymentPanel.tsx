/**
 * What the customer sees after placing the order, per payment method.
 * Card: the gateway step (simulated here, CMI on the real site).
 * Cash Plus / transfer: instructions, reference, and "I have paid".
 */
import { useState, type FormEvent } from 'react';
import type { Order } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { paymentAdapter } from '@/services/payments';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '@/shared/ui/Icon';
import { CopyButton, Field } from '@/shared/ui/bits';

export function PaymentPanel({ order }: { order: Order }) {
  const { t, l, money } = useI18n();
  const { paymentMethods, settings } = useDb();
  const method = paymentMethods.find((m) => m.id === order.paymentMethod);

  if (order.status === 'cancelled') return null;
  if (order.paymentStatus === 'paid') {
    return (
      <p className="notice notice-ok row">
        <Icon name="check" size={18} /> {t.paymentStatus.paid} · {method && l(method.label)}
      </p>
    );
  }
  if (order.paymentStatus === 'awaiting_verification') {
    return <p className="notice">{t.payment.reported}</p>;
  }

  const step = paymentAdapter(order.paymentMethod).start(order);

  if (step.type === 'demo-gateway') return <DemoGateway order={order} />;
  if (step.type === 'form-post') {
    return (
      <form method="post" action={step.action}>
        {Object.entries(step.fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button className="btn btn-primary">{fmt(t.payment.pay, { amount: money(order.total) })}</button>
      </form>
    );
  }

  return (
    <div className="panel stack pay-box">
      <h2 className="checkout-h2">
        <Icon name={step.method === 'cashplus' ? 'cash' : 'bank'} /> {method && l(method.label)}
      </h2>
      <p>{method && l(method.instructions)}</p>
      <dl className="pay-details">
        <div>
          <dt>{t.payment.beneficiary}</dt>
          <dd>{settings.bank.holder}</dd>
        </div>
        {step.method === 'bank_transfer' && (
          <>
            <div>
              <dt>{t.payment.bank}</dt>
              <dd>{settings.bank.bankName}</dd>
            </div>
            <div>
              <dt>{t.payment.rib}</dt>
              <dd className="row">
                <span className="num" dir="ltr">
                  {settings.bank.rib}
                </span>
                <CopyButton text={settings.bank.rib} />
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>{t.payment.amount}</dt>
          <dd className="num">
            <strong>{money(order.total)}</strong>
          </dd>
        </div>
        <div>
          <dt>{t.common.reference}</dt>
          <dd className="row">
            <strong className="num">{step.reference}</strong>
            <CopyButton text={step.reference} />
          </dd>
        </div>
      </dl>
      <ReportPayment order={order} />
      <a
        className="btn btn-ghost"
        style={{ alignSelf: 'flex-start' }}
        href={whatsappLink(settings.contact.whatsapp, `${t.contact.whatsappText} ${order.number}`)}
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="whatsapp" size={18} /> {t.payment.sendReceipt}
      </a>
    </div>
  );
}

function ReportPayment({ order }: { order: Order }) {
  const { t } = useI18n();
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ref.trim()) return;
    setBusy(true);
    await api.reportOfflinePayment(order.id, ref.trim());
    setBusy(false);
  }
  return (
    <form className="stack report" onSubmit={submit}>
      <strong>{t.payment.reportTitle}</strong>
      <span className="small muted">{t.payment.reportText}</span>
      <div className="row report-row">
        <Field label={t.payment.reportField} htmlFor="pay-ref">
          <input id="pay-ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || !ref.trim()}>
          {busy ? t.common.sending : t.payment.reportSend}
        </button>
      </div>
    </form>
  );
}

function DemoGateway({ order }: { order: Order }) {
  const { t, money } = useI18n();
  const [busy, setBusy] = useState(false);
  const pay = async (success: boolean) => {
    setBusy(true);
    await api.completeCardPayment(order.id, success);
    setBusy(false);
  };
  return (
    <div className="gateway">
      <div className="gateway-head">
        <span className="row">
          <Icon name="lock" size={18} /> <strong>{t.payment.gatewayTitle}</strong>
        </span>
        <span className="gateway-brand">CMI · 3-D Secure</span>
      </div>
      <p className="small muted">{t.payment.gatewayNote}</p>
      {order.paymentStatus === 'failed' && <p className="notice notice-bad small">{t.payment.failed}</p>}
      <div className="form-grid">
        <Field label={t.payment.cardNumber} htmlFor="gw-card" className="span-all">
          <input id="gw-card" className="input num" dir="ltr" defaultValue="4000 0000 0000 0002" />
        </Field>
        <Field label={t.payment.expiry} htmlFor="gw-exp">
          <input id="gw-exp" className="input num" dir="ltr" defaultValue="12/29" />
        </Field>
        <Field label={t.payment.cvc} htmlFor="gw-cvc">
          <input id="gw-cvc" className="input num" dir="ltr" defaultValue="123" />
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => pay(true)}>
          {busy ? t.common.loading : fmt(t.payment.pay, { amount: money(order.total) })}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => pay(false)}>
          {t.payment.simulateFail}
        </button>
      </div>
    </div>
  );
}
