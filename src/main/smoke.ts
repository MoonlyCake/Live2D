/** Opt-in cloud CI diagnostics. Inert in ordinary app launches. */
import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const destination=process.env.WHALE_CI_SMOKE_DIR;
const failures:string[]=[];
export function observeSmokeWindow(win:BrowserWindow){
 if(!destination)return;
 win.webContents.on('render-process-gone',(_event,details)=>failures.push(`renderer gone: ${details.reason} (${details.exitCode})`));
 win.webContents.on('did-fail-load',(_event,code,description,url)=>failures.push(`load failed: ${code} ${description} ${url}`));
 win.webContents.on('preload-error',(_event,path,error)=>failures.push(`preload failed: ${path} ${error.message}`));
 win.webContents.on('console-message',(...args:any[])=>{const detail=typeof args[1]==='object'?args[1]:{level:args[1],message:args[2]};if(detail?.level===3||detail?.level==='error')failures.push(`console: ${String(detail.message)}`);});
}
export async function runCISmoke(windows:BrowserWindow[]){
 if(!destination)return;
 mkdirSync(destination,{recursive:true});
 try{
  // Exercise production startup, tray and render loops without enabling input/audio capture.
  await new Promise(resolve=>setTimeout(resolve,12000));
  const results=[];
  for(const [index,win] of windows.entries()){
   if(win.isDestroyed()||win.webContents.isDestroyed())throw new Error(`Window ${index} destroyed`);
   const state=await win.webContents.executeJavaScript(`(()=>{const c=document.querySelector('canvas');let d=null,backend='none';if(c){const selected=window.__inochiQA?.backend||'';const ctx=selected.startsWith('CPU')?c.getContext('2d'):null;if(ctx){d=ctx.getImageData(0,0,c.width,c.height).data;backend='CPU Canvas2D';}else{const gl=selected.startsWith('WebGL2')?c.getContext('webgl2'):selected.startsWith('WebGL1')?c.getContext('webgl'):null;if(gl){d=new Uint8Array(c.width*c.height*4);gl.finish();gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,d);backend=gl.getParameter(gl.VERSION);}}}let painted=0;const colors=new Set();if(d)for(let i=0;i<d.length;i+=16){if(d[i+3]>20){painted++;colors.add(d[i]+','+d[i+1]+','+d[i+2]);}}return {url:location.href,ready:document.body.dataset.ready,errors:window.__errors||[],inochi:window.__inochiQA||null,canvas:c?{width:c.width,height:c.height,painted,colors:colors.size,backend}:null};})()`);
   if(state.ready!=='true')throw new Error(`Window ${index} did not initialize`);
   if(state.inochi?.capabilities?.type!=='inochi-0.8-subset')throw new Error(`Window ${index} did not load the genuine Inochi model`);
   if(process.env.WHALE_CI_MODEL_STAGE&&(!state.inochi.capabilities.blink||!state.inochi.capabilities.typing))throw new Error(`Window ${index} does not have the authored core eye/arm rig`);
   if(process.env.WHALE_CI_MODEL_STAGE==='full'&&(!state.inochi.capabilities.physicalInput||!state.inochi.capabilities.eating||!state.inochi.capabilities.gaze||state.inochi.capabilities.moods.length!==5||state.inochi.capabilities.parameters.length<44||!['ParamEyeBallX','ParamEyeBallY','ParamMouthOpenY','ParamMouthForm'].every(id=>state.inochi.capabilities.parameters.includes(id))))throw new Error(`Window ${index} full-model capabilities incomplete`);
   if(state.errors.length)throw new Error(`Window ${index} script errors: ${JSON.stringify(state.errors)}`);
   if(!state.canvas||state.canvas.painted<100||state.canvas.colors<8)throw new Error(`Window ${index} has blank/unpainted canvas`);
   const image=await win.webContents.capturePage();const png=image.toPNG();
   if(image.isEmpty()||png.length<1000)throw new Error(`Window ${index} screenshot missing/empty`);
   const filename=index===0?'pet-window.png':'settings-window.png';writeFileSync(join(destination,filename),png);
   results.push({...state,screenshot:filename,screenshotBytes:png.length});
  }
  const actionFrames:string[]=[];const actionEvidence:unknown[]=[];
  if(process.env.WHALE_CI_MODEL_STAGE){
   const panel=windows[1];
   type Expect=Record<string,number|{min?:number;max?:number}>;
   const capture=async(name:string,delay=500,expected:Expect={})=>{
    await new Promise(resolve=>setTimeout(resolve,delay));
    const current=await panel.webContents.executeJavaScript("({qa:window.__inochiQA,errors:window.__errors||[]})");
    if(current.errors.length||current.qa?.capabilities?.type!=='inochi-0.8-subset')throw new Error(name+': renderer failed during action');
    if(process.env.WHALE_CI_MODEL_STAGE==='full'&&(!current.qa.capabilities.physicalInput||!current.qa.capabilities.eating||current.qa.capabilities.moods.length!==5||current.qa.capabilities.parameters.length<44))throw new Error(name+': full capabilities lost');
    for(const [key,value]of Object.entries(expected)){const actual=current.qa.drivenParameters?.[key];if(!Number.isFinite(actual))throw new Error(name+': missing driven '+key);if(typeof value==='number'?Math.abs(actual-value)>1e-6:(value.min!==undefined&&actual<value.min)||(value.max!==undefined&&actual>value.max))throw new Error(name+': '+key+' actual='+actual+' expected='+JSON.stringify(value));}
    const png=(await panel.webContents.capturePage()).toPNG();if(png.length<1000)throw new Error(name+': empty capture');writeFileSync(join(destination,name),png);actionFrames.push(name);actionEvidence.push({name,expected,diagnostics:current.qa,screenshotBytes:png.length});return current.qa;
   };
   const waitFor=async(expression:string)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){if(await panel.webContents.executeJavaScript(`(()=>{const p=window.__inochiQA?.drivenParameters||{};return ${expression}})()`))return;await new Promise(resolve=>setTimeout(resolve,35));}throw new Error('Authored action phase not observed: '+expression);};
   await panel.webContents.executeJavaScript("window.whale.updateSettings({reducedMotion:false,sleepEnabled:false})");
   await panel.webContents.executeJavaScript("document.getElementById('test-typing').click()");await capture('action-typing.png',150,{ParamTypingMode:1,ParamTypingPressL:1});
   await panel.webContents.executeJavaScript("(()=>{const d=new Date(),f=h=>String((h+24)%24).padStart(2,'0')+':00';return window.whale.updateSettings({sleepEnabled:true,sleepStart:f(d.getHours()-1),sleepEnd:f(d.getHours()+1)})})()");await capture('action-sleep-closed-eyes.png',750,{ParamEyeLOpen:0,ParamEyeROpen:0});
   await panel.webContents.executeJavaScript("window.whale.updateSettings({sleepEnabled:false})");
   if(process.env.WHALE_CI_MODEL_STAGE==='full'){
    const moods=['happy','shy','aggrieved','sleepy','unimpressed'];
    for(const mood of moods){await panel.webContents.executeJavaScript(`document.querySelector('[data-mood="${mood}"]').click()`);const expected=Object.fromEntries(moods.map(m=>['Param'+m[0].toUpperCase()+m.slice(1),m===mood?1:0]));await capture(`mood-${mood}.png`,500,expected);}
    await panel.webContents.executeJavaScript("document.getElementById('test-eating').click();window.whale.testInput('click')");
    const started=await capture('meal-scoop.png',200,{ParamRicePoseSwitch:1,ParamRiceBowlOpacity:1,ParamRiceArm:{max:.15},ParamRiceBiteOpacity:1});if(!(started.preview?.eating>0))throw new Error('Manual preview cancelled by initiating click');
    await waitFor('p.ParamRiceArm>.2&&p.ParamRiceArm<.85&&p.ParamRiceBiteOpacity===1');await capture('meal-lift.png',0,{ParamRicePoseSwitch:1,ParamRiceBowlOpacity:1,ParamRiceArm:{min:.15,max:.95},ParamRiceBiteOpacity:1});
    await waitFor('p.ParamMouthOpenY>.35&&p.ParamRiceArm>.85&&p.ParamRiceBiteOpacity===1');await capture('meal-mouth.png',0,{ParamRicePoseSwitch:1,ParamRiceArm:{min:.8},ParamMouthOpenY:{min:.25},ParamRiceBiteOpacity:1});
    await waitFor('p.ParamRiceArm<.45&&p.ParamRiceBiteOpacity===0');await capture('meal-return.png',0,{ParamRicePoseSwitch:1,ParamRiceArm:{max:.5},ParamRiceBiteOpacity:0});
    await panel.webContents.executeJavaScript("window.whale.testInput('typing')");await capture('meal-caught-return.png',100,{ParamRicePoseSwitch:1,ParamRiceBowlOpacity:1,ParamMouthOpenY:0,ParamEyeLOpen:1,ParamEyeROpen:1});
    const caught=await capture('meal-caught-hidden.png',240,{ParamRicePoseSwitch:0,ParamRiceBowlOpacity:0});
    // Synthetic physical states exercise actual final rig/texture pixels. These are not OS hook/TCC tests.
    const physical=async(pressed:string[],left:string|null,right:string|null,x=0,y=0,buttons={left:false,right:false,middle:false},wheel={x:0,y:0})=>{await panel.webContents.executeJavaScript('window.__setPhysicalQA('+JSON.stringify({pressed,targets:{left,right},mouse:{x,y,buttons,wheel}})+')');};
    await physical(['KeyF','KeyJ'],'KeyF','KeyJ');await capture('physical-chord.png',100,{ParamTypingMode:1,ParamTypingHandLX:522,ParamTypingHandLY:909,ParamTypingHandRX:606,ParamTypingPressL:1,ParamTypingPressR:1});
    await physical([],null,null);await capture('physical-release.png',100,{ParamTypingPressL:0,ParamTypingPressR:0});
    await physical([],null,'mouse',-1,-1);await capture('physical-mouse-min.png',100,{ParamMouseMode:1,ParamMouseX:938,ParamMouseY:897});
    await physical([],null,'mouse',1,1,{left:true,right:true,middle:false});await capture('physical-mouse-max-click.png',100,{ParamMouseMode:1,ParamMouseX:1002,ParamMouseY:957,ParamMouseLeft:1,ParamMouseRight:1});
    await physical([],null,'mouse',0,0,{left:false,right:false,middle:false},{x:0,y:1});await capture('physical-wheel.png',100,{ParamMouseWheel:1,ParamMouseLeft:0,ParamMouseRight:0});
    await physical([],null,null);await capture('physical-clear.png',750,{ParamTypingMode:0,ParamMouseMode:0,ParamTypingPressL:0,ParamTypingPressR:0});
if(caught.preview?.eating!==0)throw new Error('Caught preview still active');
   }
  }
  if(failures.length)throw new Error(failures.join('\n'));
  writeFileSync(join(destination,'renderer-report.json'),JSON.stringify({status:'passed',platform:process.platform,arch:process.arch,version:app.getVersion(),observedSeconds:12,windows:results,actionFrames,actionEvidence,failures,notTested:['Gatekeeper/Developer ID/notarization trust','manual end-user interaction acceptance','microphone/global input permissions']},null,2));
  console.log('WHALE_CI_SMOKE_PASSED');app.exit(0);
 }catch(error){failures.push(String(error));writeFileSync(join(destination,'renderer-report.json'),JSON.stringify({status:'failed',failures},null,2));console.error('WHALE_CI_SMOKE_FAILED',error);app.exit(1);}
}
