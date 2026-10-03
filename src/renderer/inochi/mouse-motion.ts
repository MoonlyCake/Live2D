import type {PhysicalInputSnapshot} from '../../shared/physical-input';

/** Latest pointer only. Keys/buttons are immediate; both hand and device use this result. */
export class MouseMotion {
 private target:{x:number;y:number}|null = null;
 private from = {x:0,y:0};
 private current = {x:0,y:0};
 private started = 0;
 private active = false;
 private buttons = '';

 reset(){
  this.target = null;
  this.active = false;
  this.buttons = '';
 }

 sample(state:PhysicalInputSnapshot|undefined, now:number, enabled=true):PhysicalInputSnapshot|undefined {
  if(!state){this.reset();return state;}
  const mouse = state.targets.right === 'mouse' && enabled;
  const buttons = JSON.stringify(state.mouse.buttons);
  const target = {x:state.mouse.x,y:state.mouse.y};
  // Entering mouse mode, clicking, or resuming a stalled frame must use the exact point.
  const snap = !this.target || !mouse || !this.active || buttons !== this.buttons || now-this.started > 250;
  if(snap){
   this.current = target;
   this.from = target;
   this.target = target;
   this.started = now;
  }else{
   const p = Math.max(0,Math.min(1,(now-this.started)/24));
   this.current = {
    x:this.from.x+(this.target!.x-this.from.x)*p,
    y:this.from.y+(this.target!.y-this.from.y)*p,
   };
   if(target.x !== this.target!.x || target.y !== this.target!.y){
    this.from = this.current;
    this.target = target;
    this.started = now;
   }
  }
  this.active = mouse;
  this.buttons = buttons;
  return {...state,mouse:{...state.mouse,x:this.current.x,y:this.current.y}};
 }
}
