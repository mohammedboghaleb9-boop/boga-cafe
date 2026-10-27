import { Link } from 'react-router';
import { cleanPayee, methodOk, payeeProblem, PHONE, RIB, sameRib, type Payee } from '@/core/config';
import type { PaymentMethodConfig, PaymentMethodId, Settings } from '@/core/types';
import { api } from '@/data/api';
import { useAdminDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { CutNotice, LocalizedInput, PaymentPill, SavedFlash, Switch, TableWrap, WriteError, useSavedFlash } from '../ui';
import type { Role } from '../permissions';
import { payeeReady } from '@/core/orderFlow';
import { methodAvailable } from '@/services/payments';
import { useAdminRole } from '../session';
import { refuse, useAction } from '../useAction';
import { useSavedDraft } from '../useSavedDraft';

const icons: Record<PaymentMethodId, IconName> = { card: 'card', cashplus: 'cash', bank_transfer: 'bank' };

export function PaymentsPage() {
  const role = useAdminRole()!;
  const { t, money, l } = useI18n();
  const { paymentMethods, orders, ordersCut, settings } = useAdminDb();
  const [busy, run, failed] = useAction();
  const toVerify = orders.filter(
    (o) => o.status !== 'cancelled' && (o.paymentStatus === 'awaiting_verification' || (o.paymentStatus === 'pending' && o.paymentMethod !== 'card')),
  );

  return (
    <>
      <CutNotice show={ordersCut} count={orders.length} />
      <div className="admin-head">
        <h1>{t.admin.nav.payments}</h1>
      </div>
      <p className="muted">{t.admin.payments.intro}</p>

      <section className="stack">
        <h2 className="admin-card-title">{t.admin.payments.toVerify}</h2>
        <WriteError show={failed} />
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
                    <td className="small">{l(paymentMethods.find((m) => m.id === o.paymentMethod)?.label ?? { ar: o.paymentMethod, fr: o.paymentMethod, en: o.paymentMethod })}</td>
                    <td className="small num">{o.paymentRef ?? '—'}</td>
                    <td className="num end">
                      <strong>{money(o.total)}</strong>
                    </td>
                    <td>
                      <PaymentPill status={o.paymentStatus} />
                    </td>
                    <td className="end">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        aria-disabled={busy || undefined}
                        onClick={() =>
                          run(async () => {
                            if (!(await api.setPaymentStatus(o.id, 'paid', role))) refuse('payment');
                          })
                        }
                      >
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

      <PayeeEditor settings={settings} role={role} />
    </>
  );
}

function MethodEditor({ method, settings }: { method: PaymentMethodConfig; settings: Settings }) {
  const { t, l } = useI18n();
  const role = useAdminRole()!;
  const [m, setM] = useSavedDraft(method, method.updatedAt ?? JSON.stringify(method));
  const [saved, flash] = useSavedFlash();
  const [busy, run, failed] = useAction();
  // the card is offered only once a card payment can be taken (the prototype's simulated gateway)
  const cardGateway = methodAvailable({ id: 'card', enabled: true }, settings);
  const valid = methodOk(m, cardGateway);
  return (
    <fieldset className="plain-fieldset panel stack">
      <div className="spread">
        <strong className="row">
          <Icon name={icons[m.id]} /> {l(m.label)}
        </strong>
        <div className="row">
          <SavedFlash show={saved} />
          {/* the card stays off until its gateway exists: it can be switched off, never on */}
          <Switch checked={m.enabled} disabled={m.id === 'card' && !method.enabled && !cardGateway} onChange={(v) => setM({ ...m, enabled: v })} label={t.admin.payments.enabled} name={l(method.label)} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!valid}
            aria-disabled={busy || undefined}
            aria-label={`${t.common.save} · ${l(method.label)}`}
            onClick={() =>
              run(async () => {
                if (!(await api.savePaymentMethod(m, role))) refuse('payment method'); // never the "saved" flash
                flash();
              })
            }
          >
            {t.common.save}
          </button>
        </div>
      </div>
      <WriteError show={failed} />
      {m.id === 'card' && !methodAvailable({ id: 'card', enabled: true }, settings) && <p className="notice small">{t.admin.payments.cardOff}</p>}
      {m.id !== 'card' && !payeeReady(m.id, settings) && <p className="notice small">{t.admin.payments.payeeMissing}</p>}
      {!valid && <p className="field-error">{t.admin.payments.methodInvalid}</p>}
      <div className="detail-grid">
        <LocalizedInput id={`pm-${m.id}-label`} label={t.admin.payments.label} value={m.label} onChange={(v) => setM({ ...m, label: v })} maxLength={40} />
        <LocalizedInput
          id={`pm-${m.id}-instr`}
          label={t.admin.payments.instructions}
          value={m.instructions}
          onChange={(v) => setM({ ...m, instructions: v })}
          multiline
          maxLength={600}
        />
      </div>
    </fieldset>
  );
}

function PayeeEditor({ settings, role }: { settings: Settings; role: Role }) {
  const { t, date } = useI18n();
  const { configVersions, payeeChange } = useAdminDb();
  const current: Payee = { bank: settings.bank, cashplus: settings.cashplus };
  // `ribAgain` is only a typing check, never sent: it starts empty again with every new copy of the payee
  const [draft, setDraft] = useSavedDraft({ ...current, ribAgain: '' }, configVersions?.payee ?? JSON.stringify(current));
  const { bank, cashplus, ribAgain } = draft;
  const setBank = (next: Payee['bank']) => setDraft((d) => ({ ...d, bank: next }));
  const setCashplus = (update: (c: Payee['cashplus']) => Payee['cashplus']) => setDraft((d) => ({ ...d, cashplus: update(d.cashplus) }));
  const payee = cleanPayee(draft);
  const problem = payeeProblem(payee);
  // a new RIB must be typed twice: a wrong digit would send customers' money to someone else
  const ribToConfirm = payee.bank.rib !== '' && !sameRib(payee.bank.rib, current.bank.rib);
  const ribUnconfirmed = ribToConfirm && !sameRib(payee.bank.rib, ribAgain);
  const [saved, flash] = useSavedFlash();
  const [busy, run, failed] = useAction();
  const setC = (k: keyof Payee['cashplus'], v: string) => setCashplus((c) => ({ ...c, [k]: v }));
  return (
    <fieldset className="plain-fieldset panel stack">
      <WriteError show={failed} />
      <div className="spread">
        <h2 className="admin-card-title">{t.admin.payments.bankTitle}</h2>
        <div className="row">
          <SavedFlash show={saved} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={problem !== null || ribUnconfirmed}
            aria-disabled={busy || undefined}
            aria-label={`${t.common.save} · ${t.admin.payments.bankTitle}`}
            onClick={() =>
              run(async () => {
                if (!(await api.savePayee(payee, role))) refuse('payee'); // never the "saved" flash
                flash();
              })
            }
          >
            {t.common.save}
          </button>
        </div>
      </div>
      {payeeChange && (
        <p className="small muted">
          {payeeChange === 'unknown' ? t.admin.payments.lastChangeUnknown : fmt(t.admin.payments.lastChange, { when: date(payeeChange.at, true), who: payeeChange.by })}
        </p>
      )}
      <div className="form-grid">
        <label className="field">
          <span className="label">{t.admin.payments.holder}</span>
          <input className="input" maxLength={80} value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">{t.admin.payments.bankName}</span>
          <input className="input" maxLength={80} value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
        </label>
        <label className="field span-all">
          <span className="label">{t.admin.payments.rib}</span>
          {/* a changed RIB is typed again: the second one never outlives the first */}
          <input className="input num" dir="ltr" inputMode="numeric" maxLength={40} value={bank.rib} onChange={(e) => setDraft((d) => ({ ...d, bank: { ...d.bank, rib: e.target.value }, ribAgain: '' }))} />
          {payee.bank.rib !== '' && !RIB.test(payee.bank.rib) && <span className="field-error">{t.admin.payments.ribInvalid}</span>}
        </label>
        {ribToConfirm && (
          <label className="field span-all">
            <span className="label">{t.admin.payments.ribConfirm}</span>
            <input
              className="input num"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              maxLength={40}
              value={ribAgain}
              onChange={(e) => setDraft((d) => ({ ...d, ribAgain: e.target.value }))}
            />
            {ribAgain !== '' && ribUnconfirmed && <span className="field-error">{t.admin.payments.ribMismatch}</span>}
          </label>
        )}
        <label className="field">
          <span className="label">{t.admin.payments.cashplusBeneficiary}</span>
          <input className="input" maxLength={80} value={cashplus.beneficiary} onChange={(e) => setC('beneficiary', e.target.value)} />
        </label>
        <label className="field">
          <span className="label">{t.admin.payments.cashplusCity}</span>
          <input className="input" maxLength={60} value={cashplus.city} onChange={(e) => setC('city', e.target.value)} />
        </label>
        <label className="field">
          <span className="label">{t.admin.payments.cashplusPhone}</span>
          <input className="input num" dir="ltr" inputMode="tel" maxLength={24} value={cashplus.phone} onChange={(e) => setC('phone', e.target.value)} />
          {payee.cashplus.phone !== '' && !PHONE.test(payee.cashplus.phone) && <span className="field-error">{t.admin.payments.phoneInvalid}</span>}
        </label>
      </div>
      {problem === 'incomplete' && <p className="field-error">{t.admin.payments.payeeIncomplete}</p>}
      <p className="small muted">{t.admin.payments.payeeHelp}</p>
    </fieldset>
  );
}
