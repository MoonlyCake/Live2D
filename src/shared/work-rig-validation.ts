import layout from '../../assets/keyboard.layout.json';
import {PhysicalInput} from './physical-input';
import {WorkPose,type WorkContract} from './work-scene';
import type {SubsetModel,InochiFrame} from './inochi-runtime.mjs';

/** Fixed local anchors are checked in actual transformed vertices, never inferred from an offset base frame. */
export function validateWorkRig(model:SubsetModel,contract:WorkContract){
 if(layout.keys.length!==83)throw Error('Work keyboard requires all83 keys');
 const names=new Map([...model.nodes].map(([id,{n}])=>[n.name,id]));
 function anchor(hand:WorkContract['typingHand']|WorkContract['mouseHand']){
  const id=names.get(hand.contactNode||hand.handNode),node=id===undefined?undefined:model.nodes.get(id)?.n;
  if(!node||!hand.contactLocal)throw Error('Missing fixed local contact anchor');
  const mesh=node.mesh,[x,y]=hand.contactLocal;
  for(let j=0;j<mesh.indices.length;j+=3){
   const indices=mesh.indices.slice(j,j+3),[a,b,c]=indices.map((i:number)=>[mesh.verts[i*2]-mesh.origin[0],mesh.verts[i*2+1]-mesh.origin[1]]);
   const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(denominator)<1e-9)continue;
   const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denominator,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denominator,w=1-u-v;
   if(Math.min(u,v,w)>=-1e-5)return{id:id!,mesh,indices,weights:[u,v,w]};
  }
  throw Error('Contact anchor is outside '+hand.contactNode);
 }
 const typing=anchor(contract.typingHand),mouse=anchor(contract.mouseHand),pose=new WorkPose(contract),input=new PhysicalInput(layout.keys,()=>1000);
 let maximumError=0;
 function contact(frame:InochiFrame,a:ReturnType<typeof anchor>,x:number,y:number){
  const command=frame.commands.find(c=>c.partId===a.id)!;
  const offset=frame.indices[command.indexOffset]-a.mesh.indices[0];
  const actual=[0,1].map(axis=>a.indices.reduce((sum:number,index:number,k:number)=>sum+frame.vertices[(offset+index)*4+axis]*a.weights[k],0));
  const error=Math.max(Math.abs(actual[0]-(x-contract.origin[0])),Math.abs(actual[1]-(y-contract.origin[1])));
  if(error>.03)throw Error('Work absolute contact mismatch: '+error);
  maximumError=Math.max(maximumError,error);
 }
 function frame(){
  const values=pose.values(input.snapshot());
  for(const [name,value]of Object.entries(values)){
   const parameter=model.params.find(p=>p.name===name);
   if(!parameter||value<parameter.min[0]-1e-5||value>parameter.max[0]+1e-5)throw Error('Work target outside authored parameter range: '+name+'='+value);
  }
  return{values,frame:model.frame(values)};
 }
 function opacity(f:InochiFrame,name:string){return f.commands.find(c=>c.partId===names.get(name))?.opacity??1;}
 for(const key of layout.keys){
  input.reset();input.keyDown(key.nativeCode);const down=frame(),target=pose.keyboardPoint(key.x,key.y,1);
  contact(down.frame,typing,...target);
  if(opacity(down.frame,contract.typingHand.handNode)!==1||opacity(down.frame,contract.typingHand.restHandNode!)!==0)throw Error('Raised/down hands are not exclusive');
  input.keyUp(key.nativeCode);const up=frame();
  if(opacity(up.frame,contract.typingHand.handNode)!==0||opacity(up.frame,contract.typingHand.restHandNode!)!==1)throw Error('Key release did not restore raised hand');
 }
 for(const x of [-1,0,1])for(const y of [-1,0,1]){
  input.reset();input.move(x,y);input.buttonDown('left');input.buttonDown('right');const current=frame();
  contact(current.frame,mouse,current.values[contract.mouseHand.parameters.x],current.values[contract.mouseHand.parameters.y]);
 }
 return{keys:83,mousePositions:9,maximumContactErrorSourcePixels:maximumError,source:'Fixed mesh-local barycentric anchors mapped through actual final world vertices'};
}
