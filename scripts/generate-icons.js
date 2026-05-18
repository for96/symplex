// Genera le icone PWA da un SVG sorgente per Simplesso.
// Output: public/icon-192.png, icon-512.png, icon-maskable.png,
//         apple-touch-icon.png, favicon.png
//
// Esecuzione: `npm run icons` (richiede `sharp` come devDependency).

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'public');

// Palette allineata ai token CSS del progetto:
//   --ink       (deep ink, light-mode foreground)        → background icona
//   --bg-paper  (cream paper, light-mode background)     → glyph
//   --accent    (vermillion, oklch(58% 0.18 28))         → accent stripe
const BG = '#1a1814';
const FG = '#faf6ed';
const ACCENT = '#c4513a';

// Costruisce un SVG con "S" italica + striscia vermiglio sotto.
//   safe: 0.76 → padding 12% (icone "any")
//   safe: 0.60 → padding 20% (icona "maskable" — safe-zone 80% centrale)
function buildSvg({ size, safe = 0.76 }) {
  const pad = (1 - safe) / 2 * size;
  const inner = size - pad * 2;
  const mainFs = Math.round(inner * 0.86);
  const mainY = Math.round(size * 0.66);
  const stripeY = Math.round(size * 0.78);
  const stripeW = Math.round(inner * 0.44);
  const stripeH = Math.max(2, Math.round(inner * 0.05));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g font-family="Georgia, 'Iowan Old Style', 'Times New Roman', serif" text-anchor="middle">
    <text x="${size / 2}" y="${mainY}" font-size="${mainFs}" font-style="italic" font-weight="500" fill="${FG}">S</text>
  </g>
  <rect x="${(size - stripeW) / 2}" y="${stripeY}" width="${stripeW}" height="${stripeH}" rx="${stripeH / 2}" fill="${ACCENT}"/>
</svg>`;
}

async function render(svgString, outPath, size) {
  await sharp(Buffer.from(svgString)).resize(size, size).png().toFile(outPath);
  console.log(`✓ ${outPath}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // Standard 192 + 512 (padding 12% → contenuto 76%)
  await render(buildSvg({ size: 192, safe: 0.76 }), resolve(OUT, 'icon-192.png'), 192);
  await render(buildSvg({ size: 512, safe: 0.76 }), resolve(OUT, 'icon-512.png'), 512);

  // Maskable: safe area = 80% centrale → contenuto deve stare nel 60% centrale.
  await render(buildSvg({ size: 512, safe: 0.6 }), resolve(OUT, 'icon-maskable.png'), 512);

  // Apple touch icon 180×180 (iOS).
  await render(buildSvg({ size: 180, safe: 0.76 }), resolve(OUT, 'apple-touch-icon.png'), 180);

  // Favicon piccolo per i tab del browser.
  await render(buildSvg({ size: 32, safe: 0.86 }), resolve(OUT, 'favicon.png'), 32);

  console.log('\nFatto. Icone in public/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
