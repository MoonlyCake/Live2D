import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseContainer,SubsetModel} from '../src/shared/inochi-runtime.mjs';
import {validateWorkContract} from '../src/shared/work-scene';
import {validateWorkRig} from '../src/shared/work-rig-validation';

const contract=validateWorkContract(JSON.parse(readFileSync('assets/inochi/work-rig.json','utf8')));
function model(){const p=parseContainer(readFileSync('assets/inochi/WhaleGirl-work.inp'));return new SubsetModel(p.model,p.textures.length);}
test('formal perspective export aligns all83 contacts and9 mouse positions absolutely',()=>{
 const result=validateWorkRig(model(),contract);assert.ok(result);
});
test('a translated hand cannot pass by cancelling against its neutral baseline',()=>{
 const rig=model(),hand=[...rig.nodes.values()].find(v=>v.n.name==='TypingHandR')!;
 hand.n.transform.trans[0]+=100;
 assert.throws(()=>validateWorkRig(rig,contract),/contact|mismatch|触点/i);
});
