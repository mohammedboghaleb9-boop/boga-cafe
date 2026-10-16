// The real site (npm run build, no VITE_DATA_MODE) must ship none of the demo: no admin
// panel with its public password, no example customers or orders, no payment details
// marked DÉMO (src/data/mode.ts). Until the shop opens it is the "coming soon" page only
// (vite.config.ts): no example product, price or delivery tariff either. Run after
// `npm run build`. The strings are read from the seed sources, so the check follows them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const all = (re, text) => [...text.matchAll(re)].map((m) => m[1]);

const activity = src('src/data/seed/activity.ts');
const catalog = src('src/data/seed/catalog.ts');
const products = catalog.slice(catalog.indexOf('export const seedProducts'));
const config = src('src/data/seed/config.ts');
const password = all(/DEMO_PASSWORD = '([^']+)'/g, src('src/data/demo/session.ts'));
if (password.length !== 1) throw new Error('check-real-build: the demo password was not found in src/data/demo/session.ts');
const forbidden = [
  ...password,
  ...all(/customer\('([^']+)'/g, activity), // example customers
  ...all(/(?:company|contactName): '([^']+)'/g, activity), // example B2B requests
  ...all(/(?:holder|bankName|rib|beneficiary): '([^']+)'/g, activity.slice(activity.indexOf('DEMO_PAYEE'))),
  '000 000 0000000000000000', // the old placeholder RIB
];
if (forbidden.length < 5) throw new Error(`check-real-build: read only ${forbidden.length} demo strings, the sources changed`);
// the example catalog: product ids, slugs and names (the six origin names are real, they may appear),
// and the example delivery cities (Oujda is the shop's real address)
const catalogStrings = [
  ...all(/(?:id|slug): '([^']+)'/g, products),
  ...[...products.matchAll(/name: \{ ar: '([^']+)', fr: '([^']+)', en: '([^']+)'/g)].flatMap((m) => m.slice(1)),
  ...[...products.matchAll(/singleOrigin\('([^']+)', '[^']+', '([^']+)', '([^']+)', '([^']+)'/g)].flatMap((m) => m.slice(1)),
  // by French name: ids like "sale" or "fes" would match ordinary code
  ...[...config.matchAll(/city\('([^']+)', '[^']+', '([^']+)'/g)].filter((m) => m[1] !== 'oujda').map((m) => m[2]),
];
if (catalogStrings.length < 30) throw new Error(`check-real-build: read only ${catalogStrings.length} catalog strings, the sources changed`);
forbidden.push(...new Set(catalogStrings));
// no database and no form: the live project (as the previews read it), any Supabase key or Turnstile widget
const previewUrl = all(/^VITE_SUPABASE_URL=(.+)$/gm, src('.env.workers-preview'));
if (previewUrl.length !== 1) throw new Error('check-real-build: VITE_SUPABASE_URL was not found in .env.workers-preview');
forbidden.push(new URL(previewUrl[0]).hostname.split('.')[0], 'supabase.co', 'sb_publishable_', 'challenges.cloudflare.com');
// a backstop only, tied to the minifier's shape ({250:65,500:120,1e3:225}): the names above are the real check
const PRICES = /\b250:\d+,500:\d+,(?:1e3|1000):\d+/;

// every file of the build is one of these (brand images, fonts, the page): a product photo, a data file or a
// source map is refused, and every text file is read
const ALLOWED = [
  /^(index\.html|favicon\.svg|apple-touch-icon\.png|og-image\.png)$/,
  /^assets\/index-[\w-]+\.(js|css)$/,
  /^assets\/label-[\w-]+\.webp$/,
  /^assets\/(cinzel|montserrat|reem-kufi|tajawal)-[\w-]+\.woff2$/,
];
const allFiles = readdirSync('dist', { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => join(d.parentPath, d.name).slice('dist/'.length).split('\\').join('/'));
const problems = allFiles.filter((f) => !ALLOWED.some((re) => re.test(f))).map((f) => `${f} is not a file of the "coming soon" page`);
const files = allFiles.filter((f) => /\.(js|html|css|svg)$/.test(f));
if (files.some((f) => /AdminApp/.test(f))) problems.push('the admin panel chunk is in the build');
for (const f of files) {
  const text = readFileSync(join('dist', f), 'utf8');
  for (const s of forbidden) if (text.includes(s)) problems.push(`${f} contains "${s}"`);
  if (PRICES.test(text)) problems.push(`${f} contains product prices (${text.match(PRICES)[0]})`);
}
// the entry is the "coming soon" page, never the shop (src/main.tsx)
const html = readFileSync(join('dist', 'index.html'), 'utf8');
if (!html.includes('data-site="coming-soon"')) problems.push('dist/index.html is not the "coming soon" page');
const scripts = files.filter((f) => f.endsWith('.js'));
if (scripts.length !== 1) problems.push(`expected one script (the "coming soon" page), found ${scripts.length}: ${scripts.join(', ')}`);
else if (!readFileSync(join('dist', scripts[0]), 'utf8').includes('soon-contact-title')) problems.push(`${scripts[0]} is not the "coming soon" page`);
if (problems.length) {
  console.error(`The real build ships demo content:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`real build clean: "coming soon" only, ${forbidden.length} demo and catalog strings checked in ${files.length} files, no product prices, one script`);
