import type{InochiFrame}from'../../shared/inochi-runtime.mjs';import type{TextureSource}from'./renderer-types';
export class InochiProofRenderer{constructor(canvas:HTMLCanvasElement,runtime:TextureSource);updateTexture(id:number):void;draw(frame:InochiFrame):unknown;destroy():void;bounds?:unknown;backend?:string;}
