// Compose a desktop screenshot with the overlay windows rendered by the app
// (overlays are excluded from real captures, so they are captured separately).
//   node tools/dev/compose.ts <desktop.png> <shots.json> <out.png>
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const [desk, shotsFile, out] = process.argv.slice(2);
const { shots } = JSON.parse(readFileSync(shotsFile, 'utf8').trim() /* trim also drops a BOM */) as { shots: Array<{ file: string; bounds: { x: number; y: number; width: number; height: number } }> };
const layers = [];
for (const s of shots) {
  const img = await sharp(s.file).resize(s.bounds.width, s.bounds.height).png().toBuffer();
  layers.push({ input: img, left: s.bounds.x, top: s.bounds.y });
}
await sharp(desk).composite(layers).png().toFile(out);
console.log(out, `${layers.length} overlay layer(s)`);
