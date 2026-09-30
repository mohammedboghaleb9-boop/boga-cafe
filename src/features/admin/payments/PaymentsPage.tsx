import { useState } from 'react';
import { Link } from 'react-router';
import type { PaymentMethodConfig, PaymentMethodId, Settings } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { LocalizedInput, PaymentPill, SavedFlash, Switch, TableWrap, useSavedFlash } from '../ui';
import type { Role } from '../permissions';
import { payeeReady } from '@/core/orderFlow';
import { methodAvailable } from '@/services/payments';
import { useAdminRole } from '../session';

const icons: Record<PaymentMethodId, IconName> = { card: 'card', cashplus: 'cash', bank_transfer: 'bank' };

export function PaymentsPage() {
  const role = useAdminRole()!;
  const { t, money, l } = useI18n();
  const { paymentMethods, orders, settings } = useDb();
  const toVerify = orders.filter(
    (o) => o.status !== 'cancelled' && (o.paymentStatus === 'awaiting_verification' || (o.paymentStatus === 'pending' && o.paymentMethod !== 'card')),
  );

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.payments}</h1>
      </div>
      <p className="muted">{t.admin.payments.intro}</p>

      <section className="stack">
        <h2 className="admin-card-title">{t.admin.payments.toVerify}</h2>
        {toVerify.length === 0 ? (
          <p className="small muted">{t.admin.payments.noneToVerify}</p>
        ) : (
          <TableWrap label={t.admin.payments.toVerify}>
            <table className="table">
              <tbody>
                {toVerify.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/admin/orders/${o.id}`} className="num">
                        <strong>{o.number}</strong>
                      </Link>
                      <div className="small muted">{o.customer.fullName}</div>
                    </td>
                    <td className="small">{l(paymentMethods.find((m) => m.id === o.paymentMethod)!.label)}</td>
                    <td className="small num">{o.paymentRef ?? '—'}</td>
                    <td className="num end">
                      <strong>{money(o.total)}</strong>
                    </td>
                    <td>
                      <PaymentPill status={o.paymentStatus} />
                    </td>
                    <td className="end">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => api.setPaymentStatus(o.id, 'paid', role)}>
                        {t.admin.orders.markPaid}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      <section className="stack">
        <h2 className="admin-card-title">{t.admin.payments.methods}</h2>
        <div className="stack" style={{ ['--gap' as string]: '14px' }}>
          {paymentMethods.map((m) => (
            <MethodEditor key={m.id} method={m} settings={settings} />
          ))}
        </div>
      </section>

      <BankEditor settings={settings} role={role} />
    </>
  );
}

function MethodEditor({ method, settings }: { method: PaymentMethodConfig; settings: Settings }) {
  const { t, l } = useI18n();
  const [m, setM] = useState(method);
  const [saved, flash] = useSavedFlash();
  return (
    <article className="panel stack">
      <div className="spread">
        <strong className="row">
          <Icon name={icons[m.id]} /> {l(m.label)}
        </strong>
        <div className="row">
          <SavedFlash show={saved} />
          <Switch checked={m.enabled} onChange={(v) => setM({ ...m, enabled: v })} label={t.admin.payments.enabled} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              api.savePaymentMethod(m);
              flash();
            }}
          >
            {t.common.save}
          </button>
        </div>
      </div>
      {m.id === 'card' && !methodAvailable({ id: 'card', enabled: true }, settings) && <p className="notice small">{t.admin.payments.cardOff}</p>}
      {m.id !== 'card' && !payeeReady(m.id, settings) && <p className="notice small">{t.admin.payments.payeeMissing}</p>}
      <div className="detail-grid">
        <LocalizedInput id={`pm-${m.id}-label`} label={t.admin.payments.label} value={m.label} onChange={(v) => setM({ ...m, label: v })} />
        <LocalizedInput
          id={`pm-${m.id}-instr`}
          label={t.admin.payments.instructions}
          value={m.instructions}
          onChange={(v) => setM({ ...m, instructions: v })}
          multiline
        />
      </div>
    </article>
  );
}

function BankEditor({ settings, role }: { settings: Settings; role: Role }) {
  const { t } = useI18n();
  const [bank, setBank] = useState(settings.bank);
  const [cashplus, setCashplus] = useState(settings.cashplus);
  const [saved, flash] = useSavedFlash();
  return (
    <section className="panel stack">
      <div className="spread">
        <h2 className="admin-card-title">{t.admin.payments.bankTitle}</h2>
        <div className="row">
          <SavedFlash show={saved} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              api.saveSettings({ ...settings, bank, cashplus }, role);
              flash();
            }}
          >
            {t.common.save}
          </button>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span className="label">{t.admin.payments.holder}</span>
          <input className="input" value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">{t.admin.payments.bankName}</span>
          <input className="input" value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
        </label>
        <label className="field span-all">
          <span className="label">{t.admin.payments.rib}</span>
          <input className="input num" dir="ltr" value={bank.rib} onChange={(e) => setBank({ ...bank, rib: e.target.value })} />
        </label>
        <label className="field span-all">
          <span className="label">{t.admin.payments.cashplusBeneficiary}</span>
          <input className="input" value={cashplus.beneficiary} onChange={(e) => setCashplus({ beneficiary: e.target.value })} />
        </label>
      </div>
      <p className="small muted">{t.admin.payments.payeeHelp}</p>
    </section>
  );
}
