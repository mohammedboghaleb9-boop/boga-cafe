// What the real site (no VITE_DATA_MODE) may ship: until the shop opens, the "coming soon" page only
// (vite.config.ts). None of the demo (admin password, example customers, DÉMO payment details), none of
// the example catalog (products, prices, delivery tariff), no database, form or source map. Run by the
// build itself on the folder it wrote (vite.config.ts) and by `npm run check:real-build` (CI). The
// strings are read from the seed sources, so the check follows them; every group of them is counted
// against the source's own shape, so a line reformatted out of a pattern stops the check, never skips it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const count = (re, text) => [...text.matchAll(re)].length;

/** The strings no real build may contain, each group checked against what the source holds. */
function forbiddenStrings() {
  const activity = src('src/data/seed/activity.ts');
  const catalog = src('src/data/seed/catalog.ts');
  const products = catalog.slice(catalog.indexOf('export const seedProducts'));
  const config = src('src/data/seed/config.ts');
  const groups = {};
  const group = (name, values, expected) => {
    if (values.length !== expected || expected === 0) {
      throw new Error(`real-build check: ${name}: read ${values.length}, the source holds ${expected}: the sources changed, update scripts/real-build.mjs`);
    }
    groups[name] = values;
  };
  const caught = (re, text) => [...text.matchAll(re)];

  // the demo
  group('demo password', caught(/DEMO_PASSWORD = '([^']+)'/g, src('src/data/demo/session.ts')).map((m) => m[1]), 1);
  group('example customers', caught(/customer\('([^']+)'/g, activity).map((m) => m[1]), count(/customer\(/g, activity) - count(/function customer\(/g, activity));
  const b2b = caught(/(?:company|contactName): '([^']+)'/g, activity).map((m) => m[1]);
  group('example B2B requests', b2b, count(/(?:company|contactName): '[^']/g, activity));
  const payee = activity.slice(activity.indexOf('DEMO_PAYEE'));
  group('DÉMO payment details', caught(/(?:holder|bankName|rib|beneficiary): '([^']+)'/g, payee).map((m) => m[1]), count(/(?:holder|bankName|rib|beneficiary): '[^']/g, payee));

  // the example catalog (the six origin names are real: they may appear)
  const inline = count(/^ {4}id: '/gm, products);
  group('product ids and slugs', caught(/^ {4}(?:id|slug): '([^']+)'/gm, products).map((m) => m[1]), 2 * inline);
  const names = caught(/name: \{ ar: '([^']+)', fr: '([^']+)', en: '([^']+)' \}/g, products);
  for (const [i, lang] of ['ar', 'fr', 'en'].entries()) group(`product names (${lang})`, names.map((m) => m[i + 1]), inline);
  const single = caught(/singleOrigin\('([^']+)', '[^']+', '([^']+)', '([^']+)', '([^']+)'/g, products);
  const calls = count(/singleOrigin\('/g, products);
  group('single-origin ids', single.map((m) => m[1]), calls);
  for (const [i, lang] of ['fr', 'en', 'ar'].entries()) group(`single-origin names (${lang})`, single.map((m) => m[i + 2]), calls);
  // the example delivery cities, by French name (ids like "sale" or "fes" match ordinary code); Oujda is the real address
  const cities = caught(/city\('([^']+)', '[^']+', '([^']+)'/g, config);
  group('example cities', cities.filter((m) => m[1] !== 'oujda').map((m) => m[2]), count(/city\('/g, config) - 1);

  // no database and no form: the live project (as the previews read it), any Supabase key, the Turnstile widget
  const url = caught(/^VITE_SUPABASE_URL=(.+)$/gm, src('.env.workers-preview')).map((m) => new URL(m[1]).hostname.split('.')[0]);
  group('live project', url, 1);
  return { groups, strings: [...new Set([...Object.values(groups).flat(), '000 000 0000000000000000', 'supabase.co', 'sb_publishable_', 'challenges.cloudflare.com'])] };
}

// a backstop only, tied to the minifier's shape ({250:65,500:120,1e3:225}): the names above are the real check
const PRICES = /\b250:\d+,500:\d+,(?:1e3|1000):\d+/;

// every file of the build is one of these (the page, brand images, fonts): a product photo, a data file or a
// source map is refused, and every text file is read
const ALLOWED = [
  /^(index\.html|favicon\.svg|apple-touch-icon\.png|og-image\.png)$/,
  /^assets\/index-[\w-]+\.(js|css)$/,
  /^assets\/label-[\w-]+\.webp$/,
  /^assets\/(cinzel|montserrat|reem-kufi|tajawal)-[\w-]+\.woff2$/,
];

/**
 * What is wrong with the build in `dir` (empty: a clean "coming soon" build), and what was checked.
 * @param {string} dir
 */
export function realBuildProblems(dir) {
  const { groups, strings } = forbiddenStrings();
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/'));
  const problems = files.filter((f) => !ALLOWED.some((re) => re.test(f))).map((f) => `${f} is not a file of the "coming soon" page`);
  const texts = files.filter((f) => /\.(js|html|css|svg)$/.test(f));
  for (const f of texts) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const s of strings) if (text.includes(s)) problems.push(`${f} contains "${s}"`);
    if (PRICES.test(text)) problems.push(`${f} contains product prices (${text.match(PRICES)[0]})`);
  }
  // the entry is the "coming soon" page, never the shop (src/main.tsx)
  if (!files.includes('index.html')) problems.push('no index.html');
  else if (!readFileSync(join(dir, 'index.html'), 'utf8').includes('data-site="coming-soon"')) problems.push('index.html is not the "coming soon" page');
  const scripts = texts.filter((f) => f.endsWith('.js'));
  if (scripts.length !== 1) problems.push(`expected one script (the "coming soon" page), found ${scripts.length}: ${scripts.join(', ')}`);
  else if (!readFileSync(join(dir, scripts[0]), 'utf8').includes('soon-contact-title')) problems.push(`${scripts[0]} is not the "coming soon" page`);
  const sizes = Object.entries(groups).map(([name, v]) => `${name} ${v.length}`).join(', ');
  return { problems, summary: `"coming soon" only: ${strings.length} strings (${sizes}) checked in ${texts.length} of ${files.length} files, no product prices, one script` };
}
