import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioController, audioErrorMessage } from '../src/renderer/audio.js';
import { Live2DRenderer, validateModelSettings, validateRigManifest } from '../src/renderer/live2d.js';
const valid = { Version: 3, FileReferences: { Moc: 'Whale.moc3', Textures: ['textures/a.png'] } };
const url = 'app-model://bundle/Whale.model3.json';
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:Error)=>void; const promise=new Promise<T>((r,j)=>{resolve=r;reject=j}); return {promise,resolve,reject}; }
class Track {
  readyState='live'; stops=0; listeners=new Set<()=>void>();
  constructor(public kind='audio'){}
  stop(){this.readyState='ended';this.stops++;}
  addEventListener(_name:string, cb:()=>void){this.listeners.add(cb)}
  removeEventListener(_name:string, cb:()=>void){this.listeners.delete(cb)}
  end(){for(const cb of this.listeners)cb()}
}
function stream(...tracks:Track[]) {return {getTracks:()=>tracks,getAudioTracks:()=>tracks.filter(t=>t.kind==='audio')} as unknown as MediaStream;}
function environment() {
  const timers=new Map<number,()=>void>();let timerId=0;const contexts:Context[]=[];let captures=0;let displays=0;let lastConstraints:unknown;
  let mic=async (_options:unknown)=>stream(new Track());let display=async (_options:unknown)=>stream(new Track(),new Track('video'));
  class Context {
    state='suspended';closed=0;disconnected=0;connected=0;
    constructor(){contexts.push(this)}
    createAnalyser(){return {fftSize:1024,smoothingTimeConstant:0,getFloatTimeDomainData:(samples:Float32Array)=>samples.fill(.1),disconnect:()=>this.disconnected++}}
    createMediaStreamSource(_stream:MediaStream){return {connect:(_analyser:unknown)=>this.connected++,disconnect:()=>this.disconnected++}}
    async resume(){this.state='running'}async close(){this.state='closed';this.closed++}
  }
  Object.defineProperty(globalThis,'AudioContext',{value:Context,configurable:true});
  Object.defineProperty(globalThis,'window',{value:{setTimeout:(cb:()=>void,_ms:number)=>{timers.set(++timerId,cb);return timerId},clearTimeout:(id:number)=>timers.delete(id)},configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:(options:unknown)=>{captures++;lastConstraints=options;return mic(options)},getDisplayMedia:(options:unknown)=>{displays++;lastConstraints=options;return display(options)},enumerateDevices:async()=>[{kind:'audioinput',deviceId:'abc',label:''},{kind:'videoinput',deviceId:'cam',label:'Camera'}]}},configurable:true});
  return {timers,contexts,setMic:(fn:typeof mic)=>{mic=fn},setDisplay:(fn:typeof display)=>{display=fn},get captures(){return captures},get displays(){return displays},get constraints(){return lastConstraints}};
}
test('validates model and local-only assets',()=>{
  assert.equal(validateModelSettings(valid,url),valid);
  for(const path of ['https://example.com/a.moc3','../a.moc3','%2e%2e/a.moc3','//example.com/a.moc3','C:\\a.moc3','a.moc3?x','a.moc3#frag']) assert.throws(()=>validateModelSettings({Version:3,FileReferences:{Moc:path,Textures:['a.png']}},url));
  assert.throws(()=>validateModelSettings(valid,'https://example.com/Whale.model3.json'));
  assert.throws(()=>validateModelSettings({...valid,Version:2},url));
  assert.throws(()=>validateModelSettings({Version:3,FileReferences:{Moc:'a.moc3',Textures:[]}},url));
  assert.throws(()=>validateModelSettings({Version:3,FileReferences:{Moc:'a.moc3',Textures:['a.png'],Motions:{Idle:[{File:'https://bad/motion.json'}]}}},url));
});
test('validates bounded semantic manifest',()=>{
  assert.deepEqual(validateRigManifest(null),{version:1});
  assert.equal(validateRigManifest({version:1,parameters:{riceArm:'Arm'},motions:{eat:{group:'Meal',index:0}}}).parameters?.riceArm,'Arm');
  for(const manifest of [{version:2},{version:1,parameters:{unknown:'X'}},{version:1,motions:{eat:{group:'Eat',index:-1}}},{version:1,expressions:{x:45}}]) assert.throws(()=>validateRigManifest(manifest));
});
test('renderer reports missing requirements without importing/fetching Core',async()=>{
  const renderer=new Live2DRenderer({canvas:{clientWidth:300,clientHeight:400} as HTMLCanvasElement});
  assert.equal((await renderer.load({})).state,'missing-model');
  assert.equal((await renderer.load({modelUrl:url,coreAvailable:false})).state,'missing-runtime');
  assert.equal((await renderer.load({modelUrl:'https://bad/Whale.model3.json'})).state,'error');
  renderer.destroy();
  assert.equal((await renderer.load({modelUrl:url})).state,'error');
});
test('microphone is opt-in, exact device, 20Hz meter, immediate stop',async()=>{
  const e=environment();const track=new Track();e.setMic(async()=>stream(track));const levels:number[]=[];
  const controller=new AudioController({onLevel:v=>levels.push(v)});assert.equal(e.captures,0);
  assert.equal((await controller.start({kind:'microphone',deviceId:'chosen'})).state,'active');
  assert.equal((e.constraints as any).audio.deviceId.exact,'chosen');
  assert.equal(e.timers.size,1);[...e.timers.values()][0]();assert.ok(levels.at(-1)!>0);
  const stopped=controller.stop();assert.equal(track.stops,1);assert.equal(e.contexts[0].closed,1);await stopped;
  assert.equal(controller.state.state,'off');assert.equal(levels.at(-1),0);assert.equal(e.contexts[0].disconnected,2);
});
test('system stream lacking audio stops all capture with no microphone fallback',async()=>{
  const e=environment();const video=new Track('video');e.setDisplay(async()=>stream(video));
  const controller=new AudioController();const result=await controller.start({kind:'system'});
  assert.equal(result.state,'error');assert.match(result.message,/没有音轨/);assert.equal(video.stops,1);assert.equal(e.captures,0);assert.equal(e.displays,1);
});
test('source switch synchronously stops previous audio and video before new prompt',async()=>{
  const e=environment();const oldA=new Track(),oldV=new Track('video');e.setDisplay(async()=>stream(oldA,oldV));
  const controller=new AudioController();await controller.start({kind:'system'});
  const pending=deferred<MediaStream>();e.setMic(()=>{assert.equal(oldA.stops,1);assert.equal(oldV.stops,1);return pending.promise});
  const start=controller.start({kind:'microphone'});const next=new Track();pending.resolve(stream(next));await start;
  assert.equal(controller.state.source,'microphone');assert.equal(e.contexts[0].closed,1);await controller.destroy();assert.equal(next.stops,1);
});
test('Off while permission is pending discards late grant',async()=>{
  const e=environment();const pending=deferred<MediaStream>();e.setMic(()=>pending.promise);const controller=new AudioController();
  const start=controller.start({kind:'microphone'});await controller.stop();const track=new Track();pending.resolve(stream(track));await start;
  assert.equal(track.stops,1);assert.equal(controller.state.state,'off');assert.equal(e.contexts.length,0);
});
test('overlapping source grants keep only newest session',async()=>{
  const e=environment();const pending=deferred<MediaStream>();e.setMic(()=>pending.promise);const newest=new Track(),video=new Track('video');e.setDisplay(async()=>stream(newest,video));
  const controller=new AudioController();const old=controller.start({kind:'microphone'});await controller.start({kind:'system'});const stale=new Track();pending.resolve(stream(stale));await old;
  assert.equal(stale.stops,1);assert.equal(newest.stops,0);assert.equal(controller.state.source,'system');await controller.stop();assert.equal(newest.stops,1);assert.equal(video.stops,1);
});
test('user ending a source stops every track and closes context',async()=>{
  const e=environment();const audio=new Track(),video=new Track('video');e.setDisplay(async()=>stream(audio,video));const controller=new AudioController();await controller.start({kind:'system'});video.end();
  assert.equal(controller.state.state,'off');assert.equal(audio.stops,1);assert.equal(video.stops,1);assert.equal(e.contexts[0].closed,1);
});
test('permission rejection and device list remain explicit',async()=>{
  const e=environment();e.setMic(async()=>{throw new DOMException('denied','NotAllowedError')});const controller=new AudioController();const inputs=await controller.listInputs();
  assert.equal(e.captures,0);assert.equal(inputs.length,1);assert.match(inputs[0].label,/授权后/);
  assert.equal((await controller.start({kind:'microphone'})).state,'error');assert.match(controller.state.message,/未获授权/);
  assert.match(audioErrorMessage(new DOMException('missing','OverconstrainedError'),'microphone'),/重新选择/);
});
function rig(ids: string[]) {
  const values = new Map<string, number>();
  const motions: string[] = [];
  const expressions: string[] = [];
  let stopCount = 0;
  const renderer = new Live2DRenderer({canvas:{clientWidth:300,clientHeight:400} as HTMLCanvasElement}) as any;
  renderer.model = {
    internalModel: {
      coreModel: {
        getModel: () => ({parameters:{ids,minimumValues:ids.map(()=>0),maximumValues:ids.map(()=>1),defaultValues:ids.map(()=>0)}}),
        setParameterValueById: (id:string,value:number) => {assert.ok(ids.includes(id));values.set(id,value)},
      },
      motionManager: {groups:{idle:'Idle'},stopAllMotions:()=>{stopCount++},expressionManager:{resetExpression:()=>undefined}},
    },
    expression: async (name:string) => {expressions.push(name);return true},
    motion: async (name:string) => {motions.push(name);return true},
  };
  const settings = {FileReferences:{Moc:'whale.moc3',Textures:['a.png'],Expressions:[{Name:'Happy',File:'happy.json'}],Motions:{Typing:[{File:'typing.json'}],Bounce:[{File:'bounce.json'}],Eat:[{File:'eat.json'}]}}};
  renderer.manifest = {version:1,expressions:{happy:'Happy'},motions:{typing:{group:'Typing'},bounce:{group:'Bounce'},eat:{group:'Eat'}}};
  renderer.collectCapabilities(settings);
  return {renderer,values,motions,expressions,get stopCount(){return stopCount}};
}
const rigIds=['ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamBodyAngleY','ParamBreath','ParamEyeBallX','ParamEyeBallY','ParamEyeLOpen','ParamEyeROpen','ParamMouthOpenY','ParamMouthForm','ParamTyping','ParamBounce','ParamRiceBowlOpacity','ParamRiceArm','ParamCheekPuff'];
test('rig capability detection requires all actual eating parameters',()=>{
  const full=rig(rigIds);assert.equal(full.renderer.capabilities.eating.supported,true);
  const partial=rig(rigIds.filter(id=>id!=='ParamRiceArm'));
  assert.equal(partial.renderer.capabilities.eating.supported,false);
  assert.deepEqual(partial.renderer.capabilities.eating.missing,['ParamRiceArm']);
  partial.renderer.frame={timeSeconds:1,deltaSeconds:.03,eating:.5};partial.renderer.driveParameters();
  assert.equal(partial.values.get('ParamRiceBowlOpacity'),0);assert.equal(partial.values.get('ParamCheekPuff'),0);
});
test('authored motions trigger on rising input, not every frame',()=>{
  const r=rig(rigIds);r.renderer.frame={mood:'happy',typing:1,bounce:1,eating:.5};
  r.renderer.triggerAnimations();r.renderer.triggerAnimations();r.renderer.triggerAnimations();
  assert.deepEqual(r.motions,['Typing','Bounce','Eat']);assert.deepEqual(r.expressions,['Happy']);
  r.renderer.frame={mood:'happy',typing:0,bounce:0,eating:0};r.renderer.triggerAnimations();
  r.renderer.frame={mood:'happy',typing:1,bounce:1,eating:.5};r.renderer.triggerAnimations();
  assert.deepEqual(r.motions,['Typing','Bounce','Eat','Typing','Bounce','Eat']);
});
test('reduced motion and sleep suppress audio, typing, bounce and eating even with smoothing tail',()=>{
  for(const suppression of [{reducedMotion:true},{sleeping:true}]) {
    const r=rig(rigIds);r.renderer.smooth={gazeX:.8,gazeY:.5,typing:1,audio:1,bounce:1};
    r.renderer.frame={timeSeconds:1,deltaSeconds:.03,typing:1,bounce:1,audioLevel:1,eating:.5,...suppression};
    r.renderer.triggerAnimations();r.renderer.driveParameters();
    assert.equal(r.values.get('ParamTyping'),0);assert.equal(r.values.get('ParamBounce'),0);assert.equal(r.values.get('ParamMouthOpenY'),0);
    assert.equal(r.values.get('ParamRiceBowlOpacity'),0);assert.equal(r.values.get('ParamRiceArm'),0);assert.equal(r.values.get('ParamCheekPuff'),0);
    assert.equal(r.motions.length,0);assert.equal(r.stopCount,1);
  }
});
test('hide-bowl signal suppresses rice while harmless mood stays visible',()=>{
  const r=rig(rigIds);r.renderer.frame={timeSeconds:1,deltaSeconds:.03,eating:.5,hidingBowl:true,innocent:true};r.renderer.driveParameters();
  assert.equal(r.values.get('ParamRiceBowlOpacity'),0);assert.equal(r.values.get('ParamRiceArm'),0);assert.ok(r.values.get('ParamMouthForm')!>0);
});

test('manifest parameter ownership and mood eye openness validate explicitly',()=>{
  const m=validateRigManifest({version:1,parameterOwnership:{eyeLOpen:'adapter',mouthForm:'expression',angleX:'model'},moodEyeOpen:{sleepy:.42,unimpressed:.55},expressions:{sleeping:'Sleeping'}});
  assert.equal(m.parameterOwnership?.mouthForm,'expression');assert.equal(m.moodEyeOpen?.sleepy,.42);
  for(const input of [{parameterOwnership:{eyeLOpen:'whatever'}},{parameterOwnership:{unknown:'model'}},{parameterOwnership:{eyeLOpen:['adapter']}},{parameterOwnership:{eyeLOpen:{toString:()=> 'adapter'}}},{moodEyeOpen:{happy:NaN}},{moodEyeOpen:{happy:1.2}},{moodEyeOpen:[]}])assert.throws(()=>validateRigManifest({version:1,...input}));
});
test('active exp3 does not disable adapter-owned eyelid blink',async()=>{
  const r=rig(rigIds);r.renderer.frame={timeSeconds:.08,deltaSeconds:.03,mood:'happy'};r.renderer.triggerAnimations();await Promise.resolve();r.renderer.driveParameters();
  assert.equal(r.renderer.activeExpression,'Happy');assert.equal(r.values.get('ParamEyeLOpen'),0);assert.equal(r.values.get('ParamEyeROpen'),0);
  assert.equal(r.values.has('ParamMouthForm'),false,'authored mouth form retained');
  r.renderer.frame={timeSeconds:.3,deltaSeconds:.03,mood:'happy'};r.renderer.driveParameters();assert.equal(r.values.get('ParamEyeLOpen'),1);
});
test('sleepy resting openness is configurable while true sleeping always closes eyes',()=>{
  const r=rig(rigIds);r.renderer.manifest.moodEyeOpen={sleepy:.31};r.renderer.activeExpression='Sleepy';
  r.renderer.frame={timeSeconds:1,deltaSeconds:.03,mood:'sleepy'};r.renderer.driveParameters();assert.equal(r.values.get('ParamEyeLOpen'),.31);
  r.renderer.manifest.parameterOwnership={eyeLOpen:'model',eyeROpen:'expression'};
  r.renderer.frame={timeSeconds:1,deltaSeconds:.03,mood:'sleepy',sleeping:true};r.renderer.driveParameters();assert.equal(r.values.get('ParamEyeLOpen'),0);assert.equal(r.values.get('ParamEyeROpen'),0);
});
test('Sleeping expression is distinct from Sleepy across sleep and wake transitions',()=>{
  const r=rig(rigIds);r.renderer.manifest.expressions={sleepy:'Sleepy',sleeping:'Sleeping'};r.renderer.availableExpressions=new Set(['Sleepy','Sleeping']);
  r.renderer.frame={mood:'sleepy'};r.renderer.triggerAnimations();
  r.renderer.frame={mood:'sleepy',sleeping:true};r.renderer.triggerAnimations();
  r.renderer.frame={mood:'sleepy',sleeping:false};r.renderer.triggerAnimations();
  assert.deepEqual(r.expressions,['Sleepy','Sleeping','Sleepy']);
});
test('without Sleeping expression sleeping resets rather than reusing half-open Sleepy',()=>{
  const r=rig(rigIds);r.renderer.manifest.expressions={sleepy:'Sleepy'};r.renderer.availableExpressions=new Set(['Sleepy']);
  r.renderer.frame={mood:'sleepy'};r.renderer.triggerAnimations();r.renderer.frame={mood:'sleepy',sleeping:true};r.renderer.triggerAnimations();
  assert.equal(r.renderer.activeExpression,'');assert.deepEqual(r.expressions,['Sleepy']);
});
test('model-owned role is not overwritten; ownership removes adapter feature claims',()=>{
  const r=rig(rigIds);r.renderer.manifest.parameterOwnership={riceArm:'model',eyeLOpen:'expression',eyeROpen:'model',angleX:'model'};
  r.renderer.collectCapabilities({FileReferences:{Moc:'x.moc3',Textures:['a.png']}});
  assert.equal(r.renderer.capabilities.eating.supported,false);assert.deepEqual(r.renderer.capabilities.eating.externallyOwned,['ParamRiceArm']);
  assert.equal(r.renderer.capabilities.blink.supported,false);assert.equal(r.renderer.capabilities.sleepEyes.supported,true);
  r.renderer.frame={timeSeconds:1,deltaSeconds:.03,eating:1};r.renderer.driveParameters();
  assert.equal(r.values.has('ParamAngleX'),false);assert.equal(r.values.has('ParamRiceArm'),false);
});
test('rice concealment fades finitely instead of disappearing in one frame',()=>{
  const r=rig(rigIds);
  for(let i=0;i<8;i++){r.renderer.frame={timeSeconds:1+i*.03,deltaSeconds:.03,eating:.5};r.renderer.driveParameters();}
  assert.equal(r.values.get('ParamRiceBowlOpacity'),1);
  r.renderer.frame={timeSeconds:1.3,deltaSeconds:.03,eating:.5,hidingBowl:true,innocent:true};r.renderer.driveParameters();
  const first=r.values.get('ParamRiceBowlOpacity')!;assert.ok(first>0 && first<1);
  assert.equal(r.values.get('ParamMouthOpenY'),0,'feeding stops immediately');
  let previous=first;
  for(let i=0;i<8;i++){r.renderer.frame={timeSeconds:1.33+i*.03,deltaSeconds:.03,hidingBowl:true};r.renderer.driveParameters();const v=r.values.get('ParamRiceBowlOpacity')!;assert.ok(v<=previous);previous=v;}
  assert.equal(previous,0);assert.equal(r.values.get('ParamRiceArm'),0);assert.equal(r.values.get('ParamCheekPuff'),0);
});
test('sleep/reduced motion immediately suppress an already visible bowl',()=>{
  for(const suppression of [{sleeping:true},{reducedMotion:true}]){
    const r=rig(rigIds);r.renderer.bowlOpacity=1;r.renderer.lastRiceArm=1;r.renderer.lastCheekPuff=1;
    r.renderer.frame={timeSeconds:1,deltaSeconds:.03,eating:1,...suppression};r.renderer.driveParameters();
    assert.equal(r.values.get('ParamRiceBowlOpacity'),0);assert.equal(r.values.get('ParamRiceArm'),0);assert.equal(r.values.get('ParamCheekPuff'),0);
  }
});
test('conflicting semantic aliases cannot fight over one real parameter',()=>{
  const r=rig(rigIds);r.renderer.manifest.parameters={riceBowl:'ParamEyeLOpen'};
  r.renderer.collectCapabilities({FileReferences:{Moc:'x.moc3',Textures:['a.png']}});
  assert.equal(r.renderer.capabilities.eating.supported,false);assert.equal(r.renderer.capabilities.blink.supported,false);
  assert.match(r.renderer.capabilities.warnings.join(' '),/冲突/);
  r.renderer.frame={timeSeconds:1,deltaSeconds:.03,eating:1};r.renderer.driveParameters();assert.equal(r.values.has('ParamEyeLOpen'),false);
});

function asyncExpressionRig() {
  const r=rig(rigIds), happy=deferred<unknown>(), shy=deferred<unknown>();
  const defaults={}, manager={defaultExpression:defaults,currentExpression:defaults as unknown,reserveExpressionIndex:-1,expressions:[] as unknown[],getExpressionIndex:(name:string)=>['Happy','Shy'].indexOf(name),resetExpression:()=>undefined,stopAllExpressions:()=>undefined};
  r.renderer.model.internalModel.motionManager.expressionManager=manager;
  r.renderer.manifest.expressions={happy:'Happy',shy:'Shy'};r.renderer.availableExpressions=new Set(['Happy','Shy']);
  r.renderer.model.expression=async(name:string)=>{
    const i=manager.getExpressionIndex(name);
    if(manager.expressions[i] && manager.expressions[i]===manager.currentExpression)return false;
    manager.reserveExpressionIndex=i;
    const value=await [happy,shy][i].promise;
    if(!value || manager.reserveExpressionIndex!==i)return false;
    manager.expressions[i]=value;manager.currentExpression=value;manager.reserveExpressionIndex=-1;return true;
  };
  return {...r,manager,happy,shy};
}
const flushExpression=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
test('failed expression releases expression-owned fallback and reports warning',async()=>{
  for(const reject of [false,true]){
    const r=asyncExpressionRig();r.renderer.frame={mood:'happy',timeSeconds:1,deltaSeconds:.03};r.renderer.triggerAnimations();
    assert.equal(r.renderer.activeExpression,'','pending does not claim applied expression');
    if(reject)r.happy.reject(new Error('missing exp3'));else r.happy.resolve(null);
    await flushExpression();r.renderer.driveParameters();
    assert.equal(r.renderer.activeExpression,'');assert.ok(r.values.has('ParamMouthForm'));assert.match(r.renderer.capabilities.warnings.join(' '),/加载失败/);
  }
});
test('late Happy cannot override sleep with no Sleeping mapping',async()=>{
  const r=asyncExpressionRig();r.renderer.frame={mood:'happy'};r.renderer.triggerAnimations();assert.equal(r.manager.reserveExpressionIndex,0);
  r.renderer.frame={mood:'happy',sleeping:true};r.renderer.triggerAnimations();assert.equal(r.manager.reserveExpressionIndex,-1);
  r.happy.resolve({name:'Happy'});await flushExpression();
  assert.equal(r.manager.currentExpression,r.manager.defaultExpression);assert.equal(r.renderer.activeExpression,'');
});
test('superseded expression cannot take ownership away from newer mood',async()=>{
  const r=asyncExpressionRig();r.renderer.frame={mood:'happy'};r.renderer.triggerAnimations();
  r.renderer.frame={mood:'shy'};r.renderer.triggerAnimations();r.happy.resolve({name:'Happy'});await flushExpression();assert.equal(r.renderer.activeExpression,'');
  const shy={name:'Shy'};r.shy.resolve(shy);await flushExpression();assert.equal(r.renderer.activeExpression,'Shy');assert.equal(r.manager.currentExpression,shy);
});
test('false for already-current expression remains a legitimate active expression',async()=>{
  const r=asyncExpressionRig(),value={name:'Happy'};r.manager.expressions[0]=value;r.manager.currentExpression=value;
  r.renderer.frame={mood:'happy'};r.renderer.triggerAnimations();await flushExpression();
  assert.equal(r.renderer.activeExpression,'Happy');assert.equal(r.renderer.capabilities.warnings.length,0);
});
test('late idle is stopped before any subsequent suppressed model update',async()=>{
  for(const suppression of [{sleeping:true},{reducedMotion:true}]){
    const r=rig(rigIds), pending=deferred<boolean>();let running=false,motionFrames=0;
    r.renderer.model.internalModel.motionManager.stopAllMotions=()=>{running=false};
    r.renderer.app={render:()=>undefined};
    r.renderer.model.update=()=>{if(running)motionFrames++;r.renderer.driveParameters()};
    const late=pending.promise.then(()=>{running=true});
    r.renderer.update({timeSeconds:1,deltaSeconds:.03,...suppression});
    pending.resolve(true);await late;assert.equal(running,true,'emulates late upstream idle load');
    r.renderer.update({timeSeconds:1.03,deltaSeconds:.03,...suppression});
    assert.equal(running,false);assert.equal(motionFrames,0);
  }
});
