import './generate-icons.mjs';
import {collectLicenses} from './collect-licenses.mjs';
import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist/renderer', { recursive: true });
const results=await Promise.all([
  build({ entryPoints:['src/main/index.ts'],outdir:'dist/main',bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},external:['electron','uiohook-napi'],define:{'process.env.WHALE_EDITION':JSON.stringify(process.env.WHALE_EDITION||'inochi')},sourcemap:true,metafile:true }),
  build({ entryPoints:['src/preload/index.ts'],outdir:'dist/preload',bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},external:['electron'],sourcemap:true,metafile:true }),
  build({ entryPoints:['src/renderer/pet.ts','src/renderer/settings.ts'],outdir:'dist/renderer',bundle:true,platform:'browser',format:'esm',splitting:true,sourcemap:true,metafile:true })
]);
collectLicenses(results);
for (const file of ['pet.html','settings.html','styles.css']) await copyFile(`src/renderer/${file}`,`dist/renderer/${file}`);
console.log('Built main, preload, pet and settings. Default renderer: Inochi 0.8 subset. Optional Cubism Core is not bundled.');
