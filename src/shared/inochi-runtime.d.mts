export interface InochiParameter {name:string;min:number[];max:number[];defaults:number[];bindings:{node:number;param_name:string;values:any[][];isSet:boolean[][]}[]}
export interface InochiFrame {vertices:Float32Array;indices:Uint32Array;commands:{partId?:number;state:number;blend:number;type:number;texture:number;count:number;indexOffset:number;opacity?:number}[]}
export interface InochiTexture {width:number;height:number;pixels:Uint8Array|Uint8ClampedArray}
export function parseContainer(bytes:Uint8Array|ArrayBuffer):{model:any;textures:{type:number;bytes:Uint8Array}[]};
export function decodeTGA(bytes:Uint8Array):InochiTexture;
export class SubsetModel {constructor(model:any,textureCount:number);params:InochiParameter[];nodes:Map<number,{n:any;parent:number|null}>;frame(values?:Record<string,number>):InochiFrame;}
