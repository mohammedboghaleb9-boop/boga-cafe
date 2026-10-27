/**
 * POST /functions/v1/notify-outbox: sends the messages queued in notification_outbox (Gmail and WhatsApp).
 * The logic lives in src/server (outbox.ts, outboxHttp.ts; unit tested); this file only wires it to the platform.
 * `npm run build:functions` bundles it with src/ into dist/index.js, which is what gets deployed.
 *
 * Called once a minute by the database (pg_cron + pg_net, supabase/manual/*_outbox_cron.sql), with the shared key in
 * the `x-outbox-key` header: the platform's JWT check is off (supabase/config.toml).
 *
 * Secrets (Dashboard → Edge Functions → Secrets; never in the repository, the browser or a VITE_ variable):
 *   OUTBOX_KEY          required: the shared key (a long random text); without it every call is refused (503).
 *   GMAIL_USER          the Gmail address that sends (bogacafe1@gmail.com).
 *   GMAIL_APP_PASSWORD  the 16-character App Password of that account (not its password).
 *   CALLMEBOT_APIKEY    the key CallMeBot sent back after the one-time activation message.
 * A channel without its secrets is left alone: its messages wait, they do not use up their attempts.
 * Who receives what comes from the rows (the settings' recipients), not from here.
 */
import { createClient } from '@supabase/supabase-js';
import { createTransport } from 'nodemailer';
import type { Database } from '@/data/supabase/database.types';
import { keysOf } from '@/server/http';
import { handleOutbox } from '@/server/outboxHttp';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const env = (name: string) => Deno.env.get(name) ?? '';

const secretKey = keysOf(env('SUPABASE_SECRET_KEYS'))[0] || env('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient<Database>(env('SUPABASE_URL'), secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const senderEnv = { GMAIL_USER: env('GMAIL_USER'), GMAIL_APP_PASSWORD: env('GMAIL_APP_PASSWORD'), CALLMEBOT_APIKEY: env('CALLMEBOT_APIKEY') };

// SMTP over TLS on port 465: the platform blocks outbound ports 25 and 587
const transporter =
  senderEnv.GMAIL_USER && senderEnv.GMAIL_APP_PASSWORD
    ? createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: senderEnv.GMAIL_USER, pass: senderEnv.GMAIL_APP_PASSWORD },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      })
    : null;

Deno.serve((req) =>
  handleOutbox(req, {
    key: env('OUTBOX_KEY'),
    db,
    env: senderEnv,
    fetch,
    sendMail: async (mail) => {
      if (!transporter) throw new Error('not_configured');
      await transporter.sendMail(mail);
    },
  }),
);
