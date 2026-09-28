import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Stylesheet order is the cascade order: global foundations first, then each
// section's own styles (imported by its components) can refine them, then the
// motion layer on top.
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app/App';
import './styles/motion.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
