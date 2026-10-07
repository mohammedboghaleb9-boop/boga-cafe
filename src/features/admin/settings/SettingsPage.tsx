import { formatSize } from '@/core/format';
import { useState } from 'react';
import { PACK_SIZES, type Settings } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { DEMO_DATA } from '@/data/mode';
import { useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { PERMISSIONS, ROLES, SECTIONS } from '../permissions';
import { ConfirmButton, SavedFlash, Switch, TableWrap, useSavedFlash } from '../ui';
import { useAdminRole } from '../session';
import { useAction } from '../useAction';

export function SettingsPage() {
  const role = useAdminRole()!;
  const { t } = useI18n();
  const db = useDb();
  const [s, setS] = useState<Settings>(db.settings);
  const [saved, flash] = useSavedFlash();
  const [busy, run] = useAction();
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
            aria-disabled={busy || undefined}
            onClick={() =>
              run(async () => {
                await api.saveSettings({ ...db.settings, ...s, bank: db.settings.bank, cashplus: db.settings.cashplus, contact: db.settings.contact, notifications: db.settings.notifications }, role);
                flash();
              })
            }
          >
            {t.common.save}
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel stack">
          <h2 className="admin-card-title">{t.admin.settings.rules}</h2>
          <label className="field">
            <span className="label">{t.admin.settings.b2bThreshold}</span>
            <input className="input num" type="number" min={1} value={s.b2bThresholdKg} onChange={(e) => setS({ ...s, b2bThresholdKg: num(e.target.value) })} />
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
                  value={cb.feeBySize[size]}
                  onChange={(e) =>
                    setS({ ...s, customBlend: { ...cb, feeBySize: { ...cb.feeBySize, [size]: num(e.target.value) } } })
                  }
                />
              </label>
            ))}
          </div>
        </section>
      </div>

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
