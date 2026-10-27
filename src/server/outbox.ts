/**
 * The outbox sender: takes the due messages of notification_outbox (claim_outbox), sends each one (Gmail for the email
 * rows, CallMeBot for the WhatsApp rows) and reports the result (finish_outbox). `supabase/functions/notify-outbox`
 * only wires it to the platform; everything here is unit tested with a fake database and fake senders.
 *
 * The rows are written by the database in the same transaction as the order or request (queue_notification), with the
 * recipients of the settings (admin_config), so nothing here decides who receives what. What a row repeats of what a
 * customer typed (name, address, notes) is made unclickable first (links.ts): a forged link could carry phishing.
 * A message never proves a payment: the footer says so.
 *
 * At least once: a message is reported only after it was sent, so a sender that dies between the two sends it again
 * at its next attempt (and a failed report leaves it pending). Five attempts, one then four, nine and sixteen minutes
 * apart (claim_outbox); then it stays 'failed', visible in the Admin Panel's Notifications page with its error class.
 * Nothing it logs or stores holds a message text, a recipient or a key: error classes only.
 * Messages per run: 3 (an email can take 35 s to give up, and the schedule's call waits 30 s).
 */
import type { Client } from '@/data/supabase/client';
import { defangLinks } from './links';

export interface SenderEnv {
  /** The Gmail address that sends. */
  GMAIL_USER?: string;
  /** A 16-character Google App Password (not the account password). */
  GMAIL_APP_PASSWORD?: string;
  /** The key CallMeBot sent back after the one-time activation message. */
  CALLMEBOT_APIKEY?: string;
}

export interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface OutboxRow {
  id: number;
  channel: string;
  event: string;
  recipient: string;
  subject: string;
  body: string;
  attempts: number;
}

export interface OutboxDeps {
  db: Pick<Client, 'rpc'>;
  env: SenderEnv;
  sendMail: (mail: Mail) => Promise<void>;
  fetch: typeof fetch;
  /** Messages taken per run (the function answers within seconds: each send has a time limit). */
  limit?: number;
}

export type SendResult = { ok: true } | { ok: false; error: string };

export interface RunSummary {
  /** Channels with their secrets set; none: nothing was taken, the messages wait. */
  channels: string[];
  taken: number;
  sent: number;
  failed: number;
}

const FOOTER = 'Envoyé automatiquement par le site. Un message ne prouve jamais un paiement : vérifiez-le à la banque ou au CMI.';
/** WhatsApp (CallMeBot) takes a URL: a very long text is cut. */
const WHATSAPP_MAX = 1_500;
const PER_RUN = 3;

/** The channels this environment can send on. */
export function configuredChannels(env: SenderEnv): string[] {
  return [env.CALLMEBOT_APIKEY ? 'whatsapp' : '', env.GMAIL_USER && env.GMAIL_APP_PASSWORD ? 'email' : ''].filter(Boolean);
}

const fail = (error: string): SendResult => ({ ok: false, error });

async function sendWhatsapp(row: OutboxRow, env: SenderEnv, fetcher: typeof fetch): Promise<SendResult> {
  if (!env.CALLMEBOT_APIKEY) return fail('not_configured');
  const phone = row.recipient.replace(/[\s+]/g, '');
  if (!/^\d{8,15}$/.test(phone)) return fail('bad_recipient');
  // the body is cut, never the footer: the line saying a message proves no payment stays on a long one
  const room = WHATSAPP_MAX - FOOTER.length - 20;
  const body = defangLinks(row.body);
  const text = `🔔 BOGA CAFÉ\n${body.length > room ? `${body.slice(0, room - 1)}…` : body}\n\n${FOOTER}`;
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', phone);
  url.searchParams.set('text', text);
  url.searchParams.set('apikey', env.CALLMEBOT_APIKEY);
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(6_000) });
    const answer = await res.text();
    // CallMeBot answers 200 with an explanation page when the key or number is wrong: only its confirmation counts as
    // sent (its pages can mention the word "error" in their help text, so that word alone does not mean a failure)
    if (!res.ok || !/message (?:queued|sent)/i.test(answer) || /apikey is invalid|not (?:queued|sent)/i.test(answer)) return fail('callmebot_unconfirmed');
    return { ok: true };
  } catch (e) {
    return fail((e as Error).name === 'TimeoutError' ? 'callmebot_timeout' : 'callmebot_error');
  }
}

async function sendEmail(row: OutboxRow, env: SenderEnv, sendMail: OutboxDeps['sendMail']): Promise<SendResult> {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return fail('not_configured');
  // one address: no space, comma or semicolon (a list would reach Gmail as several recipients)
  if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(row.recipient)) return fail('bad_recipient');
  try {
    await sendMail({
      from: `"BOGA CAFÉ" <${env.GMAIL_USER}>`,
      to: row.recipient,
      subject: defangLinks(row.subject).replace(/[\r\n]+/g, ' ').slice(0, 200) || '[BOGA CAFÉ]',
      text: `${defangLinks(row.body)}\n\n— ${FOOTER}`,
    });
    return { ok: true };
  } catch {
    return fail('gmail_refused');
  }
}

/** Sends one row on its channel; the result is a class, never a text. */
export async function sendRow(row: OutboxRow, deps: Pick<OutboxDeps, 'env' | 'sendMail' | 'fetch'>): Promise<SendResult> {
  if (row.channel === 'whatsapp') return sendWhatsapp(row, deps.env, deps.fetch);
  if (row.channel === 'email') return sendEmail(row, deps.env, deps.sendMail);
  return fail('unknown_channel');
}

/** One run: takes the due messages of the channels that can be sent, sends them one after the other, reports each. */
export async function runOutbox(deps: OutboxDeps): Promise<RunSummary> {
  const channels = configuredChannels(deps.env);
  const summary: RunSummary = { channels, taken: 0, sent: 0, failed: 0 };
  // no secret, no take: a message does not use up its five attempts before the secrets are set
  if (!channels.length) return summary;
  const taken = await deps.db.rpc('claim_outbox', { p_limit: deps.limit ?? PER_RUN, p_channels: channels });
  if (taken.error) {
    console.error('outbox: take failed', taken.error.code ?? 'error');
    throw new Error('claim_failed');
  }
  const rows = (taken.data ?? []) as OutboxRow[];
  summary.taken = rows.length;
  for (const row of rows) {
    const result = await sendRow(row, deps);
    if (result.ok) summary.sent++;
    else summary.failed++;
    const reported = await deps.db.rpc('finish_outbox', { p_id: row.id, p_ok: result.ok, p_error: result.ok ? undefined : result.error });
    // the message was sent but its report failed: it stays pending and is sent again at its next attempt
    if (reported.error) console.error('outbox: report failed', reported.error.code ?? 'error');
    if (!result.ok) console.error('outbox: not sent', row.channel, result.error);
  }
  return summary;
}
