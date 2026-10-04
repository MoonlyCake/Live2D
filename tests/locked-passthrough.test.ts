import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {cleanSettings} from '../src/main/config';

const source=readFileSync(new URL('../src/main/index.ts',import.meta.url),'utf8');
function functionBody(start:string,end:string){return transformSync(source.slice(source.indexOf(start),source.indexOf(end)),{loader:'ts',format:'cjs'}).code;}

test('actual window policy makes lock click-through on initial load and on resize',()=>{
 for(const positionLocked of [false,true])for(const clickThrough of [false,true]){
  const calls:boolean[]=[];const pet={isDestroyed:()=>false,getBounds:()=>({x:10,y:20,width:320,height:420}),setBounds(){},setAlwaysOnTop(){},setOpacity(){},setIgnoreMouseEvents:(value:boolean)=>calls.push(value)};
  const context=createContext({pet,settings:cleanSettings({positionLocked,clickThrough}),fitBounds:(x:any)=>x,petBaseSize:()=>({width:320,height:420}),updateTray(){}});
  runInContext(functionBody('function applyWindow()','async function applyPatch'),context);runInContext('applyWindow();applyWindow()',context);
  assert.deepEqual(calls,[positionLocked||clickThrough,positionLocked||clickThrough]);
 }
});

test('actual unlock patch clears legacy standalone passthrough without restarting global input',async()=>{
 let starts=0,applied=false;
 const context=createContext({settings:cleanSettings({positionLocked:true,clickThrough:true}),cleanSettings,inputLifecycle:{allowed:true,update(){}},input:{start:async()=>{starts++}},permissionGuide:undefined,applyWindow:()=>{applied=true},persist(){},broadcast(){}});
 runInContext(functionBody('async function applyPatch','let settingsQueue'),context);
 const result=await runInContext('applyPatch({positionLocked:false})',context);
 assert.equal(result.positionLocked,false);assert.equal(result.clickThrough,false);assert.equal(starts,0);assert.equal(applied,true);
});

test('actual restore clears both flags before reapplying window policy',()=>{
 const calls:boolean[]=[];const settings=cleanSettings({positionLocked:true,clickThrough:true});const pet={isDestroyed:()=>false,setIgnoreMouseEvents:(x:boolean)=>calls.push(x),show(){},focus(){}};
 const context=createContext({pet,settings,applyWindow:()=>calls.push(settings.positionLocked||settings.clickThrough),broadcast(){},persist(){},createPet(){throw Error('Existing window should be reused')}});
 runInContext(functionBody('function restorePet()','function updateTray'),context);runInContext('restorePet()',context);
 assert.deepEqual(calls,[false,false]);assert.equal(settings.positionLocked,false);
});
