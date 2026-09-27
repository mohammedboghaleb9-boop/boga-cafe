import { useState } from 'react';
import type { Settings, SiteContent } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { LocalizedInput, SavedFlash, useSavedFlash } from '../ui';

export function ContentPage() {
  const { t } = useI18n();
  const db = useDb();
  const [content, setContent] = useState<SiteContent>(db.content);
  const [contact, setContact] = useState<Settings['contact']>(db.settings.contact);
  const [saved, flash] = useSavedFlash();
  const setC = <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => setContent((c) => ({ ...c, [k]: v }));
  const setK = <K extends keyof Settings['contact']>(k: K, v: Settings['contact'][K]) => setContact((c) => ({ ...c, [k]: v }));

  function save() {
    api.saveContent(content);
    api.saveSettings({ ...db.settings, contact });
    flash();
  }

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.content}</h1>
        <div className="row">
          <SavedFlash show={saved} />
          <button type="button" className="btn btn-primary btn-sm" onClick={save}>
            {t.common.save}
          </button>
        </div>
      </div>
      <p className="muted">{t.admin.content.intro}</p>
      <div className="detail-grid">
        <section className="panel stack">
          <LocalizedInput id="c-ann" label={t.admin.content.announcement} value={content.announcement} onChange={(v) => setC('announcement', v)} />
          <LocalizedInput id="c-ht" label={t.admin.content.heroTitle} value={content.heroTitle} onChange={(v) => setC('heroTitle', v)} />
          <LocalizedInput id="c-hs" label={t.admin.content.heroSubtitle} value={content.heroSubtitle} onChange={(v) => setC('heroSubtitle', v)} multiline />
          <LocalizedInput id="c-at" label={t.admin.content.aboutTitle} value={content.aboutTitle} onChange={(v) => setC('aboutTitle', v)} />
          <LocalizedInput id="c-ax" label={t.admin.content.aboutText} value={content.aboutText} onChange={(v) => setC('aboutText', v)} multiline />
        </section>
        <section className="panel stack">
          <h2 className="admin-card-title">{t.admin.content.contactTitle}</h2>
          <div className="form-grid">
            <label className="field">
              <span className="label">{t.admin.content.whatsapp}</span>
              <input className="input num" dir="ltr" value={contact.whatsapp} onChange={(e) => setK('whatsapp', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">{t.admin.content.email}</span>
              <input className="input" type="email" value={contact.email} onChange={(e) => setK('email', e.target.value)} />
            </label>
            <label className="field span-all">
              <span className="label">{t.admin.content.instagram}</span>
              <input className="input" dir="ltr" value={contact.instagram} onChange={(e) => setK('instagram', e.target.value)} />
            </label>
            <label className="field span-all">
              <span className="label">{t.admin.content.tiktok}</span>
              <input className="input" dir="ltr" value={contact.tiktok} onChange={(e) => setK('tiktok', e.target.value)} />
            </label>
            <label className="field span-all">
              <span className="label">{t.admin.content.facebook}</span>
              <input className="input" dir="ltr" value={contact.facebook} onChange={(e) => setK('facebook', e.target.value)} />
            </label>
          </div>
          <LocalizedInput id="c-addr" label={t.admin.content.address} value={contact.address} onChange={(v) => setK('address', v)} />
        </section>
      </div>
    </>
  );
}
