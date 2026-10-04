import layout from '../../assets/keyboard.layout.json';
import {homography,projectPoint,type Point2,type Quad} from './perspective';
import type {PhysicalInputSnapshot} from './physical-input';

type Sleeve={fixed:Point2;moving:Point2;baseAngle:number;baseLength:number;angleParameter:string;lengthParameter:string};
export interface WorkContract {
 schema:'whale-perspective-work-v1';canvas:Point2;origin:Point2;defaultWindowWidth:number;
 keyboard:{quad:Quad;logicalSize:Point2;sourceBounds:{x:number;y:number;width:number;height:number}};
 mouse:{quad:Quad;logicalSize:Point2;travel:{min:Point2;max:Point2};home:Point2;bodyNode:string};
 typingHand:{contactNode?:string;contactLocal?:Point2;restHandNode?:string;handNode:string;bridgeNode:string;reference:Point2;fingerAnchor:Point2;pressTravel:Point2;activeParameter:string;parameters:{x:string;y:string;press:string;angle?:string};sleeve:Sleeve};
 mouseHand:{contactNode?:string;contactLocal?:Point2;handNode:string;bridgeNode:string;reference:Point2;parameters:{x:string;y:string;left:string;right:string;wheel:string};sleeve:Sleeve};
 frontNodes:string[];defaultFace:Record<string,number>;
}
const keys=new Map(layout.keys.map(key=>[key.id,key]));
const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));

export function requiredWorkParameters(c:WorkContract){
 return [...Object.values(c.typingHand.parameters),c.typingHand.activeParameter,c.typingHand.sleeve.angleParameter,c.typingHand.sleeve.lengthParameter,...Object.values(c.mouseHand.parameters),c.mouseHand.sleeve.angleParameter,c.mouseHand.sleeve.lengthParameter];
}

/** Geometry is mandatory. A draft contract cannot activate a working scene. */
export function validateWorkContract(value:any):WorkContract {
 const point=(p:any)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
 if(value?.schema!=='whale-perspective-work-v1'||!point(value.canvas)||!point(value.origin)||value.canvas.some((n:number)=>n<=0))throw Error('工作场景坐标尚未完成');
 for(const plane of [value.keyboard,value.mouse]){
  if(!point(plane?.logicalSize)||!Array.isArray(plane.quad)||plane.quad.length!==4||!plane.quad.every(point))throw Error('工作设备透视平面无效');
  homography(plane.logicalSize[0],plane.logicalSize[1],plane.quad);
 }
 for(const hand of [value.typingHand,value.mouseHand])if(!point(hand?.reference)||!point(hand.sleeve?.fixed)||!point(hand.sleeve?.moving)||!Number.isFinite(hand.sleeve.baseAngle)||!(hand.sleeve.baseLength>0))throw Error('工作手部锚点尚未完成');
 if(!point(value.typingHand.pressTravel)||!point(value.mouse.home)||!point(value.mouse.travel?.min)||!point(value.mouse.travel?.max)||!Array.isArray(value.frontNodes))throw Error('工作场景行程尚未完成');
 return value;
}

export class WorkPose {
 private keyboard;
 private mouse;
 constructor(readonly contract:WorkContract){
  this.keyboard=homography(...contract.keyboard.logicalSize,contract.keyboard.quad);
  this.mouse=homography(...contract.mouse.logicalSize,contract.mouse.quad);
 }
 keyboardPoint(x:number,y:number,press=0):Point2 {
  const b=this.contract.keyboard.sourceBounds;
  return projectPoint(this.keyboard,x-b.x,y-b.y+4*press);
 }
 values(state:PhysicalInputSnapshot|undefined):Record<string,number>{
  const c=this.contract;
  const id=state?.targets.keyboard??(state?.targets.right==='mouse'?state?.targets.left:state?.targets.right||state?.targets.left);
  const key=id&&state?.pressed.includes(id)?keys.get(id):undefined;
  const press=key?1:0,target=key?this.keyboardPoint(key.x,key.y,press):c.typingHand.reference;
  const hand=c.typingHand,p=hand.parameters;
  const out:Record<string,number>={[p.x]:target[0]-hand.pressTravel[0]*press,[p.y]:target[1]-hand.pressTravel[1]*press,[p.press]:press,[hand.activeParameter]:press};
  let angle=0;
  if(p.angle){
   angle=wrap(Math.atan2(hand.sleeve.fixed[1]-target[1],hand.sleeve.fixed[0]-target[0])-Math.atan2(hand.sleeve.moving[1]-hand.reference[1],hand.sleeve.moving[0]-hand.reference[0]));
   out[p.angle]=angle;
  }
  this.sleeve(out,hand.sleeve,hand.reference,target,angle);
  const mouse=state?.mouse,travel=c.mouse.travel;
  const mouseLogical:Point2=mouse?[travel.min[0]+(mouse.x+1)/2*(travel.max[0]-travel.min[0]),travel.min[1]+(mouse.y+1)/2*(travel.max[1]-travel.min[1])]:c.mouse.home;
  const mt=projectPoint(this.mouse,...mouseLogical),mp=c.mouseHand.parameters;
  Object.assign(out,{[mp.x]:mt[0],[mp.y]:mt[1],[mp.left]:mouse?.buttons.left?1:0,[mp.right]:mouse?.buttons.right?1:0,[mp.wheel]:mouse?.wheel.y||mouse?.wheel.x||0});
  this.sleeve(out,c.mouseHand.sleeve,c.mouseHand.reference,mt,0);
  return out;
 }
 private sleeve(out:Record<string,number>,s:Sleeve,reference:Point2,target:Point2,angle:number){
  const x=s.moving[0]-reference[0],y=s.moving[1]-reference[1],cos=Math.cos(angle),sin=Math.sin(angle);
  const dx=target[0]+x*cos-y*sin-s.fixed[0],dy=target[1]+x*sin+y*cos-s.fixed[1];
  out[s.angleParameter]=wrap(Math.atan2(dy,dx)-s.baseAngle);
  out[s.lengthParameter]=Math.hypot(dx,dy)/s.baseLength;
 }
}

/** Keep a working pose through short pauses, then fade to the full-body scene. */
export function deskVisibility(lastActive:number,now:number){
 const age=now-lastActive;
 if(age<=4000)return{desk:true,opacity:1};
 if(age<4180)return{desk:true,opacity:1-(age-4000)/180};
 if(age<4360)return{desk:false,opacity:(age-4180)/180};
 return{desk:false,opacity:1};
}
