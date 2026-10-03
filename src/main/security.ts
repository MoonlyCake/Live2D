import { realpathSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, basename, sep } from 'node:path';
export function inside(root:string,path:string):boolean{const rel=relative(root,path);return rel===''||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel));}
export function safeLocalPath(root:string,requested:string):string|null{try{if(requested.includes('\0'))return null;const r=realpathSync(root),p=realpathSync(resolve(r,requested.replace(/^\/+/,'')));return inside(r,p)&&statSync(p).isFile()?p:null;}catch{return null;}}
export function validateModel(modelPath:string):{name:string;fileName:string;manifest:unknown|null;files:string[]}{
 const root=realpathSync(dirname(modelPath)); if(!modelPath.endsWith('.model3.json'))throw new Error('请选择 .model3.json 模型入口');
 if(statSync(modelPath).size>1024*1024)throw new Error('模型描述文件过大');const data=JSON.parse(readFileSync(modelPath,'utf8'));const refs=data.FileReferences;
 const isFileReference=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
 if(!refs||typeof refs!=='object'||Array.isArray(refs)||!isFileReference(refs.Moc)||!Array.isArray(refs.Textures)||!refs.Textures.length||refs.Textures.some((v:unknown)=>!isFileReference(v)))throw new Error('缺少或无效的 Moc / Textures');
 for(const key of ['Physics','Pose','UserData','DisplayInfo'])if(refs[key]!==undefined&&!isFileReference(refs[key]))throw new Error('模型文件引用必须为非空字符串：'+key);
 if(refs.Expressions!==undefined&&(!Array.isArray(refs.Expressions)||refs.Expressions.some((v:any)=>!v||typeof v!=='object'||!isFileReference(v.File)||typeof v.Name!=='string')))throw new Error('Expressions 必须包含名称和非空文件路径');
 if(refs.Motions!==undefined){if(!refs.Motions||typeof refs.Motions!=='object'||Array.isArray(refs.Motions))throw new Error('Motions 必须是动作分组');for(const group of Object.values(refs.Motions)){if(!Array.isArray(group)||group.some((v:any)=>!v||typeof v!=='object'||!isFileReference(v.File)||(v.Sound!==undefined&&!isFileReference(v.Sound))))throw new Error('动作分组必须是有效文件列表');}}
 const files:string[]=[];const walk=(value:unknown)=>{if(typeof value==='string')files.push(value);else if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')Object.values(value).forEach(walk);};
 // HitAreas/Names are not file paths. FileReferences known fields only.
 for(const key of ['Moc','Textures','Physics','Pose','UserData','DisplayInfo'])if(refs[key])walk(refs[key]);
 for(const expr of refs.Expressions??[])if(expr.File)files.push(expr.File);
 for(const group of Object.values(refs.Motions??{}) as any[][])for(const motion of group){if(motion.File)files.push(motion.File);if(motion.Sound)files.push(motion.Sound);}
 for(const file of files){if(/^[a-z]+:/i.test(file)||file.startsWith('/')||file.includes('\\')||!safeLocalPath(root,file))throw new Error(`模型引用必须是同一文件夹内的本地文件：${file.slice(0,100)}`);}
 if(!refs.Moc.endsWith('.moc3'))throw new Error('需要真正的 .moc3 编译模型，图片不能代替');
 // The descriptor can point at a large compiled model. Read only its signature
 // here, rather than allocating the entire binary on Electron's main thread.
 const mocPath=safeLocalPath(root,refs.Moc);if(!mocPath)throw new Error('Moc 文件不可用');
 const header=Buffer.alloc(4);const descriptor=openSync(mocPath,'r');
 try{if(readSync(descriptor,header,0,4,0)!==4||header.toString('ascii')!=='MOC3')throw new Error('Moc 文件不是有效的 MOC3 入口');}finally{closeSync(descriptor);}
 let manifest:unknown=null;try{const p=safeLocalPath(root,'whale.manifest.json');if(p&&statSync(p).size<100000)manifest=JSON.parse(readFileSync(p,'utf8'));}catch{}
 return {name:basename(modelPath,'.model3.json'),fileName:basename(modelPath),manifest,files:[realpathSync(modelPath),...files.map(file=>safeLocalPath(root,file)!),...(safeLocalPath(root,'whale.manifest.json')?[safeLocalPath(root,'whale.manifest.json')!]:[])]};
}
export function clampWindow(bounds:{x:number;y:number;width:number;height:number},workArea:{x:number;y:number;width:number;height:number}){return {...bounds,x:Math.round(Math.max(workArea.x,Math.min(bounds.x,workArea.x+workArea.width-bounds.width))),y:Math.round(Math.max(workArea.y,Math.min(bounds.y,workArea.y+workArea.height-bounds.height)))};}
