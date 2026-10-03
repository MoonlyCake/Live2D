type FrameCallback = (timestamp: number) => void;

export interface AnimationFrameLoopOptions {
  requestFrame?(callback: FrameCallback): number;
  cancelFrame?(handle: number): void;
  onFrame(timestamp: number): number | void;
}

/** Owns one RAF or idle delay. Events wake delays; missed frames are not replayed. */
export class AnimationFrameLoop {
  private active = false;
  private destroyed = false;
  private readonly blockers = new Set<string>();
  private pending: { delayed: boolean; cancel(): void } | null = null;

  constructor(private readonly options: AnimationFrameLoopOptions) {}

  resume() {
    if (this.destroyed) return;
    this.active = true;
    this.schedule();
  }

  pause() {
    this.active = false;
    this.cancel();
  }

  /** Independent gates keep a show/restore from overriding document visibility. */
  setBlocked(reason: string, blocked: boolean) {
    if (this.destroyed) return;
    if (blocked) this.blockers.add(reason);
    else this.blockers.delete(reason);
    if (this.allowed) this.schedule();
    else this.cancel();
  }

  /** Request a frame only if resumed and unblocked; repeated wake-ups coalesce. */
  wake() {
    if (this.pending?.delayed) this.cancel();
    this.schedule();
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    this.blockers.clear();
  }

  private get allowed() {
    return this.active && !this.destroyed && this.blockers.size === 0;
  }

  private cancel() {
    const pending = this.pending;
    // Invalidate before cancellation, including a callback already queued to run.
    this.pending = null;
    pending?.cancel();
  }

  private schedule(interval = 16) {
    if (!this.allowed || this.pending) return;
    const pending = { delayed: interval > 16, cancel() {} };
    this.pending = pending;
    if (pending.delayed) {
      const handle = setTimeout(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        this.schedule();
      }, interval - 16);
      pending.cancel = () => clearTimeout(handle);
      return;
    }
    const handle = (this.options.requestFrame ?? requestAnimationFrame)(timestamp => {
      // A late cancelled callback must not clear a newer frame or idle delay.
      if (this.pending !== pending) return;
      this.pending = null;
      this.schedule(this.options.onFrame(timestamp) ?? 16);
    });
    pending.cancel = () => (this.options.cancelFrame ?? cancelAnimationFrame)(handle);
  }
}
