const {test}=require('node:test'),assert=require('node:assert/strict');
const {MacInputPrototype,parsePacket}=require('./adapter.cjs');
const keys=require('./key-ids.json');
const state={pressed:[],mouse:{x:0,y:0,buttons:{left:false,right:false,middle:false},wheel:{x:0,y:0}},targets:{left:null,right:null,keyboard:null}};
test('83 allowlisted protocol IDs exactly match the production layout',()=>{assert.deepEqual(keys,require('../../assets/keyboard.layout.json').keys.map(k=>k.id));assert.equal(keys.length,83);});
test('closed protocol drops unexpected metadata and rejects unknown keys or unbounded state',()=>{
 const p=parsePacket(JSON.stringify({v:1,type:'state',text:'discard',state:{...state,text:'discard'}}));
 assert.equal(JSON.stringify(p).includes('discard'),false);
 for(const bad of [{...state,pressed:['secret']},{...state,pressed:Array(33).fill('KeyA')},{...state,mouse:{...state.mouse,x:Infinity}},{...state,targets:{...state.targets,keyboard:'private'}}])assert.throws(()=>parsePacket(JSON.stringify({v:1,type:'state',state:bad})));
 assert.throws(()=>parsePacket(JSON.stringify({v:1,type:'status',status:'user-private-data'})));
});
test('permission denial does not auto-request or claim a running listener',async()=>{
 let requests=0;const native={stop:async()=> 'stopped',start:async()=> 'permission_denied',permissionGranted:()=>false,requestPermission:()=>{requests++;},serviceStatus:()=> 'permission_denied'};
 const input=new MacInputPrototype(native);assert.equal(await input.start(()=>{}),'permission_denied');assert.equal(requests,0);assert.equal(input.permissionGranted(),false);await input.stop();
});
test('OFF while start is queued cancels capture; repeated start never creates concurrent listeners',async()=>{
 let starts=0,active=0,max=0,stops=0;
 const native={stop:async()=>{stops++;active=0;return'stopped'},start:async()=>{starts++;active++;max=Math.max(max,active);return'running'}};
 const input=new MacInputPrototype(native);const first=input.start(()=>{});const stopped=input.stop();assert.equal(await first,'cancelled');await stopped;assert.equal(starts,0);
 await input.start(()=>{});await input.start(()=>{});assert.equal(max,1);assert.equal(starts,2);await input.stop();assert.equal(active,0);assert.ok(stops>=3);
});
test('stale callback after restart cannot republish old held keys',async()=>{
 const callbacks=[];const native={stop:async()=> 'stopped',start:async(cb)=>{callbacks.push(cb);return'running'}};const received=[];const input=new MacInputPrototype(native);
 await input.start(p=>received.push(p));await input.start(p=>received.push(p));received.length=0;const packet=JSON.stringify({v:1,type:'state',state});callbacks[0](null,packet);assert.equal(received.length,0);callbacks[1](null,packet);assert.equal(received.length,1);await input.stop();assert.deepEqual(received.at(-1).state.pressed,[]);const count=received.length;callbacks[1](null,packet);assert.equal(received.length,count);
});

test('OFF detaches consumer before reset, preventing recursive stop/reset callbacks',async()=>{
 const native={stop:async()=> 'stopped',start:async()=> 'running'};const input=new MacInputPrototype(native);let resets=0;
 await input.start(()=>{resets++;void input.stop();});await input.stop();assert.equal(resets,1);
});
