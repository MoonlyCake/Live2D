/** Lock and suspend are independent: waking a locked machine must not restart capture. */
export class InputLifecycle {
 private enabled=false;private locked=false;private suspended=false;
 get allowed(){return this.enabled&&!this.locked&&!this.suspended}
 update(patch:{enabled?:boolean;locked?:boolean;suspended?:boolean}):'start'|'stop'|'none'{const before=this.allowed;if(patch.enabled!==undefined)this.enabled=patch.enabled;if(patch.locked!==undefined)this.locked=patch.locked;if(patch.suspended!==undefined)this.suspended=patch.suspended;return before===this.allowed?'none':this.allowed?'start':'stop';}
}
