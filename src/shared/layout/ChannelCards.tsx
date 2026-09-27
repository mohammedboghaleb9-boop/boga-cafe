import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { BrandIcon, brandName, type Brand } from '../ui/BrandIcon';
import { Icon } from '../ui/Icon';
import { CopyButton } from '../ui/bits';
import { contactChannels } from './channels';
import './channels.css';

/**
 * The real contact frames: official platform mark, our handle, what the
 * channel is for, and a direct action. `compact` is a one-line link.
 */
export function ChannelCards({ variant = 'full', only }: { variant?: 'full' | 'compact'; only?: Brand[] }) {
  const { t } = useI18n();
  const { settings } = useDb();
  const channels = contactChannels(settings.contact, {
    whatsapp: t.contact.whatsappText,
    emailSubject: t.contact.emailSubject,
  }).filter((c) => !only || only.includes(c.brand));

  const desc: Record<Brand, string> = {
    whatsapp: t.contact.whatsappDesc,
    instagram: t.contact.instagramDesc,
    tiktok: t.contact.tiktokDesc,
    facebook: t.contact.facebookDesc,
    gmail: t.contact.gmailDesc,
  };
  const cta = (b: Brand) => (b === 'whatsapp' ? t.contact.whatsappCta : b === 'gmail' ? t.contact.gmailCta : t.contact.followCta);

  if (variant === 'compact') {
    return (
      <div className="channel-pills">
        {channels.map((c) => (
          <a
            key={c.brand}
            className={`channel-pill channel--${c.brand}`}
            href={c.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`${brandName[c.brand]} ${c.handle}`}
          >
            <BrandIcon brand={c.brand} size={40} />
            <span className="channel-pill-text">
              <strong>{brandName[c.brand]}</strong>
              <span className="handle" dir="ltr">
                {c.handle}
              </span>
            </span>
            <Icon name="external" size={16} className="channel-pill-go" />
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="channels">
      {channels.map((c) => (
        <article key={c.brand} className={`channel channel--${c.brand}`}>
          <div className="channel-top">
            <BrandIcon brand={c.brand} size={52} />
            <div className="channel-id">
              <h3>{brandName[c.brand]}</h3>
              <p className="channel-handle handle" dir="ltr">
                {c.handle}
              </p>
            </div>
          </div>
          <p className="channel-desc">{desc[c.brand]}</p>
          <div className="channel-actions">
            <a className="btn channel-cta" href={c.href} target="_blank" rel="noreferrer">
              {cta(c.brand)}
              <Icon name="external" size={15} />
            </a>
            <CopyButton text={c.copy} />
          </div>
        </article>
      ))}
    </div>
  );
}
