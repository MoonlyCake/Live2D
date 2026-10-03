/** Manual panel preview only. The initiating click may arrive again through the global hook. */
export class MealPreview {
 private started:number|null=null;private caughtUntil=0;
 start(now:number){this.started=now;this.caughtUntil=0;}
 activity(now:number){if(this.started!==null&&now-this.started>=150&&now-this.started<6500){this.started=null;this.caughtUntil=now+900;}}
 view(now:number){const elapsed=this.started===null?Infinity:now-this.started;if(elapsed>=6500)this.started=null;return{eating:elapsed>=0&&elapsed<6500?Math.max(.001,elapsed/6500):0,hidingBowl:now<this.caughtUntil,innocent:now<this.caughtUntil};}
}
