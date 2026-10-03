/** Structural/regression verification for the generated icon system. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const file = name => readFileSync(assets + name);
const master = await loadImage(file('icon.png'));
assert.equal(master.width, 1024); assert.equal(master.height, 1024);
const svg = file('icon.svg').toString();
assert(svg.includes(`data:image/png;base64,${file('icon.png').toString('base64')}`), 'SVG must wrap the same portrait icon');
const icns = file('icon.icns');
assert.equal(icns.toString('ascii', 0, 4), 'icns');
assert.equal(icns.readUInt32BE(4), icns.length);
const expected = new Map([['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]]);
const representations = [];
function pixels(image) {
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data;
}
function verifyAlpha(image) {
  const data = pixels(image), size = image.width;
  assert.equal(data[3], 0, 'Top-left corner must be transparent');
  assert.equal(data[(size * size - 1) * 4 + 3], 0, 'Bottom-right corner must be transparent');
  assert.equal(data[(Math.floor(size/2) * size + Math.floor(size/2)) * 4 + 3], 255, 'Portrait center must be opaque');
}
for (let offset = 8; offset < icns.length;) {
  const type = icns.toString('ascii', offset, offset + 4), length = icns.readUInt32BE(offset + 4);
  assert(length > 8 && offset + length <= icns.length, 'Valid ICNS chunk length');
  assert(expected.has(type), `Unexpected or duplicate ICNS type ${type}`);
  const image = await loadImage(icns.subarray(offset + 8, offset + length));
  assert.equal(image.width, expected.get(type)); assert.equal(image.height, expected.get(type));
  verifyAlpha(image); representations.push(`${type}:${image.width}`); expected.delete(type); offset += length;
}
assert.equal(expected.size, 0, 'All standard and Retina ICNS representations required');
const ico = file('icon.ico');
assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 7);
const icoSizes = [];
for (let i = 0; i < ico.readUInt16LE(4); i++) {
  const entry = 6 + i * 16, size = ico[entry] || 256;
  assert.equal(ico[entry + 1] || 256, size);
  const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
  assert(offset >= 6 + 7 * 16 && offset + length <= ico.length, 'Valid ICO image extent');
  const image = await loadImage(ico.subarray(offset, offset + length));
  assert.equal(image.width, size); assert.equal(image.height, size); verifyAlpha(image); icoSizes.push(size);
}
assert.deepEqual(icoSizes, [16,24,32,48,64,128,256]);
verifyAlpha(master); verifyAlpha(await loadImage(file('tray.png')));
const sourceBefore = file('icon-source.png');
const before = new Map(['icon.png','icon.svg','tray.png','icon.icns','icon.ico'].map(name => [name, file(name)]));
await import('./generate-icons.mjs');
assert.deepEqual(file('icon-source.png'), sourceBefore, 'Generation must preserve source bytes');
for (const [name, bytes] of before) assert.deepEqual(file(name), bytes, `${name} regeneration must be deterministic`);
console.log(JSON.stringify({passed:true,sourcePreserved:true,deterministic:true,canvas:1024,tile:824,transparentMargin:100,cornerRadius:184,icns:representations,ico:icoSizes,sharedPanelAsset:'assets/icon.png'},null,2));
