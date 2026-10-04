/** User-owned OS authorization. This controller never grants OS permissions. */
export interface PermissionGuideDeps {
 enabled:()=>boolean; trusted:()=>boolean; seen:()=>boolean; markSeen:()=>void;
 ask:()=>Promise<boolean>; request:()=>void; restart:()=>Promise<unknown>;
 schedule:(tick:()=>void)=>()=>void; notice:(message:string)=>void;
}
export class InputPermissionGuide {
 private cancel:(()=>void)|undefined;private pending=false;private generation=0;
 constructor(private deps:PermissionGuideDeps){}
 async offer(){if(!this.deps.enabled()||this.deps.trusted()||this.deps.seen()||this.pending)return;this.pending=true;const generation=this.generation;this.deps.markSeen();try{const accepted=await this.deps.ask();if(accepted&&generation===this.generation&&this.deps.enabled())this.request();}catch{this.deps.notice('权限提示暂时无法打开，请在控制面板点申请 macOS 键盘权限。');}finally{this.pending=false;}}
 request(){if(!this.deps.enabled())return;this.stop();this.deps.request();const generation=this.generation;let ticks=0;const check=async()=>{if(generation!==this.generation)return;if(!this.deps.enabled()){this.stop();return;}if(this.deps.trusted()){this.stop();const restartGeneration=this.generation;await this.deps.restart();if(restartGeneration!==this.generation||!this.deps.enabled())return;this.deps.notice('键盘权限已允许，已尝试重新连接。可回到其他应用正常打字。');}else if(++ticks>=90){this.stop();this.deps.notice('尚未检测到键盘权限。你可以稍后点重新连接键鼠；必要时安全退出再打开当前版本。');}};this.cancel=this.deps.schedule(()=>{void check();});void check();}
 stop(){this.generation++;this.cancel?.();this.cancel=undefined;}
}
