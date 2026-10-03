/**
 * One preserved user-selected portrait, one icon system.
 * This is geometric layout only: no redraw, background removal or AI character edit.
 * @napi-rs/canvas is already a pinned project development dependency.
 *
 * macOS does not apply its own rounded app-icon mask to a raw ICNS. Keep a
 * transparent 100 px outer margin on a 1024 px canvas and draw the rounded
 * 824 px tile ourselves, so Dock size is comparable to native app icons.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = fileURLToPath(new URL('../', import.meta.url));
const asset = name => resolve(root, 'assets', name);
const sourceBytes = readFileSync(asset('icon-source.png'));
const portrait = await loadImage(sourceBytes);
assert.equal(portrait.width, 330, 'Use the preserved user-selected portrait');
assert.equal(portrait.height, 244, 'Use the preserved user-selected portrait');

const spec = { size: 1024, inset: 100, tileSize: 824, radius: 184,
  portraitWidth: 768, portraitTop: 228 };
const sampled = createCanvas(portrait.width, portrait.height);
sampled.getContext('2d').drawImage(portrait, 0, 0);
const [r, g, b, a] = sampled.getContext('2d').getImageData(0, 0, 1, 1).data;
assert.equal(a, 255, 'Portrait background is expected to be opaque');
const background = `rgb(${r}, ${g}, ${b})`;
const master = createCanvas(spec.size, spec.size);
const ctx = master.getContext('2d');
ctx.beginPath();
ctx.roundRect(spec.inset, spec.inset, spec.tileSize, spec.tileSize, spec.radius);
ctx.fillStyle = background;
ctx.fill();
ctx.save();
ctx.clip();
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
ctx.drawImage(portrait, (spec.size - spec.portraitWidth) / 2, spec.portraitTop,
  spec.portraitWidth, spec.portraitWidth * portrait.height / portrait.width);
ctx.restore();

const pngs = new Map();
function png(size) {
  if (!pngs.has(size)) {
    const canvas = createCanvas(size, size);
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(master, 0, 0, size, size);
    pngs.set(size, canvas.toBuffer('image/png'));
  }
  return pngs.get(size);
}
writeFileSync(asset('icon.png'), png(1024));
// Keep an SVG consumer from silently falling back to the obsolete whale symbol.
// Embed the same final PNG so this vector wrapper cannot diverge from the app.
writeFileSync(asset('icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>Whale Companion — user-selected whale girl portrait</title><image width="1024" height="1024" href="data:image/png;base64,${png(1024).toString('base64')}"/></svg>\n`);
writeFileSync(asset('tray.png'), png(32));

// ICNS supports these PNG-backed regular and Retina representations natively.
const icnsEntries = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256],
  ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64],
  ['ic13', 256], ['ic14', 512]
];
const chunks = icnsEntries.map(([type, size]) => {
  const data = png(size), header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 4, 'ascii');
icnsHeader.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
writeFileSync(asset('icon.icns'), Buffer.concat([icnsHeader, ...chunks]));

// PNG-backed ICO representations are supported on the targeted modern Windows.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = icoHeader.length;
const icoImages = icoSizes.map((size, i) => {
  const data = png(size), entry = 6 + i * 16;
  icoHeader[entry] = icoHeader[entry + 1] = size === 256 ? 0 : size;
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(data.length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += data.length;
  return data;
});
writeFileSync(asset('icon.ico'), Buffer.concat([icoHeader, ...icoImages]));

// Fail at build time rather than deliver another opaque full-canvas icon.
const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023],
  [512, 99], [99, 512], [512, 924], [924, 512], [100, 100]]) {
  assert.equal(alpha(x, y), 0, `Expected transparent margin/corner at ${x},${y}`);
}
for (const [x, y] of [[512, 100], [100, 512], [512, 923], [923, 512], [512, 512]]) {
  assert.equal(alpha(x, y), 255, `Expected solid icon body at ${x},${y}`);
}
assert.deepEqual(readFileSync(asset('icon-source.png')), sourceBytes,
  'Icon generation must not modify the selected source portrait');
console.log(`Generated and checked portrait PNG/SVG/tray, ${icnsEntries.length} ICNS and ${icoSizes.length} ICO representations.`);
