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
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ComingSoon />
  </StrictMode>,
);
