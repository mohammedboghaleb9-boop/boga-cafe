/**
 * Contact helpers shared by the contact page, the footer and the home page.
 * Values come from Admin → Settings → Contact, so they must accept whatever
 * the owner pastes there (links with tracking parameters, spaces in numbers…).
 */

/** '@boga.cafe1' from an Instagram / TikTok / Facebook profile link. Empty if none. */
export function socialHandle(url: string): string {
  if (!url.trim()) return '';
  try {
    const { pathname } = new URL(url.trim());
    const first = pathname.split('/').find(Boolean) ?? '';
    const name = decodeURIComponent(first).replace(/^@/, '');
    return name ? `@${name}` : '';
  } catch {
    return '';
  }
}

/** Profile link without tracking parameters (?stkn=…, ?_r=…&_t=…). */
export function cleanProfileUrl(url: string): string {
  if (!url.trim()) return '';
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.trim();
  }
}

/**
 * Readable phone number. Moroccan mobiles are grouped the way they are
 * said aloud: '+212609036378' → '+212 6 09 03 63 78'. Anything else keeps
 * its digits with a single leading '+'.
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const ma = digits.match(/^(?:212|0)([5-7])(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (ma) return `+212 ${ma.slice(1).join(' ')}`;
  return digits ? `+${digits}` : '';
}

/** Opens a new Gmail message (web and app); mailto: depends on a mail client being set up. */
export function gmailComposeLink(email: string, subject = '', body = ''): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: email });
  if (subject) q.set('su', subject);
  if (body) q.set('body', body);
  return `https://mail.google.com/mail/?${q.toString()}`;
}
