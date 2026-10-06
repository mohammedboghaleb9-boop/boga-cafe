import { useState } from 'react';
import type { NotificationChannel } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '@/shared/ui/Icon';
import { SavedFlash, Switch, Tabs, useSavedFlash } from '../ui';
import { useAdminRole } from '../session';
import { useAction } from '../useAction';

export function NotificationsPage() {
  const { t, date } = useI18n();
  const { notifications, settings } = useDb();
  const [n, setN] = useState(settings.notifications);
  const [saved, flash] = useSavedFlash();
  const [busy, run] = useAction();
  const role = useAdminRole()!;
  const owner = role === 'owner';
  const [channel, setChannel] = useState<'all' | NotificationChannel>('all');
  const list = notifications.filter((x) => channel === 'all' || x.channel === channel);

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.notifications}</h1>
      </div>
      <p className="muted">{t.admin.notif.intro}</p>

      <section className="panel stack">
        {!owner && <p className="small muted">{t.admin.ownerOnly}</p>}
        <fieldset className="plain-fieldset stack" disabled={!owner}>
          <div className="form-grid">
            <label className="field">
              <span className="label">{t.admin.notif.adminWhatsapp}</span>
              <input className="input num" dir="ltr" value={n.adminWhatsapp} onChange={(e) => setN({ ...n, adminWhatsapp: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">{t.admin.notif.adminEmail}</span>
              <input className="input" type="email" value={n.adminEmail} onChange={(e) => setN({ ...n, adminEmail: e.target.value })} />
            </label>
          </div>
          <div className="spread">
            <div className="row">
              <Switch checked={n.whatsappEnabled} onChange={(v) => setN({ ...n, whatsappEnabled: v })} label={t.admin.notif.whatsappOn} />
              <Switch checked={n.emailEnabled} onChange={(v) => setN({ ...n, emailEnabled: v })} label={t.admin.notif.emailOn} />
            </div>
            {owner && (
              <div className="row">
                <SavedFlash show={saved} />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-disabled={busy || undefined}
                  onClick={() =>
                    run(async () => {
                      await api.saveSettings({ ...settings, notifications: n }, role);
                      flash();
                    })
                  }
                >
                  {t.common.save}
                </button>
              </div>
            )}
          </div>
        </fieldset>
      </section>

      <section className="stack">
        <h2 className="admin-card-title">{t.admin.notif.log}</h2>
        <Tabs
          value={channel}
          onChange={setChannel}
          items={[
            { id: 'all', label: t.common.all, count: notifications.length },
            { id: 'whatsapp', label: 'WhatsApp', count: notifications.filter((x) => x.channel === 'whatsapp').length },
            { id: 'email', label: 'Email', count: notifications.filter((x) => x.channel === 'email').length },
          ]}
        />
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          {list.slice(0, 60).map((log) => (
            <details key={log.id} className="log-item">
              <summary>
                <span className="channel-icon" data-channel={log.channel}>
                  <Icon name={log.channel === 'whatsapp' ? 'whatsapp' : 'mail'} size={16} />
                </span>
                <span className="stack" style={{ ['--gap' as string]: '0px', minWidth: 0 }}>
                  <strong className="small">{log.subject}</strong>
                  <span className="small muted">
                    {t.admin.notif.events[log.event]} · <span dir="ltr">{log.to}</span>
                  </span>
                </span>
                <span className="stack small muted" style={{ ['--gap' as string]: '2px', alignItems: 'flex-end' }}>
                  <span className="num">{date(log.at, true)}</span>
                  <span className="pill">{t.admin.notif.simulated}</span>
                </span>
              </summary>
              <pre>{log.body}</pre>
              {log.channel === 'whatsapp' && (
                <div className="log-body-actions">
                  <a className="btn btn-ghost btn-sm" href={whatsappLink(log.to, log.body)} target="_blank" rel="noreferrer">
                    <Icon name="whatsapp" size={16} /> {t.common.openWhatsapp}
                  </a>
                </div>
              )}
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
