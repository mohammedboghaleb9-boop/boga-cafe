import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { BrandIcon, brandName } from '../ui/BrandIcon';
import { contactChannels } from './channels';
import './channels.css';

/** Official marks of every channel set in Admin → Settings → Contact. */
export function SocialLinks({ size = 38 }: { size?: number }) {
  const { settings } = useDb();
  const { t } = useI18n();
  const channels = contactChannels(settings.contact, {
    whatsapp: t.contact.whatsappText,
    emailSubject: t.contact.emailSubject,
  });
  return (
    <div className="social-tiles">
      {channels.map((c) => (
        <a
          key={c.brand}
          href={c.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${brandName[c.brand]} ${c.handle}`}
          title={`${brandName[c.brand]} · ${c.handle}`}
        >
          <BrandIcon brand={c.brand} size={size} />
        </a>
      ))}
    </div>
  );
}
