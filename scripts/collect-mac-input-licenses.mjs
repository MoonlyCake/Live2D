import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
const root=resolve('native/mac-input-prototype');
const result=spawnSync('cargo',['metadata','--locked','--format-version','1','--manifest-path',join(root,'Cargo.toml')],{encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
const metadata=JSON.parse(result.stdout),notices=[];
for(const pkg of metadata.packages.sort((a,b)=>a.name.localeCompare(b.name))){
 const dir=dirname(pkg.manifest_path);
 let files=readdirSync(dir).filter(name=>/^(LICENSE|LICENCE|COPYING|NOTICE)([.-]|$)/i.test(name));
 if(!files.length&&pkg.repository==='https://github.com/napi-rs/napi-rs'){
  const sha=JSON.parse(readFileSync(join(dir,'.cargo_vcs_info.json'),'utf8')).git.sha1;
  notices.push(`=== ${pkg.name} ${pkg.version}: ${pkg.license} ===\nSource: https://github.com/napi-rs/napi-rs/blob/${sha}/LICENSE\n`+readFileSync(join(root,'third-party-licenses',`napi-rs-${sha}.txt`),'utf8'));continue;
 }
 if(!files.length)throw Error('Missing complete license text for '+pkg.name);
 notices.push(`=== ${pkg.name} ${pkg.version}: ${pkg.license||'see license'} ===\n`+files.map(name=>`${name}\n${readFileSync(join(dir,name),'utf8')}`).join('\n'));
}
writeFileSync(join(root,'BUNDLED-RUST.txt'),notices.join('\n\n')+'\n');
console.log(`Collected complete license text for ${metadata.packages.length} Rust packages (includes build-time packages).`);
