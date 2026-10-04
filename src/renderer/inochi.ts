import {readInochiAssets} from './inochi/assets';
import {PerspectiveKeyboard} from './inochi/perspective-keyboard';
import {WorkPose,validateWorkContract,requiredWorkParameters,deskVisibility,type WorkContract} from '../shared/work-scene';
import {MouseMotion} from './inochi/mouse-motion';
import {DeviceSurface,insertDeviceQuad,insertDeviceMesh} from './inochi/devices';
import {physicalPose,PHYSICAL_PARAMETERS} from './inochi/physical-pose';
import{SubsetModel,type InochiParameter}from'../shared/inochi-runtime.mjs';
import{InochiProofRenderer}from'./inochi/webgl-renderer.mjs';
import{SoftwareMeshRenderer}from'./inochi/software-renderer.mjs';
import type{MeshRenderer}from'./inochi/renderer-types';
import type{Live2DFrame}from'./live2d';
export interface InochiCapabilities{type:'inochi-0.8-subset';parameters:string[];gaze:boolean;breathing:boolean;blink:boolean;sleepEyes:boolean;typing:boolean;bounce:boolean;audio:boolean;eating:boolean;moods:string[];warnings:string[];physicalInput?:boolean;moodMode?:'authored-expressions'|'eye-mouth'}
export interface InochiStatus{state:'missing-model'|'loading'|'ready'|'error';message:string;capabilities?:InochiCapabilities}
export interface InochiLoadRequest{rendererType?:string;modelUrl?:string|null;workScene?:{modelUrl:string;contractUrl:string}}
interface DeskScene{model:SubsetModel;contract:WorkContract;pose:WorkPose;keyboard:PerspectiveKeyboard;textureOffset:number;keyboardTexture:number;front:Set<number>;capabilities:InochiCapabilities;modelUrl:string}
const MOOD_PARAMETERS:Record<string,string>={happy:'ParamHappy',shy:'ParamShy',aggrieved:'ParamAggrieved',sleepy:'ParamSleepy',unimpressed:'ParamUnimpressed'};
export function inochiCapabilities(params:InochiParameter[]):InochiCapabilities{const ids=params.filter(p=>p.bindings.some(b=>b.values.some(row=>JSON.stringify(row)!==JSON.stringify(b.values[0])))).map(p=>p.name),has=(...names:string[])=>names.every(n=>ids.includes(n));const c:InochiCapabilities={type:'inochi-0.8-subset',parameters:ids,gaze:has('ParamAngleX','ParamAngleY'),breathing:has('ParamBreath'),blink:has('ParamEyeLOpen','ParamEyeROpen'),sleepEyes:has('ParamEyeLOpen','ParamEyeROpen'),typing:has('ParamTyping'),bounce:has('ParamBounce'),audio:has('ParamBodyAngleX','ParamBodyAngleY'),eating:has('ParamRiceBowlOpacity','ParamRiceArm','ParamCheekPuff','ParamMouthOpenY','ParamRicePoseSwitch','ParamRiceBiteOpacity'),moods:Object.keys(MOOD_PARAMETERS).filter(k=>has(MOOD_PARAMETERS[k])),warnings:[]};c.physicalInput=has(...PHYSICAL_PARAMETERS);for(const[k,label]of[['blink','眨眼/闭眼'],['typing','打字挥手'],['eating','饭碗/手臂/咀嚼']]as const)if(!c[k])c.warnings.push(`模型尚未绑定${label}`);if(c.moods.length<5)c.warnings.push('五种面部情绪尚未全部绑定');return c;}
/** Authored spoon cycle: scoop, lift, mouth pause, return. No time-of-day phase jump. */
export function inochiMealCycle(progress:number){const phase=((Math.max(0,progress)*6.5)%2.2)/2.2;const ease=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};const arm=phase<.18?0:phase<.48?ease((phase-.18)/.30):phase<.65?1:1-ease((phase-.65)/.35);const bite=phase<.54||phase>=.96?1:0;const mouth=phase>=.44&&phase<.56?Math.sin((phase-.44)/.12*Math.PI)*.75:0;const cheek=phase>=.54&&phase<.85?Math.abs(Math.sin((phase-.54)/.31*Math.PI*3))*.8:0;return{phase,arm,bite,mouth,cheek};}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
/** Pure mapping: only an authored bound parameter can receive values. Positive gaze y is screen-down. */
export function mapInochiFrame(f:Live2DFrame,params:InochiParameter[],c:InochiCapabilities):Record<string,number>{const out:Record<string,number>={};const set=(name:string,value:number)=>{const p=params.find(p=>p.name===name&&p.bindings.length);if(p)out[name]=clamp(value,p.min[0],p.max[0])};const quiet=f.sleeping||f.reducedMotion,t=f.timeSeconds;const eating=c.eating&&!quiet&&(f.eating||0)>0&&!f.hidingBowl;const sway=quiet?0:Math.sin(t*1.6),audio=quiet?0:clamp(f.audioLevel||0,0,1),bounce=quiet?0:clamp(f.bounce||0,0,1);set('ParamBreath',f.reducedMotion?0:(Math.sin(t*(f.sleeping?.7:1.5))+1)*.5);set('ParamAngleX',quiet||eating?0:(f.gaze?.x||0)*.7);set('ParamAngleY',quiet||eating?0:-(f.gaze?.y||0)*.7);set('ParamAngleZ',quiet||eating?0:sway*.1);set('ParamBodyAngleX',sway*(.06+audio*.3));set('ParamBodyAngleY',quiet?0:Math.sin(t*3)*audio*.25);set('ParamHairSway',sway*.25);set('ParamBounce',bounce);set('ParamTyping',quiet?0:clamp(f.typing||0,0,1)*(.62+.38*Math.sin(t*Math.PI*6)));set('ParamEyeBallX',quiet?0:(f.gaze?.x||0)*(eating?.35:1));set('ParamEyeBallY',quiet?0:-(f.gaze?.y||0)*(eating?.35:1));const phase=t%4.7;const blink=quiet||f.innocent?1:phase<.07?1-phase/.07:phase<.14?0:phase<.24?(phase-.14)/.1:1;const rest=f.innocent?1:({happy:1,shy:.82,aggrieved:.65,sleepy:.25,unimpressed:.5} as Record<string,number>)[f.mood||'happy']??1;set('ParamEyeLOpen',f.sleeping?0:blink*rest);set('ParamEyeROpen',f.sleeping?0:blink*rest);const meal=inochiMealCycle(f.eating||0);set('ParamRiceBowlOpacity',eating?1:0);set('ParamRicePoseSwitch',eating?1:0);set('ParamRiceBiteOpacity',eating?meal.bite:0);set('ParamRiceArm',eating?meal.arm:0);set('ParamCheekPuff',eating?meal.cheek:0);set('ParamMouthOpenY',f.sleeping||f.innocent?0:eating?meal.mouth:f.mood==='happy'&&c.moods.includes('happy')?.55:0);set('ParamMouthForm',f.sleeping||f.innocent?0:({happy:.65,shy:.25,aggrieved:-.65,sleepy:-.1,unimpressed:-.3} as Record<string,number>)[f.mood||'happy']??0);for(const[mood,name]of Object.entries(MOOD_PARAMETERS))set(name,!f.sleeping&&!f.innocent&&f.mood===mood?1:0);return out;}
/** Short eyelid closures receive a brief 20fps sampling window even during 5fps CPU idle. */
export function inochiFrameInterval(f:Live2DFrame,c:InochiCapabilities,software:boolean){if(f.sleeping||f.reducedMotion)return 500;if(c.blink&&f.timeSeconds%4.7<.28)return 50;if(f.typing||f.bounce||(f.audioLevel||0)>.01||f.eating||f.hidingBowl)return software?66:33;return software?200:100;}
export interface MealVisibility {visible:boolean;hidingSince:number|null;returnFrom:number;arm:number;bite:number}
export const emptyMealVisibility=():MealVisibility=>({visible:false,hidingSince:null,returnFrom:0,arm:0,bite:0});
/** Exactly one opaque hand set. A caught spoon returns for220ms, then switches atomically. */
export function stepMealVisibility(previous:MealVisibility,active:boolean,now:number,arm:number,bite:number,instant=false):MealVisibility{
 if(instant)return emptyMealVisibility();
 if(active)return{visible:true,hidingSince:null,returnFrom:arm,arm,bite};
 if(!previous.visible)return emptyMealVisibility();
 const started=previous.hidingSince??now,from=previous.hidingSince===null?previous.arm:previous.returnFrom;
 const p=Math.max(0,Math.min(1,(now-started)/220));if(p===1)return emptyMealVisibility();const eased=p*p*(3-2*p);
 return{visible:true,hidingSince:started,returnFrom:from,arm:from*(1-eased),bite:previous.bite};
}
export class InochiRenderer{
 private desk?:DeskScene;private lastDeskActive=-Infinity;private fullModelUrl='';
 activeScene:'full-body'|'desk'='full-body';activeModelUrl='';workCapabilities?:InochiCapabilities;transitioning=false;
 private mouseMotion=new MouseMotion();private lastInputSignal='';
 private device?:DeviceSurface;private deviceTexture=-1;private workHandIds=new Set<number>();private workUntil=0;private lastWork=false;private model?:SubsetModel;private mesh?:MeshRenderer;private generation=0;private lastDraw=-Infinity;private lastValues='';private width=320;private height=420;private mealVisibility=emptyMealVisibility();
 lastParameters:Record<string,number>={};
 capabilities?:InochiCapabilities;backend='not loaded';renderMilliseconds=0;
 constructor(private options:{canvas:HTMLCanvasElement;onStatus?:(status:InochiStatus)=>void}){}
 private status(s:InochiStatus){this.options.onStatus?.(s)}
 async load(request:InochiLoadRequest){
  const token=++this.generation;
  this.mesh?.destroy();this.mesh=undefined;this.model=undefined;this.desk=undefined;
  this.capabilities=undefined;this.workCapabilities=undefined;this.lastValues='';this.lastInputSignal='';
  this.mouseMotion.reset();this.lastParameters={};this.lastDraw=-Infinity;this.mealVisibility=emptyMealVisibility();this.lastDeskActive=-Infinity;
  if(request.rendererType!=='inochi-0.8-subset'){this.status({state:'error',message:'渲染器类型不匹配：Inochi 仅接受明确标注的 0.8 INP/INX'});return;}
  if(!request.modelUrl){this.status({state:'missing-model',message:'Inochi 模型尚未导入'});return;}
  this.status({state:'loading',message:'正在读取 Inochi 网格场景…'});
  try{
   const base=await readInochiAssets(request.modelUrl);
   if(token!==this.generation)return;
   this.model=base.model;this.capabilities=inochiCapabilities(base.model.params);this.fullModelUrl=request.modelUrl;
   this.activeModelUrl=request.modelUrl;this.activeScene='full-body';
   const textures=base.textures;
   this.device=undefined;this.deviceTexture=-1;this.workHandIds.clear();this.workUntil=0;this.lastWork=false;
   if(this.capabilities.physicalInput&&!request.workScene){
    this.device=new DeviceSurface();this.device.update(undefined);this.deviceTexture=textures.length;textures.push(this.device.texture);
    for(const[id,{n}]of base.model.nodes)if(['TypingHandL','TypingHandR','MouseHandR'].includes(n.name))this.workHandIds.add(id);
    if(this.workHandIds.size!==3)throw Error('模型缺少已绑定的工作手');
   }
   if(request.workScene){
    const response=await fetch(request.workScene.contractUrl);if(!response.ok)throw Error('工作场景契约读取失败');
    const contract=validateWorkContract(await response.json()),work=await readInochiAssets(request.workScene.modelUrl);
    if(token!==this.generation)return;
    const capabilities=inochiCapabilities(work.model.params);
    for(const name of requiredWorkParameters(contract))if(!capabilities.parameters.includes(name))throw Error('工作模型缺少真实绑定：'+name);
    const front=new Set<number>();
    for(const name of contract.frontNodes){const entry=[...work.model.nodes].find(([,v])=>v.n.name===name);if(!entry)throw Error('工作模型缺少层：'+name);front.add(entry[0]);}
    if(![...work.model.nodes.values()].some(v=>v.n.name===contract.mouse.bodyNode))throw Error('工作模型缺少真实鼠标');
    const textureOffset=textures.length;textures.push(...work.textures);
    const keyboard=new PerspectiveKeyboard(contract.keyboard.quad,contract.origin),keyboardTexture=textures.length;textures.push(keyboard.texture);
    capabilities.physicalInput=true;capabilities.typing=true;
    capabilities.gaze=['ParamEyeBallX','ParamEyeBallY'].every(name=>capabilities.parameters.includes(name));
    capabilities.warnings=[];
    if(['ParamEyeLOpen','ParamEyeROpen','ParamMouthOpenY','ParamMouthForm'].every(name=>capabilities.parameters.includes(name))){capabilities.moods=Object.keys(MOOD_PARAMETERS);capabilities.moodMode='eye-mouth';}
    this.workCapabilities=capabilities;
    this.desk={model:work.model,contract,pose:new WorkPose(contract),keyboard,textureOffset,keyboardTexture,front,capabilities,modelUrl:request.workScene.modelUrl};
   }
   const source={texture:(id:number)=>textures[id]};
   try{this.mesh=new InochiProofRenderer(this.options.canvas,source);this.backend=this.mesh.backend||'WebGL';}
   catch(error){if(!(error instanceof Error)||!error.message.includes('WebGL unavailable'))throw error;this.mesh=new SoftwareMeshRenderer(this.options.canvas,source);this.backend='CPU真实三角网格（节能限帧）';}
   this.resize(this.width,this.height);this.mesh.draw(this.compose(base.model.frame(),false));
   this.status({state:'ready',message:`Inochi · ${this.backend} · 全身${base.model.params.length}参数${this.desk?' / 工作'+this.desk.model.params.length+'参数':''}`,capabilities:this.capabilities});
  }catch(error){
   if(token!==this.generation)return;
   this.model=undefined;this.desk=undefined;this.capabilities=undefined;this.workCapabilities=undefined;
   (this.mesh as MeshRenderer|undefined)?.destroy();this.mesh=undefined;this.status({state:'error',message:String(error)});
  }
 }
 private updateDesk(f:Live2DFrame,now:number,opacity:number){
  const scene=this.desk!,software=this.backend.startsWith('CPU');
  const physical=this.mouseMotion.sample(f.physical,now,true);
  const values={...mapInochiFrame(f,scene.model.params,scene.capabilities),...scene.pose.values(physical)};
  if(scene.capabilities.parameters.includes('ParamMouthOpenY'))values.ParamMouthOpenY=(f.mood||'happy')==='happy'?(scene.contract.defaultFace.ParamMouthOpenY??1):f.mood==='shy'?.2:0;
  const signal=JSON.stringify([physical?.pressed,physical?.targets.keyboard,physical?.mouse.buttons,physical?.mouse.wheel]);
  const switched=this.activeScene!=='desk';
  this.activeScene='desk';this.activeModelUrl=scene.modelUrl;
  if(!switched&&signal===this.lastInputSignal&&now-this.lastDraw<(software?33:16))return;
  const key=JSON.stringify(values)+opacity;
  if(key===this.lastValues&&!switched)return;
  if(scene.keyboard.update(physical?.pressed||[]))this.mesh!.updateTexture?.(scene.keyboardTexture);
  const frame=scene.model.frame(values);
  frame.commands=frame.commands.map(command=>({...command,texture:command.texture+scene.textureOffset}));
  const composed=insertDeviceMesh(frame,scene.keyboard.mesh,scene.keyboardTexture,scene.front);
  composed.viewport={width:scene.contract.canvas[0],height:scene.contract.canvas[1],center:[0,0]};
  if(opacity<1)for(const command of composed.commands)command.opacity=(command.opacity??1)*opacity;
  const start=performance.now();this.mesh!.draw(composed);this.renderMilliseconds=performance.now()-start;
  this.lastDraw=now;this.lastValues=key;this.lastInputSignal=signal;this.lastParameters=values;
 }
 private compose(frame:import('../shared/inochi-runtime.mjs').InochiFrame,visible:boolean){return this.device?insertDeviceQuad(frame,this.deviceTexture,this.workHandIds,visible):frame;}
 resize(width:number,height:number){this.lastValues='';this.lastDraw=-Infinity;this.width=width;this.height=height;const dpr=this.backend.startsWith('CPU')?1:Math.min(2,devicePixelRatio||1);this.options.canvas.width=Math.round(width*dpr);this.options.canvas.height=Math.round(height*dpr)}
 update(f:Live2DFrame){
  if(!this.model||!this.mesh||!this.capabilities)return;
  const now=performance.now(),software=this.backend.startsWith('CPU');
  let sceneOpacity=1;
  if(this.desk){
   const blocked=!!(f.sleeping||f.reducedMotion||f.eating||f.hidingBowl);
   if(blocked)this.lastDeskActive=-Infinity;
   else if(f.physical?.pressed.length||f.physical?.targets.right==='mouse')this.lastDeskActive=now;
   const visibility=deskVisibility(this.lastDeskActive,now);this.transitioning=visibility.opacity<1;
   if(visibility.desk){try{this.updateDesk(f,now,visibility.opacity);}catch(error){this.status({state:'error',message:String(error)});this.model=undefined;}return;}
   sceneOpacity=visibility.opacity;
   if(this.activeScene!=='full-body'){this.lastDraw=-Infinity;this.lastValues='';this.mouseMotion.reset();}
   this.activeScene='full-body';this.activeModelUrl=this.fullModelUrl;
  }

  const values=mapInochiFrame(f,this.model.params,this.capabilities),active=(values.ParamRiceBowlOpacity??0)>0;
  if(this.desk&&'ParamTyping'in values)values.ParamTyping=0;
  const wasVisible=this.mealVisibility.visible;
  this.mealVisibility=stepMealVisibility(this.mealVisibility,active,now,values.ParamRiceArm??0,values.ParamRiceBiteOpacity??0,!!(f.sleeping||f.reducedMotion));
  const meal=this.mealVisibility;
  if('ParamRiceBowlOpacity'in values)values.ParamRiceBowlOpacity=meal.visible?1:0;
  if('ParamRicePoseSwitch'in values)values.ParamRicePoseSwitch=meal.visible?1:0;
  if('ParamRiceArm'in values)values.ParamRiceArm=meal.arm;
  if('ParamRiceBiteOpacity'in values)values.ParamRiceBiteOpacity=meal.bite;
  if(meal.visible)for(const name of ['ParamAngleX','ParamAngleY','ParamAngleZ'])if(name in values)values[name]=0;
  const physicalActive=!!(f.physical?.pressed.length||f.physical?.targets.right==='mouse');if(physicalActive)this.workUntil=now+600;
  const work=!this.desk&&!!this.capabilities.physicalInput&&!meal.visible&&!f.sleeping&&!f.reducedMotion&&(physicalActive||now<this.workUntil);
  const visualPhysical=this.mouseMotion.sample(f.physical,now,work);
  if(this.capabilities.physicalInput){Object.assign(values,physicalPose(visualPhysical,work));if(work)for(const name of ['ParamBodyAngleX','ParamBodyAngleY','ParamBounce','ParamBreath','ParamTyping'])if(name in values)values[name]=0;}
  const inputSignal=JSON.stringify([f.physical?.pressed,f.physical?.targets,f.physical?.mouse.buttons,f.physical?.mouse.wheel,f.mood,f.sleeping,f.reducedMotion]);
  const inputChanged=inputSignal!==this.lastInputSignal;
  const workChanged=work!==this.lastWork;this.lastWork=work;const interval=this.transitioning?(software?33:16):workChanged||inputChanged?0:work? (software?33:16):wasVisible!==meal.visible?0:meal.hidingSince!==null?50:inochiFrameInterval(f,this.capabilities,software);
  if(now-this.lastDraw<interval)return;
  const deviceChanged=this.device?.update(visualPhysical)??false;if(deviceChanged)this.mesh.updateTexture?.(this.deviceTexture);const key=JSON.stringify(values)+JSON.stringify(visualPhysical??null)+sceneOpacity;if(key===this.lastValues)return;const start=performance.now();
  try{const frame=this.compose(this.model.frame(values),work);if(sceneOpacity<1)for(const command of frame.commands)command.opacity=(command.opacity??1)*sceneOpacity;this.mesh.draw(frame);this.renderMilliseconds=performance.now()-start;this.lastDraw=now;this.lastValues=key;this.lastParameters={...values};this.lastInputSignal=inputSignal;}
  catch(e){this.status({state:'error',message:String(e)});this.model=undefined;this.capabilities=undefined;}
 }

 destroy(){this.generation++;this.mesh?.destroy();this.mesh=undefined;this.model=undefined;this.desk=undefined}
}
