import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const pkg=require('../package.json');
const [platform='win',edition='inochi',arch=platform==='mac'?'arm64':'x64']=process.argv.slice(2);
if(!['mac-arm64','win-x64','linux-x64'].includes(`${platform}-${arch}`)||edition!=='inochi')throw new Error('Targets: mac inochi arm64 | win inochi x64 | linux inochi x64 (QA). Intel Mac is not supported.');
if(platform==='mac'&&process.platform!=='darwin')throw new Error('Release Mac bundle must be built/signed on the native Apple Silicon cloud runner');
const cache=join(tmpdir(),'whale-cache');
const env={...process.env,WHALE_EDITION:edition,XDG_CACHE_HOME:cache,ELECTRON_BUILDER_CACHE:process.env.ELECTRON_BUILDER_CACHE||join(tmpdir(),'whale-builder-cache'),CSC_IDENTITY_AUTO_DISCOVERY:'false'};
function run(args){const r=spawnSync(process.execPath,args,{stdio:'inherit',env});if(r.status!==0)process.exit(r.status||1);}
const zipName=`electron-v${pkg.devDependencies.electron}-${platform==='mac'?'darwin':platform==='win'?'win32':'linux'}-${arch}.zip`;
let cached;
for(const root of [join(cache,'electron'),join(tmpdir(),'whale-electron-cache')])if(existsSync(root))for(const dir of readdirSync(root)){const file=join(root,dir,zipName);if(existsSync(file))cached=file;}
const product='Whale Companion Inochi';
run(['--import','tsx','scripts/assert-release-model.mts']);
run(['scripts/build.mjs']);
run(['node_modules/electron-builder/out/cli/cli.js',`--${platform}`,...(platform==='mac'||platform==='linux'?['--dir']:['zip']),`--${arch}`,...(cached?[`--config.electronDist=${cached}`]:[]),`--config.productName=${product}`,`--config.appId=local.whale.companion.${edition}`,`--config.directories.output=release/${edition}`,`--config.artifactName=Whale-Companion-${edition}-\${version}-\${os}-\${arch}.\${ext}`]);
if(platform==='mac'){
 const staging=resolve(`release/${edition}/mac-arm64`);
 const output=resolve(`release/${edition}/Whale-Companion-${edition}-${pkg.version}-mac-${arch}.zip`);
 const app=join(staging,`${product}.app`);
 for(const name of ['LICENSE.electron.txt','LICENSES.chromium.html'])copyFileSync(join('licenses',name),join(app,'Contents/Resources',name));
 const signed=spawnSync('python3',['scripts/sign-macos-native.py',app],{stdio:'inherit',env});
 if(signed.status!==0)throw new Error('Native ad-hoc signing/verification failed');
 rmSync(output,{force:true});
 const zipped=spawnSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',app,output],{stdio:'inherit',env});
 if(zipped.status!==0)throw new Error('Native macOS archive creation failed');
 console.log(`Packaged ${output}`);
}
