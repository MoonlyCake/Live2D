import layout from '../../../assets/keyboard.layout.json';
import {homography,perspectiveGrid,type Quad,type Point2} from '../../shared/perspective';
import type {InochiTexture} from '../../shared/inochi-runtime.mjs';

const labels:Record<string,string>={Escape:'Esc',Insert:'Ins',Delete:'Del',Home:'↖',End:'↘',PageUp:'P↑',PageDown:'P↓',Space:'Space',Backspace:'BS',Tab:'Tab',CapsLock:'Caps',Enter:'Enter',ShiftLeft:'Shift',ShiftRight:'Shift',ControlLeft:'Ctrl',ControlRight:'Ctrl',AltLeft:'Opt',AltRight:'Opt',MetaLeft:'Cmd',MetaRight:'Cmd'};
export const keyboardLabel=(key:typeof layout.keys[number])=>labels[key.id]||key.labelMac;
export const keyboardFont=(key:typeof layout.keys[number])=>keyboardLabel(key).length===1?20:14;

/** The same logical positions feed both this texture mesh and the hand's homography. */
export class PerspectiveKeyboard {
 readonly texture:InochiTexture;
 readonly mesh:ReturnType<typeof perspectiveGrid>;
 private canvas:OffscreenCanvas;
 private previous:string|null=null;
 constructor(quad:Quad,origin:Point2,private textureScale=1){
  this.canvas=new OffscreenCanvas(550*textureScale,170*textureScale);
  this.texture={width:this.canvas.width,height:this.canvas.height,pixels:new Uint8ClampedArray(this.canvas.width*this.canvas.height*4)};
  this.mesh=perspectiveGrid(homography(550,170,quad),550,170,origin);
  this.update([]);
 }
 update(pressed:readonly string[]){
  const stamp=pressed.join(',');
  if(stamp===this.previous)return false;
  this.previous=stamp;
  const c=this.canvas.getContext('2d')!;c.resetTransform();c.clearRect(0,0,this.canvas.width,this.canvas.height);c.scale(this.textureScale,this.textureScale);
  for(const key of [...layout.keys].sort((a,b)=>Number(pressed.includes(a.id))-Number(pressed.includes(b.id)))){
   const down=pressed.includes(key.id),x=key.x-360,y=key.y-820+(down?4:0);
   c.fillStyle=down?'#65c5f0':'#f8fafc';c.strokeStyle=down?'#2184b3':'#89929e';c.lineWidth=.7;
   c.beginPath();c.roundRect(x-key.width/2,y-10,key.width,20,2);c.fill();c.stroke();
   c.fillStyle='#172d43';c.font=`600 ${keyboardFont(key)}px "DejaVu Sans", Arial, sans-serif`;c.textAlign='center';c.textBaseline='alphabetic';
   const label=keyboardLabel(key),metrics=c.measureText(label);
   const baseline=y+(metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2;
   c.fillText(label,x,baseline,key.width-2);
  }
  const pixels=c.getImageData(0,0,this.canvas.width,this.canvas.height).data;
  for(let i=0;i<pixels.length;i+=4)for(let j=0;j<3;j++)pixels[i+j]=Math.round(pixels[i+j]*pixels[i+3]/255);
  this.texture.pixels=pixels;return true;
 }
}
