import { useDb } from '@/data/hooks';
import { whatsappLink } from '@/services/notifications';
import { useI18n } from '@/i18n';
import { Icon, type IconName } from '../ui/Icon';

/** Instagram, TikTok, Facebook, WhatsApp and Gmail, from the Admin settings. */
export function SocialLinks({ withLabels = false }: { withLabels?: boolean }) {
  const { settings } = useDb();
  const { t } = useI18n();
  const c = settings.contact;
  const items: { icon: IconName; label: string; href: string }[] = [
    { icon: 'instagram', label: 'Instagram', href: c.instagram },
    { icon: 'tiktok', label: 'TikTok', href: c.tiktok },
    { icon: 'facebook', label: 'Facebook', href: c.facebook },
    { icon: 'whatsapp', label: 'WhatsApp', href: whatsappLink(c.whatsapp, t.contact.whatsappText) },
    { icon: 'mail', label: c.email, href: `mailto:${c.email}` },
  ];
  return (
    <div className={withLabels ? 'social social-labels' : 'social'}>
      {items.map((i) => (
        <a key={i.icon} href={i.href} target="_blank" rel="noreferrer" aria-label={i.label} title={i.label}>
          <Icon name={i.icon} />
          {withLabels && <span>{i.label}</span>}
        </a>
      ))}
    </div>
  );
}
