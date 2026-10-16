import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/fonts.css';
import '@/styles/tokens.css';
import './coming-soon.css';
import { ComingSoon } from './ComingSoon';

/**
 * Entry of the production build until the shop opens (vite.config.ts picks it for a build without
 * VITE_DATA_MODE): nothing of the shop (src/app) is bundled, so no example catalog or price ships.
 */
// an old shop link answers this page too (Cloudflare's single-page fallback): kept out of search results
if (location.pathname !== '/') {
  const robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex';
  document.head.append(robots);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ComingSoon />
  </StrictMode>,
);
