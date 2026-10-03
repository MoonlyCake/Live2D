/** Pointer drag reducer: only owner pointer can move, lock cancels in-flight drags. */
export class PetDrag {
  private generation = 0;
  private current: {id:number;x:number;y:number;screenX:number;screenY:number}|null = null;
  cancel(): void { this.generation++; this.current = null; }
  async begin(id:number,screenX:number,screenY:number,bounds:()=>Promise<{x:number;y:number}>,canMove:()=>boolean):Promise<void> {
    this.cancel();
    if (!canMove()) return;
    const request = this.generation;
    const origin = await bounds();
    if (request !== this.generation || !canMove()) return;
    this.current = {id,x:origin.x,y:origin.y,screenX,screenY};
  }
  move(id:number,screenX:number,screenY:number,allowed:boolean):{x:number;y:number}|null {
    if (!allowed) this.cancel();
    const d=this.current;
    if (!d || d.id !== id || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
    return {x:d.x+screenX-d.screenX,y:d.y+screenY-d.screenY};
  }
}
