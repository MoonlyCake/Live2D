import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import pkg from '../package.json';

test('bundled JavaScript packages retain full copyright and permission text',()=>{
 const text=readFileSync('licenses/BUNDLED-NPM.txt','utf8');
 for(const name of ['pixi.js 6.5.10','pixi-live2d-display 0.4.0','uiohook-napi 1.5.5','node-gyp-build'])assert.ok(text.includes(name),name);
 for(const author of ['Mathew Groves','Chad Engler','Guan','Alexander Drozdov'])assert.ok(text.includes(author),author);
 assert.ok(text.includes('Permission is hereby granted, free of charge'));
 assert.ok(readFileSync('licenses/LICENSE.electron.txt','utf8').includes('Electron contributors'));
});

test('native input corresponding source and complete LGPL/GPL notices are explicit resources',()=>{
 for(const file of ['binding.gyp','src/lib/addon.c','libuiohook/include/uiohook.h','COPYING','COPYING.LESSER'])assert.ok(existsSync('third-party-source/uiohook-napi/'+file),file);
 assert.ok(readFileSync('third-party-source/uiohook-napi/binding.gyp','utf8').includes('static_library'));
 assert.ok(readFileSync('third-party-source/uiohook-napi/COPYING','utf8').includes('GNU GENERAL PUBLIC LICENSE'));
 assert.ok(readFileSync('third-party-source/uiohook-napi/COPYING.LESSER','utf8').includes('GNU LESSER GENERAL PUBLIC LICENSE'));
 assert.ok(pkg.build.files.includes('licenses/**/*'));
 assert.ok(pkg.build.extraResources.some(r=>r.from==='third-party-source'&&r.to==='third-party-source'));
});

test('published authoring manifests contain repository-relative paths',()=>{
 for(const file of ['art/production-v3-delivery-manifest.json','model-source/typing-v2/authoring.json'])assert.doesNotMatch(readFileSync(file,'utf8'),/\/workspace\/|\/home\/|\/Users\//);
 assert.equal(JSON.parse(readFileSync('model-source/typing-v2/authoring.json','utf8')).art,'art/production-v4-input-ready');
});
