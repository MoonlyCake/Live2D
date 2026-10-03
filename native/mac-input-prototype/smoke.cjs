'use strict';
// Invoked only inside a separate signed prototype .app, never the user's app/profile.
const {app}=require('electron');const {join}=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {MacInputPrototype}=require('./adapter.cjs');
const profile=join(app.getPath('temp'),'whale-input-prototype-smoke');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
app.whenReady().then(async()=>{
 const addon=require(join(process.resourcesPath,'../Frameworks/whale-mac-input.node'));
 const input=new MacInputPrototype(addon),granted=input.permissionGranted();
 const report={platform:process.platform,arch:process.arch,permissionGranted:granted,permissionRequested:false,passes:[],packets:0,realHardwareInputValidated:false,secureInputValidated:false,permissionRevocationValidated:false,sleepWakeValidated:false};
 try{
  for(let n=0;n<3;n++){
   const status=await input.start(()=>{report.packets++;});
   if(granted)assert.ok(['running','secure_input'].includes(status),status);else assert.equal(status,'permission_denied');
   report.passes.push({stage:'native-start',status});
   assert.equal(await input.stop(),'stopped');assert.equal(input.status(),'stopped');
   report.passes.push({stage:'native-stop',status:'stopped'});
  }
  if(!granted)assert.equal(report.packets,0);
  report.result='passed';
 }catch(error){report.result='failed';report.error=String(error);process.exitCode=1;}
 finally{await input.stop();const out=process.env.WHALE_INPUT_PROTOTYPE_REPORT;const json=JSON.stringify(report,null,2);if(out)fs.writeFileSync(out,json+'\n');console.log('WHALE_INPUT_PROTOTYPE',json);app.exit(report.result==='passed'?0:1);}
});
