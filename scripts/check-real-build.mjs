// The real site (npm run build, VITE_DATA_MODE not "demo") must ship none of the
// demo: no admin panel with its public password, no example customers or orders,
// no payment details marked DÉMO (src/data/mode.ts). Run after `npm run build`.
// The strings are read from the demo sources, so the check follows them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const all = (re, text) => [...text.matchAll(re)].map((m) => m[1]);

const activity = src('src/data/seed/activity.ts');
const forbidden = [
  ...all(/DEMO_PASSWORD = '([^']+)'/g, src('src/features/admin/session.ts')),
  ...all(/customer\('([^']+)'/g, activity), // example customers
  ...all(/(?:company|contactName): '([^']+)'/g, activity), // example B2B requests
  ...all(/(?:holder|bankName|rib|beneficiary): '([^']+)'/g, activity.slice(activity.indexOf('DEMO_PAYEE'))),
  '000 000 0000000000000000', // the old placeholder RIB
];
if (forbidden.length < 5) throw new Error(`check-real-build: read only ${forbidden.length} demo strings, the sources changed`);

const files = readdirSync('dist', { recursive: true }).map(String).filter((f) => /\.(js|html|css)$/.test(f));
const problems = [];
if (files.some((f) => /AdminApp/.test(f))) problems.push('the admin panel chunk is in the build');
for (const f of files) {
  const text = readFileSync(join('dist', f), 'utf8');
  for (const s of forbidden) if (text.includes(s)) problems.push(`${f} contains "${s}"`);
}
if (problems.length) {
  console.error(`The real build ships demo content:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`real build clean: ${forbidden.length} demo strings checked in ${files.length} files, no admin chunk`);
