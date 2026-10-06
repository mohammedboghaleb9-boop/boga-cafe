import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

// Two build targets:
//  - default: the real website (multi-file, served from the domain root)
//  - "demo":  the clickable prototype packed into ONE html file (dist-demo/index.html)
/** Only a key meant for browsers: sb_publishable_… or a legacy JWT whose role is anon (an allowlist, so no other key slips through). */
function isPublishableKey(key: string): boolean {
  if (key !== key.trim()) return false;
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8')) as { role?: string };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

export default defineConfig(({ command, mode }) => {
  const demo = mode === 'demo';
  // the simulated card page must never reach real customers (docs/09, .env.example)
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  if (command === 'build' && !demo && env.VITE_CARD_GATEWAY === 'demo') {
    throw new Error('VITE_CARD_GATEWAY=demo is for the prototype only (npm run build:demo). Leave it empty until CMI is connected.');
  }
  // the live database: both public values, and never a secret key (it would ship to every visitor)
  if (env.VITE_DATA_MODE === 'supabase') {
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
    if (!env.VITE_SUPABASE_URL || !key) {
      throw new Error('VITE_DATA_MODE=supabase needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (.env.example). The site never falls back to the example catalog.');
    }
    if (!isPublishableKey(key)) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be the publishable key (sb_publishable_…) or the legacy anon key, with no spaces: anything else would ship to every visitor.');
  }
  return {
    base: demo ? './' : '/',
    plugins: [react(), ...(demo ? [viteSingleFile()] : [])],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      assetsInlineLimit: demo ? 100_000_000 : 4096,
      // the seed files are plain data: a build that does not use them (VITE_DATA_MODE=supabase) drops them whole
      rollupOptions: { treeshake: { moduleSideEffects: (id: string) => !id.includes('/src/data/seed/') } },
    },
    test: {
      include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'tests/**/*.test.ts'],
      // the data-layer tests drive the demo store (example orders, DÉMO payment details)
      env: { VITE_DATA_MODE: 'demo' },
    },
  };
});
