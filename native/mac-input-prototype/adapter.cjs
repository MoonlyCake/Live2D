'use strict';
// Explicit experimental entrypoint. Production main never imports this module.
const ids = require('./key-ids.json');
const emptyState=()=>({pressed:[],mouse:{x:0,y:0,buttons:{left:false,right:false,middle:false},wheel:{x:0,y:0}},targets:{left:null,right:null,keyboard:null}});
const causes=new Set(['startup','reset','caps_pulse','reconcile','pointer','deadline','native_key_down','native_key_up','native_modifier','native_mouse_down','native_mouse_up','native_wheel']);
const known = new Set(ids), statuses = new Set(['stopped','starting','running','permission_denied','backend_unavailable','tap_create_failed','tap_disabled','queue_overflow','shutdown_timeout','callback_failed','startup_timeout','secure_input','failed']);
function parsePacket(json) {
 if (typeof json !== 'string' || json.length > 16384) throw Error('Invalid native input packet');
 const p=JSON.parse(json);
 if(p?.v!==1)throw Error('Unsupported native input protocol');
 if(p.type==='status'&&statuses.has(p.status))return{v:1,type:'status',status:p.status};
 const s=p.state,m=s?.mouse,t=s?.targets;
 const key=value=>value===null||known.has(value);
 if((p.cause!==undefined&&!causes.has(p.cause))||p.type!=='state'||!Array.isArray(s?.pressed)||s.pressed.length>32||new Set(s.pressed).size!==s.pressed.length||!s.pressed.every(id=>known.has(id))||!m||!t||![m.x,m.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1)||!['left','right','middle'].every(b=>typeof m.buttons?.[b]==='boolean')||![m.wheel?.x,m.wheel?.y].every(v=>v===-1||v===0||v===1)||!key(t.left)||!(t.right==='mouse'||key(t.right))||!key(t.keyboard))throw Error('Invalid native current state');
 // Rebuild a closed object: native payloads can never add text, window or history fields.
 return{v:1,type:'state',...(p.cause?{cause:p.cause}:{}),state:{pressed:[...s.pressed],mouse:{x:m.x,y:m.y,buttons:{left:m.buttons.left,right:m.buttons.right,middle:m.buttons.middle},wheel:{x:m.wheel.x,y:m.wheel.y}},targets:{left:t.left,right:t.right,keyboard:t.keyboard}}};
}
class MacInputPrototype {
 constructor(native) {this.native=native;this.generation=0;this.queue=Promise.resolve();this.fault=null;this.onPacket=null;}
 permissionGranted(){return this.native.permissionGranted();}
 status(){return this.native.serviceStatus();}
 // Called only by an explicit user authorization button, never by start or retry.
 requestPermission(){return this.native.requestPermission();}
 detach(){const consumer=this.onPacket;this.onPacket=null;const generation=++this.generation;if(consumer){try{consumer({v:1,type:'state',state:emptyState()},{native:false});}catch{this.fault='consumer_failed';}}return generation;}
 start(onPacket) {
  const generation=this.detach();if(generation!==this.generation)return Promise.resolve('cancelled');this.onPacket=onPacket;
  const work=this.queue.then(async()=>{
   await this.native.stop();
   if(generation!==this.generation)return'cancelled';
   return this.native.start((error,json)=>{
    if(generation!==this.generation)return;
    try{if(error)throw error;onPacket(parsePacket(json),{native:true});}
    catch{this.fault='invalid_or_unhandled_packet';void this.stop();}
   });
  });
  this.queue=work.catch(()=>{});return work;
 }
 stop(){const generation=this.detach();if(generation!==this.generation)return Promise.resolve('cancelled');const work=this.queue.then(()=>this.native.stop());this.queue=work.catch(()=>{});return work;}
}
module.exports={MacInputPrototype,parsePacket};
