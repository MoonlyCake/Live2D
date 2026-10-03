import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';

/** Use actual bundled inputs, plus the external native module's dependency closure. */
export function collectLicenses(results){
 const packages=new Map();
 function add(file){
  let dir=dirname(resolve(file));
  while(!existsSync(join(dir,'package.json'))){const parent=dirname(dir);if(parent===dir)throw Error('Package not found: '+file);dir=parent;}
  if(packages.has(dir))return;
  const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
  packages.set(dir,pkg);
  return {dir,pkg};
 }
 for(const result of results)for(const input of Object.keys(result.metafile.inputs))if(input.includes('node_modules/')&&existsSync(input))add(input);
 function external(name,from=resolve('package.json')){
  const local=createRequire(from),entry=local.resolve(name),added=add(entry);
  if(added)for(const dependency of Object.keys(added.pkg.dependencies||{}))external(dependency,join(added.dir,'package.json'));
 }
 external('uiohook-napi');
 const notices=[];
 for(const [dir,pkg] of [...packages].sort((a,b)=>a[1].name.localeCompare(b[1].name))){
  const names=readdirSync(dir).filter(name=>/^(licen[cs]e|copying|notice)([.-]|$)/i.test(name));
  if(!names.length)throw Error('Missing full license text for '+pkg.name);
  notices.push(`=== ${pkg.name} ${pkg.version} (${pkg.license||'see text'}) ===\n`+names.map(name=>`${name}\n${readFileSync(join(dir,name),'utf8')}`).join('\n'));
 }
 mkdirSync('licenses',{recursive:true});
 writeFileSync('licenses/BUNDLED-NPM.txt',notices.join('\n\n')+'\n');
 // The npm package always carries Electron's full MIT notice, even without dist.
 copyFileSync('node_modules/electron/LICENSE','licenses/LICENSE.electron.txt');
 console.log(`Collected complete licenses for ${packages.size} bundled/external npm packages and Electron.`);
}
