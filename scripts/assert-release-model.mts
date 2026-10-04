import {validateWorkContract,requiredWorkParameters} from '../src/shared/work-scene';
import {validateWorkRig} from '../src/shared/work-rig-validation';
import{validatePhysicalRig}from'../src/shared/physical-rig-validation';
import{readFileSync,statSync}from'node:fs';import{parseContainer,SubsetModel}from'../src/shared/inochi-runtime.mjs';import{inochiCapabilities}from'../src/renderer/inochi';
const path='assets/inochi/WhaleGirl.inp';if(statSync(path).size>32*1024*1024)throw Error('Final model exceeds size budget');const parsed=parseContainer(readFileSync(path)),rig=new SubsetModel(parsed.model,parsed.textures.length),c=inochiCapabilities(rig.params);if(!c.physicalInput||!c.eating||!c.blink||!c.typing||!c.gaze||c.moods.length!==5||c.parameters.length<44||!['ParamEyeBallX','ParamEyeBallY','ParamMouthOpenY','ParamMouthForm'].every(n=>c.parameters.includes(n)))throw Error('Final bundled model lacks complete authored capabilities');/* Preserve official-export metadata; readiness is proven by bound capabilities and native action acceptance, not its historical title. */rig.frame();console.log('Exact physical geometry:',validatePhysicalRig(rig));console.log('Final Inochi release model validated:',parsed.model.meta.name,rig.params.length,'authored parameters');

// The perspective working scene is mandatory in this release, not a fallback to the old pet.
const workPath='assets/inochi/WhaleGirl-work.inp';
if(statSync(workPath).size>32*1024*1024)throw Error('Working model exceeds size budget');
if(!readFileSync(workPath).equals(readFileSync('model-source/perspective-work/WhaleGirl-work.inp')))throw Error('Working model differs from the accepted native export');
const workParsed=parseContainer(readFileSync(workPath)),workRig=new SubsetModel(workParsed.model,workParsed.textures.length);
if([...workRig.nodes.values()].filter(({n})=>n.type==='Part').length!==27||![...workRig.nodes.values()].some(({n})=>n.name==='FaceSurfaceRestore'))throw Error('Working model lacks the accepted face-surface correction');
const contract=validateWorkContract(JSON.parse(readFileSync('assets/inochi/work-rig.json','utf8'))),workCapabilities=inochiCapabilities(workRig.params);
for(const name of [...requiredWorkParameters(contract),'ParamEyeLOpen','ParamEyeROpen','ParamEyeBallX','ParamEyeBallY','ParamMouthOpenY','ParamMouthForm'])if(!workCapabilities.parameters.includes(name))throw Error('Working model lacks authored role '+name);
console.log('Perspective work geometry:',validateWorkRig(workRig,contract));
console.log('Perspective work scene required:',workRig.params.length,'authored parameters',contract.canvas,'default width',contract.defaultWindowWidth);
