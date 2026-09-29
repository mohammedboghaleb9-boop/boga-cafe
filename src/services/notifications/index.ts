/**
 * Notification service.
 *
 * Prototype: messages are written to the notification log (status "simulated")
 *            and the admin can open them in WhatsApp with one click.
 * Live site: `deliver()` posts the message to api/notify.ts (Vercel function),
 *            which sends it by Gmail (SMTP) and WhatsApp (CallMeBot).
 * Planned:   the server writes the messages itself from the order (Supabase
 *            outbox), and WhatsApp moves to the Cloud API. See docs/09 and docs/10.
 */
import type { NotificationEvent, NotificationLog, Settings } from '@/core/types';
import type { MessageDraft } from './templates';

export * from './templates';

export function draftsToLogs(
  event: NotificationEvent,
  draft: MessageDraft,
  settings: Settings,
  now: string,
  newId: () => string,
): NotificationLog[] {
  const logs: NotificationLog[] = [];
  const n = settings.notifications;
  if (n.whatsappEnabled) {
    logs.push({ id: newId(), at: now, channel: 'whatsapp', event, to: n.adminWhatsapp, subject: draft.subject, body: draft.whatsapp, status: 'simulated' });
  }
  if (n.emailEnabled) {
    logs.push({ id: newId(), at: now, channel: 'email', event, to: n.adminEmail, subject: draft.subject, body: draft.email, status: 'simulated' });
  }
  return logs;
}

/** wa.me link with a pre-filled message (customer → BOGA or admin → customer). */
export function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '');
  // no invisible direction marks in the message (they show as boxes on some phones)
  const clean = text.replace(/[\u2066-\u2069\u200e\u200f]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(clean)}`;
}
