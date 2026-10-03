import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, sanitizeSettings, type PetSettings } from '../shared/domain';
export type AppSettings = PetSettings & { globalInputEnabled:boolean; inputPreferenceVersion:1; inputPermissionPromptSeen:boolean; audioSource:'microphone'|'system'; audioDeviceId:string; modelPath:string; corePath:string; x?:number; y?:number };
export function cleanSettings(value:unknown):AppSettings {
 const v=(value && typeof value==='object'?value:{}) as Record<string,unknown>;
 return {...sanitizeSettings(v),globalInputEnabled:v.inputPreferenceVersion===1&&typeof v.globalInputEnabled==='boolean'?v.globalInputEnabled:true,inputPreferenceVersion:1,inputPermissionPromptSeen:v.inputPermissionPromptSeen===true,audioSource:v.audioSource==='system'?'system':'microphone',audioDeviceId:typeof v.audioDeviceId==='string'?v.audioDeviceId.slice(0,256):'',modelPath:typeof v.modelPath==='string'?v.modelPath:'',corePath:typeof v.corePath==='string'?v.corePath:'',...(Number.isFinite(v.x)?{x:Math.round(Math.max(-100000,Math.min(100000,v.x as number)))}:{}),...(Number.isFinite(v.y)?{y:Math.round(Math.max(-100000,Math.min(100000,v.y as number)))}:{})};
}
export function loadSettings(path:string):AppSettings {try{return {...cleanSettings(JSON.parse(readFileSync(path,'utf8'))),audioEnabled:false,clickThrough:false};}catch{return cleanSettings(DEFAULT_SETTINGS);}}
export function saveSettings(path:string,settings:AppSettings):void {mkdirSync(dirname(path),{recursive:true});const temp=path+'.tmp';writeFileSync(temp,JSON.stringify(settings,null,2),{mode:0o600});renameSync(temp,path);}
