/**
 * POST /api/notify — Vercel Function (Node.js runtime).
 * Delivers new orders, payment reports, sample requests and B2B quotes to
 * BOGA CAFÉ on WhatsApp and Gmail. Configuration: docs/09-notifications.md and .env.example.
 */
import { createTransport, type Transporter } from 'nodemailer';
import { Guard, handleNotify, handlePreflight, type Mail } from './_lib/notify.js';

const guard = new Guard();

let transport: Transporter | null = null;
function sendMail(mail: Mail): Promise<void> {
  transport ??= createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    // fail fast: the customer's page waits for the answer
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 7_000,
  });
  return transport.sendMail(mail).then(() => undefined);
}

export function POST(request: Request): Promise<Response> {
  return handleNotify(request, process.env, { sendMail, fetch, now: Date.now }, guard);
}

export function OPTIONS(request: Request): Response {
  return handlePreflight(request, process.env);
}
