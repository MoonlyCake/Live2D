import type{InochiFrame,InochiTexture}from'../../shared/inochi-runtime.mjs';
export interface MeshRenderer {backend?:string;updateTexture?(id:number):void;draw(frame:InochiFrame):unknown;destroy():void;bounds?:unknown}
export interface TextureSource{texture(id:number):InochiTexture}
