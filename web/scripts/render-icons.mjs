// Renders the SVG app icon into the PNG sizes browsers and phones ask for.
// Run with `npm run icons -w web` after changing src/brand/northstar-icon.svg.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile(new URL('../src/brand/northstar-icon.svg', import.meta.url));
const out = (name) =>
  new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sizes = [
  [16, 'favicon-16.png'],
  [32, 'favicon-32.png'],
  [180, 'apple-touch-icon.png'],
  [512, 'icon-512.png'],
];

for (const [size, name] of sizes) {
  await sharp(svg, { density: 72 * (size / 64) * 2 })
    .resize(size, size)
    .png()
    .toFile(out(name));
  console.log(`wrote public/${name}`);
}
