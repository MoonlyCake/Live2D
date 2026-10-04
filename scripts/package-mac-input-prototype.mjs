import {cpSync,mkdirSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),pkg=require('../package.json');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Native Apple Silicon runner required');
const app=resolve('release/mac-input-prototype/Whale Input Prototype.app');
const contents=join(app,'Contents'),resources=join(contents,'Resources'),root=resolve('native/mac-input-prototype');
if(existsSync(app))throw Error('Use a fresh prototype output directory');
mkdirSync(resolve('release/mac-input-prototype'),{recursive:true});
// npm ci can omit Electron's binary install; fetch the same official pinned runtime
// as the production packager instead of assuming node_modules contains Electron.app.
const {downloadArtifact}=require('@electron/get');
const archive=await downloadArtifact({version:pkg.devDependencies.electron,artifactName:'electron',platform:'darwin',arch:'arm64',checksums:require('electron/checksums.json')});
const runtime=resolve('release/mac-input-prototype/runtime');mkdirSync(runtime,{recursive:true});
const extracted=spawnSync('ditto',['-x','-k',archive,runtime],{stdio:'inherit'});if(extracted.status!==0)process.exit(extracted.status??1);
cpSync(join(runtime,'Electron.app'),app,{recursive:true,verbatimSymlinks:true});
rmSync(join(resources,'default_app.asar'),{force:true});mkdirSync(join(resources,'app'),{recursive:true});
writeFileSync(join(resources,'app/package.json'),JSON.stringify({name:'whale-input-prototype',version:'0.1.0',main:'smoke.cjs'}));
for(const file of ['smoke.cjs','adapter.cjs','key-ids.json','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','BUNDLED-RUST.txt'])copyFileSync(join(root,file),join(resources,'app',file));
copyFileSync(join(root,'build/whale-mac-input.node'),join(contents,'Frameworks/whale-mac-input.node'));
copyFileSync(join(root,'build/os-event-driver.node'),join(contents,'Frameworks/os-event-driver.node'));
copyFileSync(join(root,'qa/key-cases.json'),join(resources,'app/key-cases.json'));
copyFileSync(join(runtime,'LICENSE'),join(resources,'LICENSE.electron.txt'));
copyFileSync(join(runtime,'LICENSES.chromium.html'),join(resources,'LICENSES.chromium.html'));
const plist=spawnSync('python3',['-c',"import plistlib,sys; p=sys.argv[1]; d=plistlib.load(open(p,'rb')); d.update(CFBundleIdentifier='local.whale.companion.input-prototype',CFBundleName='Whale Input Prototype',CFBundleDisplayName='Whale Input Prototype'); plistlib.dump(d,open(p,'wb'))",join(contents,'Info.plist')],{stdio:'inherit'});if(plist.status!==0)process.exit(plist.status??1);
const signed=spawnSync('python3',['scripts/sign-macos-native.py',app],{stdio:'inherit'});if(signed.status!==0)process.exit(signed.status??1);
console.log(app);
