import layout from '../../../assets/keyboard.layout.json';
import type {PhysicalInputSnapshot} from '../../shared/physical-input';
import type {InochiFrame,InochiTexture} from '../../shared/inochi-runtime.mjs';
export const DEVICE_RECT={x:360,y:820,width:680,height:210};
/** Device art is an actual textured quad in the model drawlist, behind the articulated hands. */
export class DeviceSurface{
 readonly canvas:OffscreenCanvas;readonly texture:InochiTexture;private key='';
 constructor(){this.canvas=new OffscreenCanvas(DEVICE_RECT.width,DEVICE_RECT.height);this.texture={width:this.canvas.width,height:this.canvas.height,pixels:new Uint8ClampedArray(this.canvas.width*this.canvas.height*4)}}
 update(state:PhysicalInputSnapshot|undefined){const key=JSON.stringify(state??null);if(key===this.key)return false;this.key=key;const c=this.canvas.getContext('2d')!;c.clearRect(0,0,this.canvas.width,this.canvas.height);c.save();c.translate(-DEVICE_RECT.x,-DEVICE_RECT.y);
 const box=(x:number,y:number,w:number,h:number,r:number,fill:string,stroke='#b6c9e0')=>{c.fillStyle=fill;c.strokeStyle=stroke;c.lineWidth=1.5;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();c.stroke()};
 box(360,820,550,170,12,'#e5f0ff','#be9a4c');box(366,826,538,158,9,'#d4e3f5');
 const pressed=new Set(state?.pressed??[]);for(const k of layout.keys){const down=pressed.has(k.id as any),y=k.y-k.height/2+(down?4:0);box(k.x-k.width/2,y,k.width,k.height,3,down?'#58b9ef':'#f8fbff',down?'#dba846':'#a2b8d1');c.fillStyle=down?'#122d4a':'#305171';c.font=`${k.id.startsWith('Key')?11:8}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(k.labelMac,k.x,k.y+(down?4:0),k.width-3);}
 const pad=layout.mouse.pad;box(pad.x,pad.y,pad.width,pad.height,12,'#d9e8f6','#be9a4c');const t=layout.mouse.travel,mouse=state?.mouse;const x=mouse?t.minX+(mouse.x+1)/2*(t.maxX-t.minX):layout.mouse.home.x,y=mouse?t.minY+(mouse.y+1)/2*(t.maxY-t.minY):layout.mouse.home.y;box(x-29,y-35,58,70,20,'#f7fbff');box(x-25,y+6,24,26,7,mouse?.buttons.left?'#62baef':'#e9f4ff');box(x+1,y+6,24,26,7,mouse?.buttons.right?'#62baef':'#e9f4ff');box(x-3,y+9,6,13,3,mouse?.buttons.middle?'#dbaa43':'#758cab');if(mouse?.wheel.x||mouse?.wheel.y){c.strokeStyle='#da9e30';c.lineWidth=3;c.beginPath();c.moveTo(x,y+16);c.lineTo(x+(mouse.wheel.x||0)*9,y+16+(mouse.wheel.y||0)*9);c.stroke();}c.restore();const pixels=c.getImageData(0,0,this.canvas.width,this.canvas.height).data;for(let i=0;i<pixels.length;i+=4)for(let j=0;j<3;j++)pixels[i+j]=Math.round(pixels[i+j]*pixels[i+3]/255);this.texture.pixels=pixels;return true;
 }
}
export function insertDeviceMesh(frame:InochiFrame,mesh:{vertices:Float32Array;indices:Uint32Array},texture:number,frontIds:Set<number>,opacity=1):InochiFrame{
 const v=frame.vertices.length/4,o=frame.indices.length,vertices=new Float32Array(frame.vertices.length+mesh.vertices.length);
 vertices.set(frame.vertices);vertices.set(mesh.vertices,frame.vertices.length);
 const indices=new Uint32Array(frame.indices.length+mesh.indices.length);indices.set(frame.indices);
 for(let i=0;i<mesh.indices.length;i++)indices[o+i]=mesh.indices[i]+v;
 const behind=frame.commands.filter(c=>!frontIds.has(c.partId??-1)),front=frame.commands.filter(c=>frontIds.has(c.partId??-1));
 return{...frame,vertices,indices,commands:[...behind,{partId:4294967294,state:0,blend:0,type:0x101,texture,count:mesh.indices.length,indexOffset:o,opacity},...front]};
}
export function insertDeviceQuad(frame:InochiFrame,texture:number,frontIds:Set<number>,visible:boolean):InochiFrame{
 const r=DEVICE_RECT;
 return insertDeviceMesh(frame,{vertices:new Float32Array([r.x-627,r.y-627,0,0,r.x+r.width-627,r.y-627,1,0,r.x-627,r.y+r.height-627,0,1,r.x+r.width-627,r.y+r.height-627,1,1]),indices:new Uint32Array([0,1,2,1,3,2])},texture,frontIds,visible?1:0);
}
