/**
 * Rasterise the brand SVGs to PNG with a headless Chromium (Playwright).
 * Run from the repository root:  node brand/source/export_png.cjs
 * (needs `playwright` resolvable, e.g. NODE_PATH=$(npm root -g)).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const svg = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const INK = 'brand/logo/svg/';

// [source svg, output png, width in px, transparent?]
const jobs = [
  [INK + 'boga-cafe-logo.svg', 'brand/logo/png/boga-cafe-logo-2048.png', 2048, true],
  [INK + 'boga-cafe-logo-silver-on-black.svg', 'brand/logo/png/boga-cafe-logo-silver-on-black-2048.png', 2048, false],
  [INK + 'boga-cafe-logo-tagline.svg', 'brand/logo/png/boga-cafe-logo-tagline-2048.png', 2048, true],
  [INK + 'boga-cafe-monogram.svg', 'brand/logo/png/boga-cafe-monogram-1024.png', 1024, true],
  [INK + 'boga-cafe-monogram-silver-on-black.svg', 'brand/logo/png/boga-cafe-monogram-silver-on-black-1024.png', 1024, false],
  [INK + 'boga-cafe-horizontal.svg', 'brand/logo/png/boga-cafe-horizontal-2400.png', 2400, true],
  [INK + 'boga-cafe-horizontal-silver-on-black.svg', 'brand/logo/png/boga-cafe-horizontal-silver-on-black-2400.png', 2400, false],
  ['brand/social/profile.svg', 'brand/social/profile-1080.png', 1080, false],
  ['brand/social/og-image.svg', 'brand/social/og-image-1200x630.png', 1200, false],
  ['brand/social/og-image.svg', 'public/og-image.png', 1200, false],
  ['brand/social/app-icon.svg', 'public/apple-touch-icon.png', 180, false],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [src, out, width, transparent] of jobs) {
    const s = svg(src);
    const [, , , vw, vh] = s.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/).map(Number);
    const height = Math.round((width * vh) / vw);
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>${s}`,
    );
    fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
    await page.screenshot({ path: path.join(root, out), omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
    console.log(`${out.padEnd(58)} ${width}×${height}`);
  }
  await browser.close();
})();
