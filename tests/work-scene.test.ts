import test from 'node:test';import assert from 'node:assert/strict';
import contractJSON from './fixtures/work-contract.json';import layout from '../assets/keyboard.layout.json';
import {WorkPose,validateWorkContract,deskVisibility} from '../src/shared/work-scene';import {PhysicalInput} from '../src/shared/physical-input';
const contract=validateWorkContract(contractJSON),pose=new WorkPose(contract);

test('every supported key selects the right typing hand at its exact projected contact',()=>{
 const input=new PhysicalInput(layout.keys,()=>1000);
 for(const key of layout.keys){input.reset();input.keyDown(key.nativeCode);const values=pose.values(input.snapshot()),target=pose.keyboardPoint(key.x,key.y,1);assert.equal(values.ParamTypingActive,1);assert.equal(values.ParamTypingPressR,1);assert.equal(values.ParamTypingHandRX,target[0]);assert.equal(values.ParamTypingHandRY,target[1]);input.keyUp(key.nativeCode);assert.equal(pose.values(input.snapshot()).ParamTypingActive,0);}
});

test('latest current key is independent of the left mouse hand and held buttons',()=>{
 const input=new PhysicalInput(layout.keys,()=>1000);input.keyDown(layout.keys.find(k=>k.id==='KeyA')!.nativeCode);input.keyDown(layout.keys.find(k=>k.id==='KeyJ')!.nativeCode);input.move(1,-1);input.buttonDown('left');
 let values=pose.values(input.snapshot());assert.equal(values.ParamMouseLeft,1);assert.equal(values.ParamTypingHandRX,pose.keyboardPoint(606,909,1)[0]);
 input.keyUp(layout.keys.find(k=>k.id==='KeyJ')!.nativeCode);values=pose.values(input.snapshot());const a=layout.keys.find(k=>k.id==='KeyA')!;assert.equal(values.ParamTypingHandRX,pose.keyboardPoint(a.x,a.y,1)[0]);assert.equal(values.ParamMouseLeft,1);
});

test('scene stays stable through pauses then fades out and returns, without retaining any keys',()=>{
 assert.deepEqual(deskVisibility(-Infinity,0),{desk:false,opacity:1});assert.deepEqual(deskVisibility(100,3900),{desk:true,opacity:1});assert.deepEqual(deskVisibility(100,4190),{desk:true,opacity:.5});assert.deepEqual(deskVisibility(100,4370),{desk:false,opacity:.5});assert.deepEqual(deskVisibility(100,4700),{desk:false,opacity:1});
});

test('null draft geometry cannot activate as a finished working scene',()=>{
 assert.throws(()=>validateWorkContract({...contractJSON,canvas:null}),/坐标/);assert.throws(()=>validateWorkContract({...contractJSON,keyboard:{...contractJSON.keyboard,quad:null}}),/平面/);
});
