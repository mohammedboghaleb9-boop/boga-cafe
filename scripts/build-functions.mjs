/**
 * Bundles each Edge Function with the code it imports from src/ into one file:
 * supabase/functions/<name>/dist/index.js. supabase-js is not bundled: the
 * Supabase runtime loads it from npm, pinned to the version in package.json.
 *
 *   npm run build:functions
 *   supabase functions deploy storefront    (entrypoint set in supabase/config.toml)
 *
 * The output is readable and pure ASCII (other characters written as \uXXXX,
 * the same strings for JavaScript), so a deployed copy can be compared with it
 * byte for byte whatever tool carried it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const FUNCTIONS = ['storefront'];
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = (name) => JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`, 'utf8')).version;
const supabaseJs = `npm:@supabase/supabase-js@${pkg('@supabase/supabase-js')}`;

/** Every character outside printable ASCII as a \uXXXX escape (they only appear in strings and regexes). */
const ascii = (code) => code.replace(/[^\n\t\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

for (const name of FUNCTIONS) {
  const file = `supabase/functions/${name}/dist/index.js`;
  await build({
    cwd: root,
    input: `supabase/functions/${name}/index.ts`,
    platform: 'neutral',
    resolve: { alias: { '@': `${root}src` } },
    external: ['@supabase/supabase-js', '@supabase/supabase-js/cors'],
    // seed/config.ts builds its delivery fees with city(): unused by the functions
    treeshake: { manualPureFunctions: ['city'] },
    output: {
      file,
      format: 'esm',
      minify: false,
      comments: false,
      paths: {
        '@supabase/supabase-js': supabaseJs,
        '@supabase/supabase-js/cors': `${supabaseJs}/cors`,
      },
    },
    logLevel: 'warn',
  });
  writeFileSync(`${root}${file}`, ascii(readFileSync(`${root}${file}`, 'utf8')));
  console.log(`✓ ${name} → ${file} (${supabaseJs})`);
}
