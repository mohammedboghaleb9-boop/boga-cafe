import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

// Two build targets:
//  - default: the real website (multi-file, served from the domain root)
//  - "demo":  the clickable prototype packed into ONE html file (dist-demo/index.html)
export default defineConfig(({ command, mode }) => {
  const demo = mode === 'demo';
  // the simulated card page must never reach real customers (docs/09, .env.example)
  if (command === 'build' && !demo && { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }.VITE_CARD_GATEWAY === 'demo') {
    throw new Error('VITE_CARD_GATEWAY=demo is for the prototype only (npm run build:demo). Leave it empty until CMI is connected.');
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
    },
    test: {
      include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'tests/**/*.test.ts'],
    },
  };
});
