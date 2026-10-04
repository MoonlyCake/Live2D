'use strict';
// Only a separate signed CI .app. Never requests permissions or changes TCC.
const {app,BrowserWindow,Menu,screen}=require('electron');
const {join}=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {MacInputPrototype,parsePacket}=require('./adapter.cjs');
const profile=join(app.getPath('temp'),'whale-input-prototype-smoke');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
app.whenReady().then(async()=>{
 const addon=require(join(process.resourcesPath,'../Frameworks/whale-mac-input.node'));
 const driver=require(join(process.resourcesPath,'../Frameworks/os-event-driver.node'));
 const granted=addon.permissionGranted(),postGranted=driver.postAccess();
 const report={platform:process.platform,arch:process.arch,permissionGranted:granted,postEventAccessGranted:postGranted,permissionRequested:false,passes:[],nativePackets:0,ownerResetPackets:0,macOSPipelineValidated:false,method:'CGEventPost into our focused CI test window, returned through the production native event-tap implementation',osEventChecks:[],realHardwareInputValidated:false,secureInputValidated:false,permissionRevocationValidated:false,sleepWakeValidated:false};
 let nativeGeneration=0,latest=null,waiter=null,win=null;const held=new Map(),buttons=new Set();
 const bridge={...addon,stop(){nativeGeneration++;return addon.stop();},start(callback){const generation=++nativeGeneration;return addon.start((error,json)=>{
  report.nativePackets++;
  if(!error&&generation===nativeGeneration){try{const packet=parsePacket(json);if(packet.type==='state'){latest=packet.state;if(waiter&&waiter.predicate(latest,packet.cause)){const w=waiter;waiter=null;clearTimeout(w.timer);w.resolve({state:latest,cause:packet.cause});}}}catch(error){if(waiter){const w=waiter;waiter=null;clearTimeout(w.timer);w.reject(error);}}}
  callback(error,json);
 });}};
 const input=new MacInputPrototype(bridge);
 const observe=(_packet,meta)=>{if(meta?.native===false)report.ownerResetPackets++;};
 const waitFor=(predicate,label,action=()=>true)=>new Promise((resolve,reject)=>{
  assert.equal(waiter,null);const timer=setTimeout(()=>{waiter=null;reject(Error('OS event assertion timed out: '+label));},2500);
  waiter={predicate,resolve,reject,timer};try{if(action()!==true)throw Error('OS event post unavailable: '+label);}catch(error){clearTimeout(timer);waiter=null;reject(error);}
 });
 const focused=()=>{assert.ok(win&&win.isFocused(),'Only the own focused test window may receive posted events');};
 const key=(code,down)=>{focused();const result=driver.postKey(code,down);if(result){if(down)held.set(code,'key');else held.delete(code);}return result;};
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  for(let n=0;n<3;n++){
   const status=await input.start(observe);
   if(granted)assert.ok(['running','secure_input'].includes(status),status);else assert.equal(status,'permission_denied');
   report.passes.push({stage:'native-start',status});
   assert.equal(await input.stop(),'stopped');assert.equal(input.status(),'stopped');
   report.passes.push({stage:'native-stop',status:'stopped'});
  }
  if(!granted)assert.equal(report.nativePackets,0);
  if(!granted||!postGranted){report.osEventSkippedReason=!granted?'Input Monitoring not granted':'Post-event capability not granted; no request was made';}
  else{
   Menu.setApplicationMenu(null);
   win=new BrowserWindow({width:500,height:340,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   win.webContents.on('before-input-event',event=>event.preventDefault());
   await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>Whale Input CI Fixture</title><body style="background:#edf5ff;font:20px sans-serif"><p>Isolated input verification</p><textarea aria-label="Test target" style="width:95%;height:200px"></textarea><script>document.addEventListener("contextmenu",e=>e.preventDefault())</script>'));
   win.show();app.focus({steal:true});win.focus();await delay(150);focused();
   assert.equal(await input.start(observe),'running');
   const cases=require('./key-cases.json');assert.equal(cases.length,83);
   for(const item of cases){
    await waitFor((s,c)=>['native_key_down','native_modifier'].includes(c)&&s.pressed.length===1&&s.pressed[0]===item.id&&s.targets.keyboard===item.id,'down '+item.id,()=>key(item.code,true));
    const release=await waitFor((s,c)=>(['native_key_up','native_modifier'].includes(c)||(item.id==='CapsLock'&&c==='caps_pulse'))&&s.pressed.length===0&&s.targets.keyboard===null,'up '+item.id,()=>key(item.code,false));
    report.releaseSources??={};report.releaseSources[release.cause]=(report.releaseSources[release.cause]??0)+1;
   }
   report.osEventChecks.push({name:'83 posted virtual-key mappings and releases',passed:83});
   for(const item of cases.filter(k=>/^(Shift|Control|Alt|Meta)/.test(k.id))){
    await waitFor((s,c)=>c==='native_modifier'&&s.pressed.includes(item.id),'modifier down '+item.id,()=>{focused();held.set(item.code,'flags');return driver.postFlags(item.code,true);});
    await waitFor((s,c)=>c==='native_modifier'&&!s.pressed.includes(item.id),'modifier up '+item.id,()=>{focused();held.delete(item.code);return driver.postFlags(item.code,false);});
   }
   report.osEventChecks.push({name:'left/right modifier FlagsChanged edges',passed:8});
   await waitFor(s=>s.pressed.includes('KeyA'),'hold A',()=>key(0,true));
   await delay(750);assert.ok(latest.pressed.includes('KeyA'),'posted held key survives reconciliation');
   await waitFor(s=>s.targets.keyboard==='KeyJ','latest J',()=>key(38,true));
   assert.equal(key(0,true),true);await delay(80);assert.equal(latest.targets.keyboard,'KeyJ');
   await waitFor((s,c)=>c==='native_key_up'&&s.targets.keyboard==='KeyA','release restores A',()=>key(38,false));
   await waitFor((s,c)=>c==='native_key_up'&&s.pressed.length===0,'release A',()=>key(0,false));
   report.osEventChecks.push({name:'hold, repeat ordering and release restoration',passed:true});
   const b=win.getBounds(),p={x:Math.round(b.x+b.width*.5),y:Math.round(b.y+b.height*.6)};
   const displays=screen.getAllDisplays().map(d=>d.bounds),x=Math.min(...displays.map(d=>d.x)),y=Math.min(...displays.map(d=>d.y));
   const width=Math.max(...displays.map(d=>d.x+d.width))-x,height=Math.max(...displays.map(d=>d.y+d.height))-y;
   const nx=px=>(px-x)/width*2-1,ny=py=>(py-y)/height*2-1;
   await waitFor(s=>Math.abs(s.mouse.x-nx(p.x))<.002&&Math.abs(s.mouse.y-ny(p.y))<.002,'mouse point',()=>{focused();return driver.postMouse(5,p.x,p.y,0);});
   await waitFor(s=>Math.abs(s.mouse.x-nx(p.x+20))<.000001&&Math.abs(s.mouse.y-ny(p.y))<.000001,'latest mouse burst',()=>{focused();for(let i=1;i<=20;i++)assert.equal(driver.postMouse(5,p.x+i,p.y,0),true);return true;});
   for(const [button,name,down,up] of [[0,'left',1,2],[1,'right',3,4],[2,'middle',25,26]]){
    await waitFor((s,c)=>c==='native_mouse_down'&&s.mouse.buttons[name],name+' mouse down',()=>{focused();buttons.add(button);return driver.postMouse(down,p.x+20,p.y,button);});
    await waitFor((s,c)=>c==='native_mouse_up'&&!s.mouse.buttons[name],name+' mouse up',()=>{focused();buttons.delete(button);return driver.postMouse(up,p.x+20,p.y,button);});
   }
   await waitFor((s,c)=>c==='native_key_down'&&s.pressed.includes('KeyA'),'concurrent A',()=>key(0,true));
   await waitFor((s,c)=>c==='native_mouse_down'&&s.mouse.buttons.left,'concurrent mouse',()=>{focused();buttons.add(0);return driver.postMouse(1,p.x+20,p.y,0);});
   await waitFor((s,c)=>c==='native_key_down'&&s.targets.keyboard==='KeyJ'&&s.targets.right==='mouse'&&s.pressed.includes('KeyA'),'independent keyboard target while mouse held',()=>key(38,true));
   await waitFor((s,c)=>c==='native_key_up'&&s.targets.keyboard==='KeyA','concurrent J release',()=>key(38,false));
   await waitFor((s,c)=>c==='native_mouse_up'&&!s.mouse.buttons.left,'concurrent mouse release',()=>{focused();buttons.delete(0);return driver.postMouse(2,p.x+20,p.y,0);});
   await waitFor((s,c)=>c==='native_key_up'&&s.pressed.length===0,'concurrent A release',()=>key(0,false));
   report.osEventChecks.push({name:'independent keyboard target while mouse button is held',passed:true});
   await waitFor((s,c)=>c==='native_wheel'&&s.mouse.wheel.y===1,'vertical wheel',()=>{focused();return driver.postWheel(0,2);});
   await waitFor((s,c)=>c==='native_wheel'&&s.mouse.wheel.x===-1,'horizontal wheel',()=>{focused();return driver.postWheel(-2,0);});
   await waitFor(s=>s.mouse.wheel.x===0&&s.mouse.wheel.y===0,'wheel pulse expiry');
   report.osEventChecks.push({name:'mouse point/latest burst, three buttons, two wheel axes and expiry',passed:true});
   report.macOSPipelineValidated=true;
  }
  report.result='passed';
 }catch(error){report.result='failed';report.error=String(error);}
 finally{
  if(waiter){clearTimeout(waiter.timer);waiter=null;}
  // Release only this fixture's known generated presses; never request access.
  if((held.size||buttons.size)&&win&&!win.isDestroyed()){
   app.focus({steal:true});win.focus();await delay(80);
   if(win.isFocused()){
    const b=win.getBounds(),x=Math.round(b.x+b.width*.5),y=Math.round(b.y+b.height*.6);
    for(const [code,method] of held)method==='flags'?driver.postFlags(code,false):driver.postKey(code,false);
    for(const button of buttons)driver.postMouse([2,4,26][button],x,y,button);
   }else{report.cleanupPostSkipped='Own fixture could not regain focus; no global cleanup events posted';}
  }
  await input.stop();if(win&&!win.isDestroyed())win.destroy();
  const out=process.env.WHALE_INPUT_PROTOTYPE_REPORT,json=JSON.stringify(report,null,2);if(out)fs.writeFileSync(out,json+'\n');console.log('WHALE_INPUT_PROTOTYPE',json);app.exit(report.result==='passed'?0:1);
 }
});
