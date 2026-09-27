/**
 * POST /api/notify — Vercel Function (Node.js runtime).
 * Delivers new orders, sample requests and B2B quotes to BOGA CAFÉ on
 * WhatsApp and Gmail. Configuration: see .env.example (server section).
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { Guard, handleNotify, type Mail } from './_lib/notify';

const guard = new Guard();

let transport: Transporter | null = null;
function sendMail(mail: Mail): Promise<void> {
  transport ??= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return transport.sendMail(mail).then(() => undefined);
}

export function POST(request: Request): Promise<Response> {
  return handleNotify(request, process.env, { sendMail, fetch, now: Date.now }, guard);
}
