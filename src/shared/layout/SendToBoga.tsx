import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { whatsappLink, type MessageDraft } from '@/services/notifications';
import { gmailComposeLink } from '../contact';
import { BrandIcon } from '../ui/BrandIcon';
import './channels.css';

/**
 * After an order, a sample request or a B2B quote: the full request, ready to
 * send to BOGA CAFÉ on WhatsApp or Gmail. It arrives from the customer's own
 * number or address, so the team can answer directly.
 * `delivered`: the notification function confirmed BOGA already received it;
 * the buttons then become a second, faster channel.
 */
export function SendToBoga({ draft, delivered = false }: { draft: MessageDraft; delivered?: boolean }) {
  const { t } = useI18n();
  const { settings } = useDb();
  const c = settings.contact;
  const hello = t.contact.whatsappText;
  const auto = delivered;
  return (
    <section className={`handoff ${auto ? 'handoff-auto' : ''}`} aria-label={t.handoff.title}>
      <div className="handoff-text">
        <strong>{auto ? t.handoff.titleAuto : t.handoff.title}</strong>
        <p>{auto ? t.handoff.textAuto : t.handoff.text}</p>
      </div>
      <div className="handoff-actions">
        {c.whatsapp && (
          <a className="btn handoff-btn handoff-wa" href={whatsappLink(c.whatsapp, `${hello}\n\n${draft.whatsapp}`)} target="_blank" rel="noreferrer">
            <BrandIcon brand="whatsapp" size={22} />
            {t.handoff.whatsapp}
          </a>
        )}
        {c.email && (
          <a
            className="btn handoff-btn handoff-gmail"
            href={gmailComposeLink(c.email, draft.subject, `${hello}\n\n${draft.email}`)}
            target="_blank"
            rel="noreferrer"
          >
            <BrandIcon brand="gmail" size={22} />
            {t.handoff.gmail}
          </a>
        )}
      </div>
      <details className="handoff-preview">
        <summary>{t.handoff.preview}</summary>
        <pre dir="ltr">{draft.whatsapp}</pre>
      </details>
    </section>
  );
}
