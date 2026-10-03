import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve('native/mac-input-prototype');
for(const args of [['test','--locked'],['build','--release','--locked']]){const r=spawnSync('cargo',args,{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
const library=process.platform==='darwin'?'libwhale_mac_input_prototype.dylib':process.platform==='linux'?'libwhale_mac_input_prototype.so':null;
if(!library)throw Error('Experimental build supports macOS ARM and Linux test stub only');
mkdirSync(`${root}/build`,{recursive:true});copyFileSync(`${root}/target/release/${library}`,`${root}/build/whale-mac-input.node`);
console.log('Built experimental addon. Production input selection remains unchanged.');
