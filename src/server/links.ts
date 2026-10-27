/**
 * Links have no place in the messages sent to the team: a forged one could carry phishing (a customer types the
 * name, the notes and the address of an order, and the message repeats them). Moved here from api/_lib/notify.ts
 * (the Vercel function that was never deployed), which imports it from here, so one copy is tested and used by the
 * outbox sender (src/server/outbox.ts).
 */

// Email addresses stay as they are: the team answers to them. Not when they are
// part of a link (https://user:pw@evil.com, a@evil.com/pay, x@evil.com:8443).
const EMAIL = /(?<![\p{L}\p{N}._%+\-:/])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?!\.?[\p{L}\p{N}\-/:?#])/gu;
// A dot (or a full-width one) between a name and what could be a domain ending
// (2+ characters starting with a letter: com, ma, icu, рф, xn--p1ai…). Numbers
// such as 0.25 kg or 12.50 DH are followed by a digit and stay untouched.
const DOMAIN_DOT = /(?<=[^\s[])[.。．｡․﹒](?=\p{L}[\p{L}\p{N}-])/gu;
const IP = /(?<!\d)\d{1,3}(?:\.\d{1,3}){3}(?!\d)/g;

/**
 * Links have no place in these messages: a forged one could carry phishing.
 * Whatever could be read as a link is made unclickable rather than removed
 * (hxxps://evil[.]com/pay, pay_now[.]evil[.]icu, 45[.]33[.]12[.]9), so the
 * team still sees what was written. No list of domain endings: new ones
 * appear all the time.
 */
export function defangLinks(text: string): string {
  const emails: string[] = [];
  // NUL marks where an email was set aside; any NUL the customer typed is dropped first
  // oxlint-disable-next-line no-control-regex -- the NUL placeholder is on purpose
  const held = text.replace(/\u0000/g, '').replace(EMAIL, (email) => `\u0000${emails.push(email) - 1}\u0000`);
  const safe = held
    .replace(/\bhttp(s?):\/\//gi, 'hxxp$1://')
    .replace(IP, (ip) => ip.replace(/\./g, '[.]'))
    .replace(DOMAIN_DOT, '[.]');
  // oxlint-disable-next-line no-control-regex -- the NUL placeholder is on purpose
  return safe.replace(/\u0000(\d+)\u0000/g, (_, i: string) => emails[Number(i)]);
}
