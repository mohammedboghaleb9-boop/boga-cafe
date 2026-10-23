/**
 * The shop's `_headers` file (Cloudflare reads it from the assets folder and never serves it:
 * https://developers.cloudflare.com/workers/static-assets/headers/).
 *
 * - Every page: no framing (the Admin Panel signs in here), no type sniffing, only the origin sent to other sites,
 *   and until the launch no file indexed.
 * - Every file the build wrote under /assets carries a hash of its content in its name, so it never changes under that
 *   name: kept for a year, with no round trip to ask again (Cloudflare's default is to revalidate on every use).
 *   One rule per file, never `/assets/*`: the site answers any unknown path with index.html (the router's page), so a
 *   splat would also give a year of life to that HTML when a page asks for a file that is gone (an old tab after a
 *   deploy). A file without a rule keeps the default and is asked again.
 * - Cloudflare reads at most 100 rules: the page rule and 90 files are written, media first (they weigh most), then
 *   scripts and styles. A file past the limit simply keeps the default.
 */
export const MAX_FILE_RULES = 90;

const LONG_LIFE = '  Cache-Control: public, max-age=31536000, immutable';
const HASHED = /^assets\/[\w.-]+-[\w-]{8}\.[a-z0-9]+$/;
const MEDIA = /\.(webp|png|jpe?g|avif|svg|mp4|woff2?)$/;

/** @param {string[]} files every file name of the bundle, as written (e.g. "assets/packshot-C7fJ_hY-.webp") */
export function shopHeadersFile(files) {
  const hashed = files.filter((f) => HASHED.test(f)).sort();
  const ordered = [...hashed.filter((f) => MEDIA.test(f)), ...hashed.filter((f) => !MEDIA.test(f))].slice(0, MAX_FILE_RULES);
  return `${[
    '/*',
    '  X-Frame-Options: DENY',
    "  Content-Security-Policy: frame-ancestors 'none'",
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Robots-Tag: noindex',
    ...ordered.flatMap((f) => [`/${f}`, LONG_LIFE]),
  ].join('\n')}\n`;
}
