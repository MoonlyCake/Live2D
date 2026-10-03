// Actual Node-API .node loading. On Linux this tests only the explicit unavailable stub.
const {test}=require('node:test'),assert=require('node:assert/strict');
const native=require('./build/whale-mac-input.node');
test('real addon exports the narrow API without requesting capture on load',async()=>{
 for(const name of ['permissionGranted','requestPermission','serviceStatus','start','stop'])assert.equal(typeof native[name],'function');
 assert.equal(await native.stop(),'stopped');
 if(process.platform!=='darwin'){assert.equal(native.permissionGranted(),false);assert.equal(await native.start(()=>{}),'backend_unavailable');await native.stop();}
});
test('native stop-before-start tasks cannot invalidate a newer lifecycle ticket',async()=>{
 if(process.platform==='darwin')return; // macOS native gate is the signed, no-prompt app smoke.
 let callbacks=0;
 for(let i=0;i<100;i++){
  const stopped=native.stop();const started=native.start(()=>callbacks++);
  const [a,b]=await Promise.all([stopped,started]);assert.equal(a,'stopped');assert.equal(b,'backend_unavailable');
 }
 assert.equal(callbacks,0);assert.equal(await native.stop(),'stopped');
});
test('native stop invalidates an older deferred start before it can attach',async()=>{
 if(process.platform==='darwin')return;
 for(let i=0;i<100;i++){
  const started=native.start(()=>{});const stopped=native.stop();
  assert.ok(['cancelled','backend_unavailable'].includes(await started));assert.equal(await stopped,'stopped');assert.equal(native.serviceStatus(),'stopped');
 }
});
