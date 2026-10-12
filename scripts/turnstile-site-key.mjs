// What the build accepts as VITE_TURNSTILE_SITE_KEY (vite.config.ts): a PUBLIC key, shipped to every visitor.
// A format check only, written from Cloudflare's documented keys (developers.cloudflare.com/turnstile/troubleshooting/testing):
// a site key is 24 characters there and a secret key 35, and a real secret key pasted here would hand the
// anti-robot check to anyone who reads the page. It cannot know a real secret from a real site key by their
// letters, so it rejects what is too long to be a site key, as well as Cloudflare's test secrets, spaces and quotes.
// The only real protection is copying the key from the "Site Key" field of the widget.

/** The longest a site key can be: the documented ones are 24 characters, a secret key is 35. */
export const MAX_SITE_KEY_LENGTH = 32;

/** Why this value must not be shipped as a site key, or null when it may. */
export function siteKeyProblem(key) {
  if (key !== key.trim() || /\s/.test(key)) return 'has a space in it: copy the key alone, from the "Site Key" field of the widget.';
  if (!/^[0-9A-Za-z_-]+$/.test(key)) return 'has a character that is not in a key (a quote, a slash…): copy the key alone.';
  if (/^[123]x0+AA$/.test(key) && key.length > MAX_SITE_KEY_LENGTH) return 'is a Cloudflare test SECRET key: the site key is the other one.';
  if (key.length > MAX_SITE_KEY_LENGTH) {
    return `is ${key.length} characters long: a site key is about 24, a secret key 35. This looks like the SECRET key, which must never be in the site: use the "Site Key" of the widget.`;
  }
  return null;
}
