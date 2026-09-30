import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { whatsappLink, type MessageDraft } from '@/services/notifications';
import { deliveryStatus, onDeliveryChange, type DeliverableEvent } from '@/services/notifications/deliver';
import { gmailComposeLink, mailtoLink } from '../contact';
import { BrandIcon } from '../ui/BrandIcon';
import './channels.css';

/** The team reads French: the message keeps one language from greeting to signature. */
const GREETING = 'Bonjour BOGA CAFÉ,';

/**
 * After an order or a B2B quote: the full request, ready to
 * send to BOGA CAFÉ on WhatsApp or Gmail. It arrives from the customer's own
 * number or address, so the team can answer directly.
 *
 * When automatic delivery is on (api/notify), the card follows its status:
 * "sending…", then "received" only once the server confirmed it; otherwise the
 * buttons stay the way to reach BOGA.
 *
 * `reveal`: scroll the card into view and move keyboard focus to it (use it
 * when it replaces a form, so a phone user does not stay on an empty screen).
 */
export function SendToBoga({
  event,
  draft,
  refNumber,
  showSaved = true,
  reveal = false,
}: {
  /** Which message this is: its automatic delivery status is followed by kind and reference. */
  event: DeliverableEvent;
  draft: MessageDraft;
  refNumber: string;
  showSaved?: boolean;
  reveal?: boolean;
}) {
  const { t } = useI18n();
  const { settings } = useDb();
  const c = settings.contact;
  const status = useSyncExternalStore(onDeliveryChange, () => deliveryStatus(event, refNumber));
  const head = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!reveal || !head.current) return;
    const smooth = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
    head.current.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    head.current.focus({ preventScroll: true });
  }, [reveal]);

  const whatsappText = `${GREETING}\n\n${draft.whatsapp}`;
  const emailText = `${GREETING}\n\n${draft.email}`;
  const payment = event === 'payment.reported';
  const title = status === 'sent' ? t.handoff.titleAuto : status === 'pending' ? t.handoff.pending : payment ? t.handoff.titlePayment : t.handoff.title;
  const text = status === 'sent' ? t.handoff.textAuto : status === 'slow' ? t.handoff.slow : payment ? t.handoff.textPayment : t.handoff.text;

  return (
    <section className={`handoff handoff-${status}`} aria-label={t.handoff.title}>
      <p className="handoff-text" ref={head} tabIndex={-1} role="status" aria-live="polite">
        {showSaved && <span className="handoff-saved">{fmt(t.handoff.saved, { ref: refNumber })}</span>}
        <strong>{title}</strong>
        {status !== 'pending' && <span>{text}</span>}
      </p>
      <div className="handoff-actions">
        {c.whatsapp && (
          <a className="btn handoff-btn handoff-wa" href={whatsappLink(c.whatsapp, whatsappText)} target="_blank" rel="noreferrer">
            <BrandIcon brand="whatsapp" size={22} />
            {t.handoff.whatsapp}
          </a>
        )}
        {c.email && (
          <a className="btn handoff-btn handoff-gmail" href={gmailComposeLink(c.email, draft.subject, emailText)} target="_blank" rel="noreferrer">
            <BrandIcon brand="gmail" size={22} />
            {t.handoff.gmail}
          </a>
        )}
      </div>
      {c.email && (
        <a className="handoff-other small" href={mailtoLink(c.email, draft.subject, emailText)}>
          {t.handoff.otherMail}
        </a>
      )}
      <details className="handoff-preview">
        <summary>{t.handoff.preview}</summary>
        <pre dir="ltr">{whatsappText}</pre>
      </details>
    </section>
  );
}
