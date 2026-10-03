import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {GlobalInput,type CoarseInput} from '../src/main/input';
import {cleanSettings,loadSettings,saveSettings} from '../src/main/config';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
class Hook extends EventEmitter{started=false;start(){this.started=true;}stop(){this.started=false;}}
const bounds=()=>({x:0,y:0,width:320,height:420});
test('default ON and explicit ON/OFF survives restart; legacy forced OFF migrates once',t=>{const dir=mkdtempSync(join(tmpdir(),'whale-input-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'settings.json');assert.equal(loadSettings(path).globalInputEnabled,true);writeFileSync(path,JSON.stringify({globalInputEnabled:false}));assert.equal(loadSettings(path).globalInputEnabled,true);for(const choice of [false,true,false]){saveSettings(path,cleanSettings({globalInputEnabled:choice,inputPreferenceVersion:1}));assert.equal(loadSettings(path).globalInputEnabled,choice);}});
test('missing permission preserves mouse and coarse counters; stop discards state',async()=>{let point={x:0,y:0};let loaded=false;const events:CoarseInput[]=[];const input=new GlobalInput(e=>events.push(e),bounds,{trusted:()=>false,point:()=>point,loadHook:async()=>{loaded=true;return new Hook();}});try{const status=await input.start();assert.equal(status.pointer,true);assert.equal(status.keyboard,false);assert.equal(loaded,false);point={x:300,y:400};await new Promise(r=>setTimeout(r,70));assert.equal(events[0].kind,'pointer');assert.deepEqual(Object.keys(events[0]).sort(),['gaze','kind']);assert.equal(input.snapshot().counts.pointer,1);}finally{input.stop();}assert.equal(input.snapshot().active,false);assert.equal(input.snapshot().counts.pointer,0);});
test('hook events strip all payload; load failure retains mouse; retry recovers',async()=>{let fail=true;const hook=new Hook();const events:CoarseInput[]=[];const input=new GlobalInput(e=>events.push(e),bounds,{trusted:()=>true,point:()=>({x:0,y:0}),loadHook:async()=>{if(fail)throw new Error('fixture unavailable');return hook;}});try{let status=await input.start();assert.equal(status.pointer,true);assert.equal(status.keyboard,false);fail=false;status=await input.start();assert.equal(status.keyboard,true);hook.emit('keydown',{keycode:123,text:'never retain'});hook.emit('mousedown',{button:1,x:200,y:200});assert.deepEqual(events,[{kind:'typing'},{kind:'click'}]);assert.equal(input.snapshot().counts.typing,1);hook.emit('error',new Error('fixture'));assert.equal(input.snapshot().keyboard,false);assert.equal(input.snapshot().pointer,true);}finally{input.stop();}assert.equal(hook.listenerCount('keydown'),0);});
import {createPetState,reducePetState,getPetView,DEFAULT_SETTINGS} from '../src/shared/domain';
test('coarse input reaches domain typing and gaze; closing during load cannot restart hook',async()=>{const hook=new Hook();let point={x:0,y:0};let state=createPetState(0);const context={now:100,date:new Date('2026-10-03T12:00:00Z'),rng:()=>.5};const input=new GlobalInput(e=>{state=reducePetState(state,{type:'activity',kind:e.kind},DEFAULT_SETTINGS,context);if(e.gaze)state=reducePetState(state,{type:'gaze',...e.gaze},DEFAULT_SETTINGS,context);},bounds,{trusted:()=>true,point:()=>point,loadHook:async()=>hook});try{await input.start();hook.emit('keydown');assert.equal(getPetView(state,DEFAULT_SETTINGS,context).typing,true);point={x:500,y:400};hook.emit('mousemove',point);assert.ok(getPetView(state,DEFAULT_SETTINGS,context).gaze.x>0);await input.start();assert.equal(hook.listenerCount('keydown'),1);}finally{input.stop();}let resolve!:(h:Hook)=>void;const delayed=new GlobalInput(()=>{},bounds,{trusted:()=>true,point:()=>point,loadHook:()=>new Promise(r=>resolve=r)});const starting=delayed.start();delayed.stop();resolve(hook);await starting;assert.equal(hook.started,false);assert.equal(delayed.snapshot().active,false);});
test('native component startup is not falsely reported as observed keyboard activity',async()=>{const hook=new Hook();const reports:any[]=[];const input=new GlobalInput(()=>{},bounds,{trusted:()=>true,point:()=>({x:0,y:0}),loadHook:async()=>hook},s=>reports.push(s));try{const status=await input.start();assert.equal(status.keyboard,true);assert.equal(status.keyboardObserved,false);assert.match(status.message,/尚未收到实际按键/);hook.emit('mousedown');assert.equal(input.snapshot().keyboardObserved,false);hook.emit('keydown',{keycode:55,rawcode:900,text:'never store'});assert.equal(input.snapshot().keyboardObserved,true);assert.equal(reports.at(-1).keyboardObserved,true);assert.equal(input.snapshot().counts.typing,1);assert.equal(JSON.stringify(input.snapshot()).includes('never store'),false);await input.start();assert.equal(input.snapshot().keyboardObserved,false);}finally{input.stop();}});

test('permission prompt dismissal survives restart without changing desired input ON',t=>{const dir=mkdtempSync(join(tmpdir(),'whale-permission-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'settings.json');assert.equal(loadSettings(path).inputPermissionPromptSeen,false);saveSettings(path,cleanSettings({inputPreferenceVersion:1,globalInputEnabled:true,inputPermissionPromptSeen:true}));assert.equal(loadSettings(path).inputPermissionPromptSeen,true);assert.equal(loadSettings(path).globalInputEnabled,true);});
import keyboardLayout from '../assets/keyboard.layout.json';
test('native hook adapter preserves every allowed physical down/up and clears lifecycle state',async()=>{const hook=new Hook();let trusted=true;let cursor={x:0,y:0};const snapshots:any[]=[];const input=new GlobalInput(()=>{},bounds,{trusted:()=>trusted,point:()=>cursor,pointerSpace:()=>({x:-100,y:0,width:200,height:100}),loadHook:async()=>hook},()=>{},s=>snapshots.push(s));try{await input.start();for(const k of keyboardLayout.keys){hook.emit('keydown',{keycode:k.nativeCode,rawcode:987,text:'discard'});assert.deepEqual(input.physicalSnapshot().pressed,[k.id]);hook.emit('keyup',{keycode:k.nativeCode});assert.deepEqual(input.physicalSnapshot().pressed,[])}hook.emit('mousedown',{button:1});assert.equal(input.physicalSnapshot().mouse.buttons.left,true);hook.emit('mouseup',{button:1});assert.equal(input.physicalSnapshot().mouse.buttons.left,false);hook.emit('wheel',{direction:3,rotation:-2});assert.equal(input.physicalSnapshot().mouse.wheel.y,-1);cursor={x:50,y:25};hook.emit('mousemove',cursor);assert.equal(input.physicalSnapshot().mouse.x,.5);assert.equal(input.physicalSnapshot().mouse.y,-.5);hook.emit('keydown',{keycode:keyboardLayout.keys[0].nativeCode});input.stop();assert.deepEqual(input.physicalSnapshot().pressed,[]);assert.equal(JSON.stringify(snapshots).includes('discard'),false);assert.equal(JSON.stringify(snapshots).includes('987'),false);}finally{input.stop();}});
test('native mouse movement overrides a stale OS polling position without retaining a trail',async()=>{const hook=new Hook();const input=new GlobalInput(()=>{},bounds,{trusted:()=>true,point:()=>({x:0,y:0}),pointerSpace:()=>({x:0,y:0,width:1000,height:1000}),loadHook:async()=>hook});try{await input.start();hook.emit('mousemove',{x:750,y:250});await new Promise(r=>setTimeout(r,45));assert.equal(input.physicalSnapshot().mouse.x,.5);assert.equal(input.physicalSnapshot().mouse.y,-.5);hook.emit('mousemove',{x:250,y:750});await new Promise(r=>setTimeout(r,45));assert.equal(input.physicalSnapshot().mouse.x,-.5);assert.equal(input.physicalSnapshot().mouse.y,.5);assert.equal(input.snapshot().counts.pointer,2);}finally{input.stop();}});
test('native Windows pixel conversion occurs before multi-screen normalization',async()=>{const hook=new Hook();const input=new GlobalInput(()=>{},bounds,{trusted:()=>true,point:()=>({x:0,y:0}),normalizeNativePoint:p=>({x:p.x/2,y:p.y/2}),pointerSpace:()=>({x:-500,y:0,width:1000,height:500}),loadHook:async()=>hook});try{await input.start();hook.emit('mousemove',{x:500,y:500});await new Promise(r=>setTimeout(r,45));assert.equal(input.physicalSnapshot().mouse.x,.5);assert.equal(input.physicalSnapshot().mouse.y,0);}finally{input.stop();}});

import type {TestContext} from 'node:test';
import type {PhysicalInputSnapshot} from '../src/shared/physical-input';
function timedInput(t:TestContext){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const hook=new Hook();let trusted=true,point={x:0,y:0},polls=0,checks=0;
 const states:{at:number;state:PhysicalInputSnapshot}[]=[],events:CoarseInput[]=[];
 const input=new GlobalInput(e=>events.push(e),bounds,{
  trusted:()=>{checks++;return trusted;},point:()=>{polls++;return point;},
  pointerSpace:()=>({x:0,y:0,width:1000,height:1000}),loadHook:async()=>hook,
 },()=>{},state=>states.push({at:Date.now(),state}));
 t.after(()=>input.stop());
 return{hook,input,states,events,tick:(ms:number)=>t.mock.timers.tick(ms),
  setTrust:(value:boolean)=>{trusted=value;},setPoint:(value:{x:number;y:number})=>{point=value;},
  polls:()=>polls,checks:()=>checks};
}
const nativeCode=(id:string)=>keyboardLayout.keys.find(key=>key.id===id)!.nativeCode;

test('first native move publishes synchronously; a burst publishes only its latest point at 16 ms',async t=>{
 const f=timedInput(t);await f.input.start();f.states.length=0;
 f.hook.emit('mousemove',{x:100,y:200,text:'discard'});
 assert.equal(f.states.length,1);assert.equal(f.states[0].at,1000);
 assert.equal(f.states[0].state.mouse.x,-.8);
 f.tick(1);f.hook.emit('mousemove',{x:200,y:300});
 f.tick(5);f.hook.emit('mousemove',{x:900,y:800});
 f.tick(9);assert.equal(f.states.length,1);
 f.tick(1);assert.equal(f.states.length,2);
 assert.equal(f.states[1].at,1016);assert.equal(f.states[1].state.mouse.x,.8);
 assert.equal(f.states[1].state.mouse.y,.6000000000000001);
 assert.equal(f.input.snapshot().counts.pointer,2);
 f.tick(30);f.hook.emit('mousemove',{x:750,y:750});
 assert.equal(f.states.length,3);assert.equal(f.states[2].at,1046);
 assert.equal(JSON.stringify(f.states).includes('discard'),false);
});

test('sustained high-rate moves stay coalesced to 16 ms and deliver the final point',async t=>{
 const f=timedInput(t);await f.input.start();f.states.length=0;
 for(let i=1;i<=50;i++){f.hook.emit('mousemove',{x:i,y:i});f.tick(1);}
 f.tick(14);
 assert.deepEqual(f.states.map(s=>s.at),[1000,1016,1032,1048,1064]);
 assert.equal(f.states.at(-1)!.state.mouse.x,-.9);
 assert.equal(f.polls(),1);
});

test('discrete transitions are immediate barriers; pending movement cannot supersede a newer key',async t=>{
 const f=timedInput(t);await f.input.start();
 f.hook.emit('mousemove',{x:100,y:100});f.tick(1);
 f.hook.emit('mousemove',{x:200,y:200});
 f.hook.emit('keydown',{keycode:nativeCode('KeyJ')});
 assert.equal(f.states.at(-1)!.state.targets.right,'KeyJ');
 assert.equal(f.states.at(-1)!.at,1001);
 f.tick(20);assert.equal(f.states.at(-1)!.state.targets.right,'KeyJ');
 f.hook.emit('keyup',{keycode:nativeCode('KeyJ')});
 assert.deepEqual(f.states.at(-1)!.state.pressed,[]);
 for(const button of [1,2,3]){
  f.hook.emit('mousedown',{button});assert.equal(f.states.at(-1)!.state.targets.right,'mouse');
  f.hook.emit('mouseup',{button});
  assert.deepEqual(f.states.at(-1)!.state.mouse.buttons,{left:false,right:false,middle:false});
 }
});

test('stop/restart cancels trailing work and rejects captured callbacks from an older generation',async t=>{
 const f=timedInput(t);await f.input.start();
 f.hook.emit('mousemove',{x:100,y:100});f.tick(1);f.hook.emit('mousemove',{x:900,y:900});
 const oldMove=f.hook.listeners('mousemove')[0],oldDown=f.hook.listeners('keydown')[0];
 f.input.stop();const stopped=f.states.length;f.tick(1000);
 assert.equal(f.states.length,stopped);assert.equal(f.input.snapshot().counts.pointer,0);
 await f.input.start();oldMove({x:900,y:900});oldDown({keycode:nativeCode('KeyA')});
 f.tick(16);assert.equal(f.input.snapshot().counts.pointer,0);
 assert.deepEqual(f.input.physicalSnapshot().pressed,[]);
 assert.equal(f.input.physicalSnapshot().mouse.x,0);
 f.hook.emit('mousemove',{x:250,y:250});
 assert.equal(f.states.at(-1)!.state.mouse.x,-.5);
 assert.equal(f.input.snapshot().counts.pointer,1);
});

test('healthy idle hook uses one trust timer per second without polling or serializing snapshots',async t=>{
 const f=timedInput(t);await f.input.start();
 const timers=t.mock.method(globalThis,'setTimeout'),serializations=t.mock.method(JSON,'stringify');
 const reports=f.states.length;
 for(let i=0;i<10;i++)f.tick(1000);
 assert.equal(f.polls(),1);assert.equal(f.checks(),11);
 assert.equal(timers.mock.callCount(),10);assert.equal(serializations.mock.callCount(),0);
 assert.equal(f.states.length,reports);
});

test('permission loss clears all held state within one second and resumes OS pointer fallback',async t=>{
 const f=timedInput(t);await f.input.start();
 f.hook.emit('keydown',{keycode:nativeCode('KeyA')});f.hook.emit('mousedown',{button:2});
 f.setTrust(false);f.tick(999);assert.equal(f.input.snapshot().keyboard,true);
 f.tick(1);assert.equal(f.input.snapshot().keyboard,false);assert.equal(f.hook.started,false);
 assert.deepEqual(f.states.at(-1)!.state.pressed,[]);
 assert.deepEqual(f.states.at(-1)!.state.mouse.buttons,{left:false,right:false,middle:false});
 assert.equal(f.hook.listenerCount('mousemove'),0);
 f.setPoint({x:750,y:250});f.tick(33);
 assert.equal(f.states.at(-1)!.state.mouse.x,.5);assert.equal(f.input.snapshot().counts.pointer,1);
 assert.equal(f.polls(),2);
});

test('hook failure discards a pending native move and falls back to current OS coordinates',async t=>{
 const f=timedInput(t);await f.input.start();
 f.hook.emit('mousemove',{x:100,y:100});f.tick(1);f.hook.emit('mousemove',{x:900,y:900});
 f.hook.emit('error',new Error('fixture'));
 f.tick(15);assert.equal(f.input.physicalSnapshot().mouse.x,0);
 f.setPoint({x:250,y:750});f.tick(18);
 assert.equal(f.states.at(-1)!.state.mouse.x,-.5);assert.equal(f.states.at(-1)!.state.mouse.y,.5);
 assert.equal(f.input.snapshot().keyboard,false);
});

test('wheel pulse expires at 180 ms, movement at 700 ms, while held keys/buttons never expire',async t=>{
 const f=timedInput(t);await f.input.start();
 f.hook.emit('keydown',{keycode:nativeCode('KeyJ')});
 f.hook.emit('wheel',{direction:3,rotation:-1});
 assert.equal(f.states.at(-1)!.state.mouse.wheel.y,-1);
 f.tick(179);assert.equal(f.states.at(-1)!.state.mouse.wheel.y,-1);
 f.tick(1);assert.equal(f.states.at(-1)!.state.mouse.wheel.y,0);
 assert.equal(f.states.at(-1)!.state.targets.right,'KeyJ');
 f.hook.emit('mousemove',{x:750,y:250});f.tick(699);
 assert.equal(f.states.at(-1)!.state.targets.right,'mouse');
 f.tick(1);assert.equal(f.states.at(-1)!.state.targets.right,'KeyJ');
 f.hook.emit('mousedown',{button:1});
 for(let i=0;i<10;i++)f.tick(1000);
 assert.deepEqual(f.input.physicalSnapshot().pressed,['KeyJ']);
 assert.equal(f.input.physicalSnapshot().mouse.buttons.left,true);
 assert.equal(f.input.physicalSnapshot().targets.right,'mouse');
 f.hook.emit('mouseup',{button:1});assert.equal(f.states.at(-1)!.state.targets.right,'KeyJ');
 f.hook.emit('keyup',{keycode:nativeCode('KeyJ')});assert.deepEqual(f.states.at(-1)!.state.pressed,[]);
});

test('a repeated wheel pulse moves its deadline and a subsequent move keeps its own 700 ms expiry',async t=>{
 const f=timedInput(t);await f.input.start();
 f.hook.emit('wheel',{direction:4,rotation:1});f.tick(100);
 f.hook.emit('wheel',{direction:3,rotation:-1});f.tick(80);
 assert.deepEqual(f.states.at(-1)!.state.mouse.wheel,{x:0,y:-1});
 f.hook.emit('mousemove',{x:250,y:250});f.tick(100);
 assert.deepEqual(f.states.at(-1)!.state.mouse.wheel,{x:0,y:0});
 assert.equal(f.states.at(-1)!.state.targets.right,'mouse');
 f.tick(600);assert.equal(f.states.at(-1)!.state.targets.right,null);
});

test('a rejected older load cannot reset the hook or held state of a newer start',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const hook=new Hook();let reject!:(error:Error)=>void,calls=0;
 const input=new GlobalInput(()=>{},bounds,{trusted:()=>true,point:()=>({x:0,y:0}),loadHook:()=>++calls===1?new Promise((_resolve,r)=>{reject=r;}):Promise.resolve(hook)});
 t.after(()=>input.stop());
 const earlier=input.start();await input.start();hook.emit('keydown',{keycode:nativeCode('KeyA')});
 reject(new Error('stale load'));await earlier;
 assert.equal(hook.started,true);assert.equal(input.snapshot().keyboard,true);
 assert.deepEqual(input.physicalSnapshot().pressed,['KeyA']);
});

test('a late cancelled timer cannot flush or cancel the new generation trailing move',async t=>{
 const f=timedInput(t);await f.input.start();
 const timers=t.mock.method(globalThis,'setTimeout');
 f.hook.emit('mousemove',{x:100,y:100});f.tick(1);f.hook.emit('mousemove',{x:200,y:200});
 const stale=timers.mock.calls.at(-1)!.arguments[0];
 await f.input.start();f.hook.emit('mousemove',{x:300,y:300});
 f.tick(1);f.hook.emit('mousemove',{x:400,y:400});
 const count=f.states.length;stale();assert.equal(f.states.length,count);
 f.tick(15);assert.equal(f.states.length,count+1);assert.equal(f.states.at(-1)!.state.mouse.x,-.19999999999999996);
});
