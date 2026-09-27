import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

// Two build targets:
//  - default: the real website (multi-file, served from the domain root)
//  - "demo":  the clickable prototype packed into ONE html file (dist-demo/index.html)
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
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
      include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    },
  };
});
