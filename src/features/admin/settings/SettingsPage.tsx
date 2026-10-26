import { formatSize } from '@/core/format';
import { rulesOk, type BusinessRules } from '@/core/config';
import { PACK_SIZES, type Settings } from '@/core/types';
import { api } from '@/data/api';
import { useAdminDb } from '@/data/hooks';
import { DEMO_DATA } from '@/data/mode';
import { useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { PERMISSIONS, ROLES, SECTIONS } from '../permissions';
import { ConfirmButton, SavedFlash, Switch, TableWrap, WriteError, useSavedFlash } from '../ui';
import { useAdminRole } from '../session';
import { refuse, useAction } from '../useAction';
import { useSavedDraft } from '../useSavedDraft';

/**
 * Orders and B2B requests are taken only while the sales are open: the owner opens them once the
 * catalog, the prices and the messages are ready (the database refuses every sale until then).
 * Opening asks for a second click; closing does not.
 */
function SalesGate({ open, writable }: { open: boolean; writable: boolean }) {
  const role = useAdminRole()!;
  const { t } = useI18n();
  const [saved, flash] = useSavedFlash();
  const [busy, run, failed] = useAction();
  const set = (next: boolean) =>
    run(async () => {
      if (!(await api.setSalesOpen(next, role))) refuse('sales');
      flash();
    });
  return (
    <section className="panel stack sales-gate">
      <div className="spread">
        <h2 className="admin-card-title">{t.admin.settings.salesTitle}</h2>
        <SavedFlash show={saved} />
      </div>
      <p className={`notice ${open ? 'notice-ok' : 'notice-warn'}`} role="status">
        {open ? t.admin.settings.salesOpenNow : t.admin.settings.salesClosedNow}
      </p>
      <p className="small muted">{t.admin.settings.salesHelp}</p>
      <WriteError show={failed} />
      <div>
        {open ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={!writable} aria-disabled={busy || undefined} onClick={() => set(false)}>
            {t.admin.settings.closeSales}
          </button>
        ) : (
          <ConfirmButton
            className="btn btn-primary btn-sm"
            label={t.admin.settings.openSales}
            confirmLabel={t.admin.settings.openSalesConfirm}
            busy={busy}
            disabled={!writable}
            onConfirm={() => set(true)}
          />
        )}
      </div>
    </section>
  );
}

const rulesOf = ({ b2bThresholdKg, roastLossPercent, unpaidOrderTimeoutHours, paymentCheckTimeoutHours, customBlend }: Settings): BusinessRules => ({
  b2bThresholdKg,
  roastLossPercent,
  unpaidOrderTimeoutHours,
  paymentCheckTimeoutHours,
  customBlend,
});

export function SettingsPage() {
  const role = useAdminRole()!;
  const { t } = useI18n();
  const db = useAdminDb();
  const current = rulesOf(db.settings);
  const [s, setS] = useSavedDraft<BusinessRules>(current, db.configVersions?.rules ?? JSON.stringify(current));
  const valid = rulesOk(s);
  const [saved, flash] = useSavedFlash();
  const [busy, run, failed] = useAction();
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const cb = s.customBlend;

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.settings}</h1>
        <div className="row">
          <SavedFlash show={saved} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!valid}
            aria-disabled={busy || undefined}
            onClick={() =>
              run(async () => {
                if (!(await api.saveRules(s, role))) refuse('rules'); // never the "saved" flash
                flash();
              })
            }
          >
            {t.common.save}
          </button>
        </div>
      </div>
      <SalesGate open={db.settings.salesOpen} writable={role === 'owner'} />
      <WriteError show={failed} />
      {!valid && <p className="field-error">{t.admin.settings.outOfRange}</p>}
      <fieldset className="plain-fieldset detail-grid">
        <section className="panel stack">
          <h2 className="admin-card-title">{t.admin.settings.rules}</h2>
          <label className="field">
            <span className="label">{t.admin.settings.b2bThreshold}</span>
            <input className="input num" type="number" min={1} max={1000} value={s.b2bThresholdKg} onChange={(e) => setS({ ...s, b2bThresholdKg: num(e.target.value) })} />
          </label>
          <label className="field">
            <span className="label">{t.admin.settings.roastLoss}</span>
            <input
              className="input num"
              type="number"
              min={0}
              max={30}
              value={s.roastLossPercent}
              onChange={(e) => setS({ ...s, roastLossPercent: Math.min(30, num(e.target.value)) })}
            />
          </label>
          <label className="field">
            <span className="label">{t.admin.settings.unpaidTimeout}</span>
            <input
              className="input num"
              type="number"
              min={1}
              max={720}
              value={s.unpaidOrderTimeoutHours}
              onChange={(e) => setS({ ...s, unpaidOrderTimeoutHours: Math.max(1, num(e.target.value)) })}
            />
          </label>
          <label className="field">
            <span className="label">{t.admin.settings.paymentCheckTimeout}</span>
            <input
              className="input num"
              type="number"
              min={1}
              max={720}
              value={s.paymentCheckTimeoutHours}
              onChange={(e) => setS({ ...s, paymentCheckTimeoutHours: Math.max(1, num(e.target.value)) })}
            />
          </label>
        </section>

        <section className="panel stack">
          <h2 className="admin-card-title">{t.admin.settings.blendTitle}</h2>
          <Switch
            checked={cb.enabled}
            onChange={(v) => setS({ ...s, customBlend: { ...cb, enabled: v } })}
            label={t.admin.settings.blendEnabled}
          />
          <div className="form-grid">
            <label className="field">
              <span className="label">{t.admin.settings.minPercent}</span>
              <input
                className="input num"
                type="number"
                min={1}
                max={50}
                value={cb.minPercent}
                onChange={(e) => setS({ ...s, customBlend: { ...cb, minPercent: Math.max(1, num(e.target.value)) } })}
              />
            </label>
            <label className="field">
              <span className="label">{t.admin.settings.maxOrigins}</span>
              <input
                className="input num"
                type="number"
                min={1}
                max={8}
                value={cb.maxOrigins}
                onChange={(e) => setS({ ...s, customBlend: { ...cb, maxOrigins: Math.max(1, num(e.target.value)) } })}
              />
            </label>
          </div>
          <span className="label">{t.admin.settings.feeBySize}</span>
          <div className="form-grid">
            {PACK_SIZES.map((size) => (
              <label key={size} className="field">
                <span className="label">{formatSize(size)}</span>
                <input
                  className="input num"
                  type="number"
                  min={0}
                  max={1000}
                  value={cb.feeBySize[size]}
                  onChange={(e) =>
                    setS({ ...s, customBlend: { ...cb, feeBySize: { ...cb.feeBySize, [size]: num(e.target.value) } } })
                  }
                />
              </label>
            ))}
          </div>
        </section>
      </fieldset>

      <section className="stack">
        <h2 className="admin-card-title">{t.admin.settings.permissions}</h2>
        <TableWrap label={t.admin.settings.permissions}>
          <table className="table perm-table">
            <thead>
              <tr>
                <th>{t.admin.settings.section}</th>
                {ROLES.map((r) => (
                  <th key={r}>{t.admin.roles[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((sec) => (
                <tr key={sec}>
                  <td>{t.admin.nav[sec]}</td>
                  {ROLES.map((r) => (
                    <td key={r}>{PERMISSIONS[r].includes(sec) ? <Icon name="check" size={16} /> : <span className="muted">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>

      {DEMO_DATA && (
        <div>
          <ConfirmButton label={t.admin.resetDemo} confirmLabel={t.admin.resetConfirm} onConfirm={() => void api.resetDemo()} />
        </div>
      )}
    </>
  );
}
