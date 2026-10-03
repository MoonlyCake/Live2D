import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PhysicalInput, MAX_PRESSED_KEYS, MOUSE_RECENT_MS, WHEEL_PULSE_MS, type PhysicalKeyBinding, type PhysicalMouseButton} from '../src/shared/physical-input';

const layout = JSON.parse(readFileSync(new URL('../assets/keyboard.layout.json', import.meta.url), 'utf8')) as {keys:PhysicalKeyBinding[]};
const code = (id:string) => {const key = layout.keys.find(key => key.id === id); assert.ok(key, `Layout must contain ${id}`); return key.nativeCode;};
function fixture(){let now=1000;return{input:new PhysicalInput(layout.keys,()=>now), advance:(milliseconds:number)=>{now+=milliseconds;}};}

test('every canonical key maps one-to-one and releases without retaining native codes',()=>{
 assert.equal(layout.keys.length,83);
 const input = new PhysicalInput(layout.keys,()=>0);
 for(const key of layout.keys){
  assert.equal(input.keyDown(key.nativeCode),true);
  const state=input.snapshot();
  assert.deepEqual(state.pressed,[key.id]);
  assert.ok(key.hand==='left'||key.hand==='right');
  assert.equal(state.targets[key.hand],key.id);
  assert.equal(input.keyUp(key.nativeCode),true);
  assert.deepEqual(input.snapshot().pressed,[]);
 }
 assert.equal(input.keyDown(-1),false);assert.equal(input.keyDown(0xffff),false);assert.equal(input.keyDown(NaN),false);
 assert.equal(input.keyUp(-1),false);
});

test('combos show all current keys; each hand targets latest held key and repeat does not reorder',()=>{
 const {input}=fixture();
 for(const id of ['MetaLeft','KeyA','KeyS','KeyJ','KeyK'])assert.equal(input.keyDown(code(id)),true);
 assert.deepEqual(input.snapshot().targets,{left:'KeyS',right:'KeyK'});
 assert.equal(input.keyDown(code('KeyA')),false);
 assert.equal(input.keyDown(code('KeyJ')),false);
 assert.deepEqual(input.snapshot().targets,{left:'KeyS',right:'KeyK'});
 const expected=layout.keys.filter(key=>['MetaLeft','KeyA','KeyS','KeyJ','KeyK'].includes(key.id)).map(key=>key.id);
 assert.deepEqual(input.snapshot().pressed,expected);
 input.keyUp(code('KeyS'));input.keyUp(code('KeyK'));
 assert.deepEqual(input.snapshot().targets,{left:'KeyA',right:'KeyJ'});
 assert.equal(input.keyUp(code('KeyK')),false);
 input.keyUp(code('KeyA'));assert.equal(input.snapshot().targets.left,'MetaLeft');
 input.keyDown(code('KeyA'));assert.equal(input.snapshot().targets.left,'KeyA');
});

test('pressed set is bounded at32 without evicting held keys or queuing rejected keys',()=>{
 const {input}=fixture();
 for(const key of layout.keys.slice(0,MAX_PRESSED_KEYS))assert.equal(input.keyDown(key.nativeCode),true);
 const extra=layout.keys[MAX_PRESSED_KEYS];
 assert.equal(input.keyDown(extra.nativeCode),false);assert.equal(input.keyUp(extra.nativeCode),false);
 assert.equal(input.snapshot().pressed.length,MAX_PRESSED_KEYS);
 input.keyUp(layout.keys[0].nativeCode);
 assert.equal(input.snapshot().pressed.some(id=>id===extra.id),false);
 assert.equal(input.keyDown(extra.nativeCode),true);
 assert.equal(input.snapshot().pressed.length,MAX_PRESSED_KEYS);
});

test('long held keys and held mouse buttons never expire; lifecycle reset clears everything',()=>{
 const {input,advance}=fixture();input.keyDown(code('KeyA'));input.keyDown(code('KeyJ'));
 input.move(.5,-.5);input.buttonDown('right');input.wheel(0,1);advance(24*60*60*1000);
 assert.deepEqual(input.snapshot().pressed,layout.keys.filter(key=>['KeyA','KeyJ'].includes(key.id)).map(key=>key.id));
 assert.deepEqual(input.snapshot().targets,{left:'KeyA',right:'mouse'});
 assert.deepEqual(input.snapshot().mouse.wheel,{x:0,y:0});
 input.reset();assert.deepEqual(input.snapshot(),{pressed:[],mouse:{x:0,y:0,buttons:{left:false,right:false,middle:false},wheel:{x:0,y:0}},targets:{left:null,right:null}});
 assert.equal(input.keyUp(code('KeyA')),false);assert.equal(input.buttonUp('right'),false);
});

test('normalized movement maps current point, briefly takes right hand, and preserves left hand',()=>{
 const {input,advance}=fixture();input.keyDown(code('KeyA'));input.keyDown(code('KeyJ'));
 assert.equal(input.move(0,0),true);assert.deepEqual(input.snapshot().targets,{left:'KeyA',right:'mouse'});
 advance(MOUSE_RECENT_MS-1);assert.equal(input.snapshot().targets.right,'mouse');
 // A static pointer poll must not keep stealing the right hand from the keyboard.
 assert.equal(input.move(0,0),false);advance(1);assert.equal(input.snapshot().targets.right,'KeyJ');
 assert.equal(input.move(5,-5),true);assert.equal(input.snapshot().mouse.x,1);assert.equal(input.snapshot().mouse.y,-1);
 const before=input.snapshot();assert.equal(input.move(NaN,0),false);assert.equal(input.move(0,Infinity),false);
 assert.deepEqual(input.snapshot(),before);
 advance(MOUSE_RECENT_MS);input.keyUp(code('KeyJ'));assert.equal(input.snapshot().targets.right,null);
});

test('left/right/middle transitions are independent, duplicate down is inert, and release restores key target',()=>{
 const {input}=fixture();input.keyDown(code('KeyJ'));
 for(const button of ['left','right','middle'] as const){assert.equal(input.buttonDown(button),true);assert.equal(input.buttonDown(button),false);}
 assert.deepEqual(input.snapshot().mouse.buttons,{left:true,right:true,middle:true});
 input.buttonUp('left');input.buttonUp('right');assert.equal(input.snapshot().targets.right,'mouse');
 input.buttonUp('middle');assert.equal(input.snapshot().targets.right,'KeyJ');
 assert.equal(input.buttonUp('middle'),false);
 assert.equal(input.buttonDown('other' as PhysicalMouseButton),false);
});

test('wheel exposes only signed current pulses, expires deterministically, and does not collect movement history',()=>{
 const {input,advance}=fixture();input.keyDown(code('KeyJ'));
 assert.equal(input.wheel(-900,20),true);assert.deepEqual(input.snapshot().mouse.wheel,{x:-1,y:1});
 assert.equal(input.snapshot().targets.right,'mouse');advance(WHEEL_PULSE_MS-1);assert.equal(input.snapshot().mouse.wheel.y,1);
 advance(1);assert.deepEqual(input.snapshot().mouse.wheel,{x:0,y:0});assert.equal(input.snapshot().targets.right,'KeyJ');
 input.wheel(0,-1);advance(100);input.wheel(1,0);advance(100);
 assert.deepEqual(input.snapshot().mouse.wheel,{x:1,y:0});
 assert.equal(input.wheel(0,0),false);assert.equal(input.wheel(NaN,1),false);assert.equal(input.wheel(1,Infinity),false);
 advance(WHEEL_PULSE_MS);assert.deepEqual(input.snapshot().mouse.wheel,{x:0,y:0});
});

test('snapshots are defensive and expose no timing, key order, native code, text, or event history',()=>{
 const {input}=fixture();input.keyDown(code('KeyS'));input.keyDown(code('KeyA'));input.move(.1,.2);
 const before=input.snapshot(),changed=input.snapshot();
 changed.pressed.length=0;changed.mouse.x=999;changed.mouse.buttons.left=true;changed.mouse.wheel.y=1;changed.targets.left=null;
 assert.deepEqual(input.snapshot(),before);
 assert.deepEqual(Object.keys(before).sort(),['mouse','pressed','targets']);
 assert.deepEqual(Object.keys(before.mouse).sort(),['buttons','wheel','x','y']);
 assert.doesNotMatch(JSON.stringify(before),/nativeCode|keycode|timestamp|sequence|history|text/);
 input.keyUp(code('KeyS'));input.keyUp(code('KeyA'));assert.deepEqual(input.snapshot().pressed,[]);
});

test('layout supplies mapping and hands without retaining mutable geometry or accepting arbitrary strings',()=>{
 const keys=[{id:'KeyA',nativeCode:31,hand:'right' as const,x:100,y:200}];
 const input=new PhysicalInput(keys,()=>0);keys[0].nativeCode=32;keys[0].x=900;
 assert.equal(input.keyDown(31),true);assert.deepEqual(input.snapshot().targets,{left:null,right:'KeyA'});
 assert.equal(input.keyDown(32),false);
 for(const bindings of [
  [{id:'typed secret',nativeCode:1,hand:'left'}],
  [{id:'KeyA',nativeCode:1.5,hand:'left'}],
  [{id:'KeyA',nativeCode:1,hand:'other'}],
  [{id:'KeyA',nativeCode:1,hand:'left'},{id:'KeyA',nativeCode:2,hand:'right'}],
  [{id:'KeyA',nativeCode:1,hand:'left'},{id:'KeyB',nativeCode:1,hand:'right'}],
 ])assert.throws(()=>new PhysicalInput(bindings as PhysicalKeyBinding[]),/Invalid or duplicate/);
});
test('new right key supersedes recent pointer movement but not a held mouse button',()=>{const s=new PhysicalInput(layout.keys,()=>1000);const j=layout.keys.find(k=>k.id==='KeyJ')!;s.move(.3,.4);assert.equal(s.snapshot().targets.right,'mouse');s.keyDown(j.nativeCode);assert.equal(s.snapshot().targets.right,'KeyJ');s.buttonDown('left');assert.equal(s.snapshot().targets.right,'mouse');s.keyUp(j.nativeCode);s.keyDown(j.nativeCode);assert.equal(s.snapshot().targets.right,'mouse');s.buttonUp('left');assert.equal(s.snapshot().targets.right,'KeyJ');});
