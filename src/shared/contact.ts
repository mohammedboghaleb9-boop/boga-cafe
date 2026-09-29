/**
 * Contact helpers shared by the contact page, the footer and the home page.
 * Values come from Admin → Settings → Contact, so they must accept whatever
 * the owner pastes there (links with tracking parameters, spaces in numbers…).
 */

const FACEBOOK_HOSTS = /^(?:www\.|web\.|m\.|mbasic\.)?(?:facebook\.com|fb\.com)$/i;

/** Facebook profiles without a username are only reachable as profile.php?id=… */
function facebookId(u: URL): string | null {
  if (!FACEBOOK_HOSTS.test(u.hostname) || !/^\/profile\.php\/?$/.test(u.pathname)) return null;
  const id = u.searchParams.get('id');
  return id && /^\d+$/.test(id) ? id : null;
}

/**
 * '@boga.cafe1' from an Instagram / TikTok / Facebook profile link. Empty if none.
 * A Facebook profile that has only a number (profile.php?id=…) gets `fallbackName`.
 */
export function socialHandle(url: string, fallbackName = ''): string {
  if (!url.trim()) return '';
  try {
    const u = new URL(url.trim());
    if (facebookId(u)) return fallbackName;
    if (u.pathname.startsWith('/profile.php')) return ''; // profile.php without its id: broken link
    const first = u.pathname.split('/').find(Boolean) ?? '';
    const name = decodeURIComponent(first).replace(/^@/, '');
    return name ? `@${name}` : '';
  } catch {
    return '';
  }
}

/**
 * Profile link without tracking parameters (?stkn=…, ?_r=…&_t=…, &locale=…).
 * Facebook links open on www.facebook.com (works in the app and on every
 * device), and a numeric profile keeps its ?id=.
 */
export function cleanProfileUrl(url: string): string {
  if (!url.trim()) return '';
  try {
    const u = new URL(url.trim());
    const id = facebookId(u);
    if (id) return `https://www.facebook.com/profile.php?id=${id}`;
    if (FACEBOOK_HOSTS.test(u.hostname)) return `https://www.facebook.com${u.pathname}`;
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

/** Invisible direction marks the site puts around numbers in Arabic pages: never in a message. */
export const plainText = (text: string) => text.replace(/[\u2066-\u2069\u200e\u200f]/g, '');

/** Opens a new Gmail message (web and app); mailto: depends on a mail client being set up. */
export function gmailComposeLink(email: string, subject = '', body = ''): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: email });
  if (subject) q.set('su', plainText(subject));
  if (body) q.set('body', plainText(body));
  return `https://mail.google.com/mail/?${q.toString()}`;
}

/** The phone's own mail application (fallback when Gmail compose does not pre-fill). */
export function mailtoLink(email: string, subject = '', body = ''): string {
  const q: string[] = [];
  if (subject) q.push(`subject=${encodeURIComponent(plainText(subject))}`);
  if (body) q.push(`body=${encodeURIComponent(plainText(body))}`);
  return `mailto:${email}${q.length ? `?${q.join('&')}` : ''}`;
}
