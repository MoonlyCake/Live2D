import test from 'node:test';
import assert from 'node:assert/strict';
import {PetDrag} from '../src/shared/drag';
import {sanitizeSettings,createPetState,reducePetState,getPetView,serializeSettings,parseSettings} from '../src/shared/domain';
const date=new Date(2026,9,3,12);
test('old settings repair adds opt-in modes and persistent position lock',()=>{
 const settings=sanitizeSettings({mood:'shy',positionLocked:true,randomMood:true});
 assert.equal(parseSettings(serializeSettings(settings)).positionLocked,true);
 assert.equal(parseSettings(serializeSettings(settings)).randomMood,true);
 assert.equal(sanitizeSettings({}).positionLocked,false);
 assert.equal(sanitizeSettings({}).randomMood,false);
 assert.equal(sanitizeSettings({positionLocked:'true'}).positionLocked,false);
});
test('random moods hold 30–60 seconds and never repeat consecutively',()=>{
 const cfg=sanitizeSettings({randomMood:true,idleDelaySeconds:3600});
 let state=createPetState();
 const tick=(now:number)=>state=reducePetState(state,{type:'tick'},cfg,{now,date,rng:()=>0});
 tick(0);assert.equal(state.randomMood,'happy');assert.equal(state.nextMoodAt,30000);
 for(let n=1;n<30000;n+=100)tick(n);
 assert.equal(state.randomMood,'happy');tick(30000);assert.equal(state.randomMood,'shy');
 assert.equal(getPetView(state,cfg,{now:30000,date}).mood,'shy');
 tick(60000);assert.notEqual(state.randomMood,'shy');
 const manual={...cfg,randomMood:false,mood:'unimpressed' as const};
 state=reducePetState(state,{type:'tick'},manual,{now:60001,date});
 assert.equal(state.nextMoodAt,null);assert.equal(getPetView(state,manual,{now:60001,date}).mood,'unimpressed');
});
test('sleep, meal and transient interaction defer random mood changes',()=>{
 const cfg=sanitizeSettings({randomMood:true,idleDelaySeconds:3600});
 let state=reducePetState(createPetState(),{type:'tick'},cfg,{now:0,date,rng:()=>0});
 state=reducePetState(state,{type:'activity',kind:'click'},cfg,{now:30000,date,rng:()=>0});
 state=reducePetState(state,{type:'tick'},cfg,{now:30100,date,rng:()=>0});
 assert.equal(state.randomMood,'happy');
 state={...state,mealStartedAt:30000,mealEndsAt:40000};
 state=reducePetState(state,{type:'tick'},cfg,{now:31000,date,rng:()=>0});assert.equal(state.randomMood,'happy');
 const sleeping={...cfg,sleepEnabled:true,sleepStart:'11:00',sleepEnd:'13:00'};
 state=reducePetState(state,{type:'tick'},sleeping,{now:41000,date,rng:()=>0});
 assert.equal(state.randomMood,'happy');assert.equal(getPetView(state,sleeping,{now:41000,date}).mood,'sleepy');
 state=reducePetState(state,{type:'tick'},cfg,{now:42000,date,rng:()=>0});assert.equal(state.randomMood,'shy');
});
test('drag owns pointer, uses stable screen origin and cancels on lock',async()=>{
 const drag=new PetDrag();await drag.begin(1,50,60,async()=>({x:100,y:200}),()=>true);
 assert.deepEqual(drag.move(1,55,72,true),{x:105,y:212});
 assert.equal(drag.move(2,55,72,true),null);
 assert.equal(drag.move(1,55,72,false),null);
 assert.equal(drag.move(1,55,72,true),null);
});
test('pointer-up and lock while awaiting bounds cannot resurrect drag',async()=>{
 const drag=new PetDrag();let resolve!:(v:{x:number;y:number})=>void;
 const ready=new Promise<{x:number;y:number}>(r=>resolve=r);
 const pending=drag.begin(1,0,0,()=>ready,()=>true);drag.cancel();resolve({x:10,y:20});await pending;
 assert.equal(drag.move(1,10,20,true),null);
 let allowed=true;const next=drag.begin(1,0,0,async()=>({x:1,y:2}),()=>allowed);allowed=false;await next;
 assert.equal(drag.move(1,10,20,true),null);
});
