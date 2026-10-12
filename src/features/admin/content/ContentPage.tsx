import { useState } from 'react';
import { CONTENT_MAX, contactOk, contentOk, digitsOnly } from '@/core/config';
import type { Settings, SiteContent } from '@/core/types';
import { api } from '@/data/api';
import { canWrite, useAdminDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { ComingSoon, LocalizedInput, SavedFlash, WriteError, useSavedFlash } from '../ui';
import { cleanProfileUrl } from '@/shared/contact';
import { useAdminRole } from '../session';
import { refuse, useAction } from '../useAction';

export function ContentPage() {
  const { t } = useI18n();
  const db = useAdminDb();
  const writable = canWrite('content');
  const [content, setContent] = useState<SiteContent>(db.content);
  const [contact, setContact] = useState<Settings['contact']>(db.settings.contact);
  // what is saved changed (read again after a refused save): the form starts again from it
  const version = JSON.stringify([db.configVersions?.content ?? db.content, db.configVersions?.contact ?? db.settings.contact]);
  const [seen, setSeen] = useState(version);
  if (seen !== version) {
    setSeen(version);
    setContent(db.content);
    setContact(db.settings.contact);
  }
  const [saved, flash] = useSavedFlash();
  const [busy, run, failed] = useAction();
  const role = useAdminRole()!;
  const ownsContact = role === 'owner';
  // as the database keeps them: the phone number without spaces, the email trimmed
  const cleanContact = { ...contact, whatsapp: digitsOnly(contact.whatsapp), email: contact.email.trim() };
  const valid = contentOk(content) && (!ownsContact || contactOk(cleanContact));
  const setC = <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => setContent((c) => ({ ...c, [k]: v }));
  const setK = <K extends keyof Settings['contact']>(k: K, v: Settings['contact'][K]) => setContact((c) => ({ ...c, [k]: v }));

  const save = () =>
    run(async () => {
      // the contact details are the owner's: a manager's save leaves them as they are
      if (!(await api.saveContent(content, ownsContact ? cleanContact : null, role))) refuse('content'); // never the "saved" flash
      flash();
    });

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.content}</h1>
        <div className="row">
          <SavedFlash show={saved} />
          <button type="button" className="btn btn-primary btn-sm" disabled={!writable || !valid} aria-disabled={busy || undefined} onClick={save}>
            {t.common.save}
          </button>
        </div>
      </div>
      <p className="muted">{t.admin.content.intro}</p>
      <WriteError show={failed} />
      {!writable && <ComingSoon />}
      {!valid && <p className="field-error">{t.admin.content.invalid}</p>}
      <div className="detail-grid">
        <fieldset className="plain-fieldset panel stack" disabled={!writable}>
          <LocalizedInput id="c-ann" label={t.admin.content.announcement} value={content.announcement} onChange={(v) => setC('announcement', v)} maxLength={CONTENT_MAX.announcement} />
          <LocalizedInput id="c-ht" label={t.admin.content.heroTitle} value={content.heroTitle} onChange={(v) => setC('heroTitle', v)} maxLength={CONTENT_MAX.heroTitle} />
          <LocalizedInput id="c-hs" label={t.admin.content.heroSubtitle} value={content.heroSubtitle} onChange={(v) => setC('heroSubtitle', v)} multiline maxLength={CONTENT_MAX.heroSubtitle} />
          <LocalizedInput id="c-at" label={t.admin.content.aboutTitle} value={content.aboutTitle} onChange={(v) => setC('aboutTitle', v)} maxLength={CONTENT_MAX.aboutTitle} />
          <LocalizedInput id="c-ax" label={t.admin.content.aboutText} value={content.aboutText} onChange={(v) => setC('aboutText', v)} multiline maxLength={CONTENT_MAX.aboutText} />
        </fieldset>
        <section className="panel stack">
          <h2 className="admin-card-title">{t.admin.content.contactTitle}</h2>
          {!ownsContact && <p className="small muted">{t.admin.ownerOnly}</p>}
          <fieldset className="plain-fieldset stack" disabled={!ownsContact || !writable}>
            <div className="form-grid">
              <label className="field">
                <span className="label">{t.admin.content.whatsapp}</span>
                <input className="input num" dir="ltr" inputMode="tel" maxLength={24} value={contact.whatsapp} onChange={(e) => setK('whatsapp', e.target.value)} />
              </label>
              <label className="field">
                <span className="label">{t.admin.content.email}</span>
                <input className="input" type="email" maxLength={120} value={contact.email} onChange={(e) => setK('email', e.target.value)} />
              </label>
              <label className="field span-all">
                <span className="label">{t.admin.content.instagram}</span>
                <input
                  className="input"
                  dir="ltr"
                  placeholder="https://www.instagram.com/…"
                  maxLength={200}
                  value={contact.instagram}
                  onChange={(e) => setK('instagram', e.target.value)}
                  onBlur={(e) => setK('instagram', cleanProfileUrl(e.target.value))}
                />
              </label>
              <label className="field span-all">
                <span className="label">{t.admin.content.tiktok}</span>
                <input
                  className="input"
                  dir="ltr"
                  placeholder="https://www.tiktok.com/@…"
                  maxLength={200}
                  value={contact.tiktok}
                  onChange={(e) => setK('tiktok', e.target.value)}
                  onBlur={(e) => setK('tiktok', cleanProfileUrl(e.target.value))}
                />
              </label>
              <label className="field span-all">
                <span className="label">{t.admin.content.facebook}</span>
                <input
                  className="input"
                  dir="ltr"
                  placeholder="https://www.facebook.com/…"
                  maxLength={200}
                  value={contact.facebook}
                  onChange={(e) => setK('facebook', e.target.value)}
                  onBlur={(e) => setK('facebook', cleanProfileUrl(e.target.value))}
                />
              </label>
            </div>
            <LocalizedInput id="c-addr" label={t.admin.content.address} value={contact.address} onChange={(v) => setK('address', v)} maxLength={200} />
            <LocalizedInput id="c-hours" label={t.admin.content.hours} value={contact.hours ?? { ar: '', fr: '', en: '' }} onChange={(v) => setK('hours', v)} maxLength={200} />
          </fieldset>
        </section>
      </div>
    </>
  );
}
