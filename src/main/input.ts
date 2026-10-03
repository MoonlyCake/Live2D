import layout from '../../assets/keyboard.layout.json';
import {PhysicalInput, MOUSE_RECENT_MS, WHEEL_PULSE_MS, type PhysicalInputSnapshot, type PhysicalKeyBinding} from '../shared/physical-input';

export type CoarseInput = {kind:'typing'|'pointer'|'click'; gaze?:{x:number;y:number}};
export type InputStatus = {active:boolean;pointer:boolean;keyboard:boolean;keyboardObserved:boolean;message:string;counts:{typing:number;pointer:number;click:number}};
export type Hook = {on:(event:string,fn:(event?:any)=>void)=>unknown;start:()=>void;stop:()=>void;removeAllListeners:()=>void};
type Point = {x:number;y:number};
export type InputDependencies = {trusted:()=>boolean;point:()=>Point;loadHook:()=>Promise<Hook>;normalizeNativePoint?:(point:Point)=>Point;pointerSpace?:()=>{x:number;y:number;width:number;height:number}};

const MOVE_INTERVAL_MS = 16;
const FALLBACK_POLL_MS = 33;
const TRUST_CHECK_MS = 1000;
const clamp = (value:number) => Math.max(-1, Math.min(1, value));

/** Raw payloads stay in callbacks. Only current allowlisted key IDs and normalized device state leave. */
export class GlobalInput {
 private physical = new PhysicalInput(layout.keys as PhysicalKeyBinding[]);
 private physicalKey = '';
 private hook:Hook|undefined;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private timerAt = Infinity;
 private generation = 0;
 private running = false;
 private lastTyping = 0;
 private lastClick = 0;
 private lastPoint:Point|null = null;
 // Only the latest unpublished point is retained, never a native event or movement trail.
 private pendingPoint:Point|null = null;
 private nextMoveAt = 0;
 private nextFallbackAt = Infinity;
 private nextTrustAt = Infinity;
 private mouseDeadline = 0;
 private wheelDeadline = 0;
 private lastReport = 0;
 private status:InputStatus = {active:false,pointer:false,keyboard:false,keyboardObserved:false,message:'全局互动已关闭',counts:{typing:0,pointer:0,click:0}};

 constructor(private emit:(e:CoarseInput)=>void,private bounds:()=>{x:number;y:number;width:number;height:number},private deps:InputDependencies,private report:(s:InputStatus)=>void=()=>{},private physicalReport:(s:PhysicalInputSnapshot)=>void=()=>{}){}

 physicalSnapshot(){return this.physical.snapshot();}
 snapshot(){return {...this.status,counts:{...this.status.counts}};}
 private publishPhysical(){
  const snapshot = this.physical.snapshot(), key = JSON.stringify(snapshot);
  if(key !== this.physicalKey){this.physicalKey = key;this.physicalReport(snapshot);}
 }
 private send(event:CoarseInput){
  const firstKey = event.kind === 'typing' && !this.status.keyboardObserved;
  if(firstKey){this.status.keyboardObserved = true;this.status.message = '已实际收到系统键盘事件；鼠标与键盘分别检测。不记录输入内容。';}
  this.status.counts[event.kind]++;
  this.emit(event);
  if(firstKey || Date.now() - this.lastReport >= 500){this.lastReport = Date.now();this.report(this.snapshot());}
 }
 private pointerFailed(){
  if(!this.status.pointer)return;
  this.status.pointer = false;
  this.status.active = this.status.keyboard;
  this.status.message = '鼠标位置读取失败；键盘仍单独检测，请重新检测输入';
  this.report(this.snapshot());
 }
 private processPoint(p:Point){
  try{
   if(!Number.isFinite(p.x) || !Number.isFinite(p.y))throw new Error('Invalid pointer position');
   if(!this.status.pointer){
    this.status.pointer = true;this.status.active = true;
    this.status.message = '鼠标跟随已恢复；键盘仍单独检测。不记录输入内容。';
    this.report(this.snapshot());
   }
   if(this.lastPoint && p.x === this.lastPoint.x && p.y === this.lastPoint.y)return;
   const space = this.deps.pointerSpace?.();
   if(space && space.width > 0 && space.height > 0 && this.physical.move(clamp((p.x-space.x)/space.width*2-1),clamp((p.y-space.y)/space.height*2-1))){
    this.mouseDeadline = Date.now() + MOUSE_RECENT_MS;
    this.publishPhysical();
   }
   this.lastPoint = p;
   const b = this.bounds();
   this.send({kind:'pointer',gaze:{x:clamp((p.x-b.x-b.width/2)/400),y:clamp((p.y-b.y-b.height/2)/400)}});
  }catch{this.pointerFailed();}
 }
 private flushMove(now:number){
  const point = this.pendingPoint;
  this.pendingPoint = null;
  this.nextMoveAt = now + MOVE_INTERVAL_MS;
  if(point)this.processPoint(point);
 }
 /** One deadline timer: idle native input needs only the low-rate permission check. */
 private schedule(){
  if(!this.running)return;
  const due = Math.min(this.pendingPoint ? this.nextMoveAt : Infinity,this.wheelDeadline || Infinity,this.mouseDeadline || Infinity,this.nextTrustAt,this.nextFallbackAt);
  if(due === this.timerAt)return;
  clearTimeout(this.timer);this.timer = undefined;this.timerAt = due;
  if(!Number.isFinite(due))return;
  const generation = this.generation;
  this.timer = setTimeout(()=>{
   if(generation !== this.generation || !this.running)return;
   this.timer = undefined;this.timerAt = Infinity;
   this.tick();
  },Math.max(0,due-Date.now()));
 }
 private tick(){
  const now = Date.now();
  if(now >= this.nextTrustAt){
   this.nextTrustAt = now + TRUST_CHECK_MS;
   let trusted = false;
   try{trusted = this.deps.trusted();}catch{}
   if(!trusted){
    this.releaseHook();
    this.status.keyboard = false;this.status.keyboardObserved = false;this.status.active = this.status.pointer;
    this.status.message = '键盘权限已失效，已清空按键；请重新授权并检测';
    this.nextFallbackAt = now + FALLBACK_POLL_MS;
    this.report(this.snapshot());
   }
  }
  if(now >= this.nextFallbackAt){
   this.nextFallbackAt = now + FALLBACK_POLL_MS;
   try{this.processPoint(this.deps.point());}catch{this.pointerFailed();}
  }
  if(this.pendingPoint && now >= this.nextMoveAt)this.flushMove(now);
  // Snapshot expiry is deadline-driven; keys and held buttons have no expiry timer.
  let expired = false;
  if(this.wheelDeadline && now >= this.wheelDeadline){this.wheelDeadline = 0;expired = true;}
  if(this.mouseDeadline && now >= this.mouseDeadline){this.mouseDeadline = 0;expired = true;}
  if(expired)this.publishPhysical();
  this.schedule();
 }
 private releaseHook(){
  this.pendingPoint = null;this.nextMoveAt = 0;
  this.mouseDeadline = 0;this.wheelDeadline = 0;this.nextTrustAt = Infinity;
  const hook = this.hook;this.hook = undefined;
  if(hook){try{hook.stop();}catch{}try{hook.removeAllListeners();}catch{}}
  this.physical.reset();this.publishPhysical();
 }

 async start():Promise<InputStatus>{
  this.stop();const generation = this.generation;this.running = true;
  try{this.lastPoint = this.deps.point();this.status.pointer = true;}catch{}
  this.status.active = this.status.pointer;
  this.nextFallbackAt = Date.now() + FALLBACK_POLL_MS;
  this.schedule();
  let reason = '';
  try{
   if(!this.deps.trusted())reason = '键盘/点击尚未授权：请点“申请 macOS 键盘权限”，在系统辅助功能中勾选当前 Whale Companion Inochi，再点重新检测；若系统提示输入监控也需手动允许。旧2D版权限不通用；更新应用后可能需要重新授权';
   else{
    const hook = await this.deps.loadHook();
    if(generation !== this.generation)return this.snapshot();
    this.hook = hook;
    const on = (name:string,callback:(event?:any)=>void) => hook.on(name,event=>{
     if(this.running && generation === this.generation && this.hook === hook){
      // Preserve device ordering: an older queued move cannot steal a newer key's hand.
      // Discrete transitions are barriers and are never delayed by pointer coalescing.
      if(name !== 'mousemove' && name !== 'error' && this.pendingPoint)this.flushMove(Date.now());
      callback(event);this.schedule();
     }
    });
    on('keydown',event=>{
     this.physical.keyDown(event?.keycode);this.publishPhysical();
     const now = Date.now();if(now-this.lastTyping >= 110){this.lastTyping = now;this.send({kind:'typing'});}
    });
    on('keyup',event=>{this.physical.keyUp(event?.keycode);this.publishPhysical();});
    on('mousemove',event=>{
     if(!Number.isFinite(event?.x) || !Number.isFinite(event?.y))return;
     try{
      const point = this.deps.normalizeNativePoint?.({x:event.x,y:event.y}) ?? {x:event.x,y:event.y};
      if(!Number.isFinite(point.x) || !Number.isFinite(point.y))return;
      this.pendingPoint = {x:point.x,y:point.y};
      const now = Date.now();
      if(now >= this.nextMoveAt)this.flushMove(now);
     }catch{this.pointerFailed();}
    });
    on('mousedown',event=>{
     const button = event?.button === 1 ? 'left' : event?.button === 2 ? 'right' : event?.button === 3 ? 'middle' : null;
     if(button)this.physical.buttonDown(button);this.publishPhysical();
     const now = Date.now();if(now-this.lastClick >= 90){this.lastClick = now;this.send({kind:'click'});}
    });
    on('mouseup',event=>{
     const button = event?.button === 1 ? 'left' : event?.button === 2 ? 'right' : event?.button === 3 ? 'middle' : null;
     if(button)this.physical.buttonUp(button);this.publishPhysical();
    });
    on('wheel',event=>{
     if(Number.isFinite(event?.rotation) && this.physical.wheel(event.direction === 4 ? Math.sign(event.rotation) : 0,event.direction === 3 ? Math.sign(event.rotation) : 0)){
      this.wheelDeadline = this.mouseDeadline = Date.now() + WHEEL_PULSE_MS;
      this.publishPhysical();
     }
    });
    on('error',()=>{
     this.releaseHook();this.status.keyboard = false;this.status.keyboardObserved = false;this.status.active = this.status.pointer;
     this.status.message = '键盘监听运行失败；鼠标跟随单独运行，请重新检测';
     this.nextFallbackAt = Date.now() + FALLBACK_POLL_MS;
     this.report(this.snapshot());
    });
    hook.start();
    // A synchronous start error event may already have released this hook.
    if(this.hook === hook){this.status.keyboard = true;this.nextTrustAt = Date.now()+TRUST_CHECK_MS;this.nextFallbackAt = Infinity;}
    else reason = this.status.message;
   }
  }catch(error){
   if(generation !== this.generation)return this.snapshot();
   this.releaseHook();reason = `键盘组件启动失败：${error instanceof Error ? error.message : '未知错误'}`;
  }
  if(generation !== this.generation)return this.snapshot();
  this.status.active = this.status.pointer || this.status.keyboard;
  this.status.message = `鼠标跟随${this.status.pointer ? '已启动' : '不可用'}；${this.status.keyboard ? '键盘组件已启动，尚未收到实际按键；请切到其他应用连续输入，观察下方键盘计数' : reason}。不记录输入内容。`;
  this.schedule();this.report(this.snapshot());return this.snapshot();
 }
 stop(){
  this.generation++;this.running = false;
  clearTimeout(this.timer);this.timer = undefined;this.timerAt = Infinity;
  this.nextFallbackAt = Infinity;this.releaseHook();
  this.lastPoint = null;this.lastTyping = 0;this.lastClick = 0;this.lastReport = 0;
  this.status = {active:false,pointer:false,keyboard:false,keyboardObserved:false,message:'全局互动已关闭，临时计数已清除',counts:{typing:0,pointer:0,click:0}};
 }
}
