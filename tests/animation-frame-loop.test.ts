import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationFrameLoop } from '../src/shared/animation-frame-loop';

function harness(onFrame: (timestamp: number) => number | void = () => {}) {
  let nextHandle = 0;
  const queued = new Map<number, (timestamp: number) => void>();
  const callbacks = new Map<number, (timestamp: number) => void>();
  const cancelled: number[] = [];
  const frames: number[] = [];
  const loop = new AnimationFrameLoop({
    requestFrame(callback) {
      const handle = nextHandle++;
      queued.set(handle, callback);
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) { cancelled.push(handle); queued.delete(handle); },
    onFrame(timestamp) { frames.push(timestamp); return onFrame(timestamp); },
  });
  return {
    loop, queued, cancelled, frames,
    fire(handle: number, timestamp = 16) {
      queued.delete(handle);
      assert.ok(callbacks.has(handle), 'the callback was requested');
      callbacks.get(handle)!(timestamp);
    },
  };
}

function fakeTimers(t: TestContext) {
  let nextHandle = 0;
  const queued = new Map<ReturnType<typeof setTimeout>, () => void>();
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void>();
  const delays: number[] = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
    const handle = nextHandle++ as unknown as ReturnType<typeof setTimeout>;
    queued.set(handle, callback); callbacks.set(handle, callback); delays.push(delay);
    return handle;
  });
  t.mock.method(globalThis, 'clearTimeout', (handle: ReturnType<typeof setTimeout>) => queued.delete(handle));
  return {
    queued, delays,
    fire(handle: ReturnType<typeof setTimeout>) {
      queued.delete(handle); callbacks.get(handle)!();
    },
  };
}

test('starts paused, repeats show/wake once, and hides without an idle RAF', () => {
  const h = harness();
  h.loop.wake();
  assert.equal(h.queued.size, 0);
  h.loop.resume(); h.loop.resume(); h.loop.wake();
  assert.deepEqual([...h.queued.keys()], [0]);
  h.fire(0);
  assert.deepEqual(h.frames, [16]);
  assert.deepEqual([...h.queued.keys()], [1]);
  h.loop.pause(); h.loop.pause(); h.loop.wake();
  assert.deepEqual(h.cancelled, [1]);
  assert.equal(h.queued.size, 0);
  h.loop.resume(); h.loop.resume();
  assert.deepEqual([...h.queued.keys()], [2]);
  h.fire(2, 160);
  assert.deepEqual(h.frames, [16, 160]);
  assert.equal(h.queued.size, 1);
});

test('window hide/minimize and document visibility gates resume only when both allow it', () => {
  const h = harness();
  h.loop.resume();
  h.loop.setBlocked('panel-hidden', true);
  h.loop.setBlocked('document-hidden', true);
  assert.deepEqual(h.cancelled, [0]); // Handle zero must still be cancelled.
  h.loop.setBlocked('panel-hidden', false); // show/restore while document hidden
  h.loop.setBlocked('panel-hidden', false);
  assert.equal(h.queued.size, 0);
  h.loop.setBlocked('document-hidden', false);
  h.loop.setBlocked('document-hidden', false);
  assert.deepEqual([...h.queued.keys()], [1]);
  h.loop.setBlocked('panel-hidden', true);
  h.loop.setBlocked('document-hidden', true);
  h.loop.setBlocked('document-hidden', false); // document visible before restore
  assert.equal(h.queued.size, 0);
  h.loop.setBlocked('panel-hidden', false);
  assert.deepEqual([...h.queued.keys()], [2]);
});

test('loading remembers every visibility transition and never starts a hidden preview', () => {
  const h = harness();
  h.loop.setBlocked('model-loading', true);
  h.loop.resume();
  h.loop.setBlocked('panel-hidden', true);
  h.loop.setBlocked('panel-hidden', false);
  h.loop.setBlocked('panel-hidden', true);
  h.loop.setBlocked('model-loading', false);
  assert.equal(h.queued.size, 0);
  h.loop.setBlocked('panel-hidden', false);
  assert.deepEqual([...h.queued.keys()], [0]);
});

test('late cancelled callbacks cannot draw, drop a resumed request, or duplicate the loop', () => {
  const h = harness();
  h.loop.resume();
  h.loop.pause();
  h.fire(0, 16);
  assert.equal(h.frames.length, 0);
  assert.equal(h.queued.size, 0);
  h.loop.resume();
  h.fire(0, 32);
  assert.deepEqual([...h.queued.keys()], [1]);
  assert.equal(h.frames.length, 0);
  h.fire(1, 48);
  h.fire(1, 64); // Even a repeated old delivery cannot steal the next request.
  assert.deepEqual(h.frames, [48]);
  assert.deepEqual([...h.queued.keys()], [2]);
});

test('hide/show during a frame coalesces to exactly one next frame', () => {
  const h = harness(() => {
    h.loop.pause();
    h.loop.resume(); h.loop.resume(); h.loop.wake();
  });
  h.loop.resume();
  h.fire(0);
  assert.deepEqual([...h.queued.keys()], [1]);
  h.fire(1, 32);
  assert.deepEqual(h.frames, [16, 32]);
  assert.deepEqual([...h.queued.keys()], [2]);
});

test('a hide received inside a frame stops scheduling immediately', () => {
  const h = harness(() => h.loop.setBlocked('panel-hidden', true));
  h.loop.resume();
  h.fire(0);
  assert.equal(h.frames.length, 1);
  assert.equal(h.queued.size, 0);
});

test('destroy cancels once, rejects every restart, and ignores late delivery', () => {
  const h = harness();
  h.loop.resume();
  h.loop.destroy(); h.loop.destroy();
  h.loop.resume(); h.loop.wake(); h.loop.setBlocked('panel-hidden', false);
  h.fire(0);
  assert.deepEqual(h.cancelled, [0]);
  assert.equal(h.frames.length, 0);
  assert.equal(h.queued.size, 0);
});

test('destroy during drawing or before loading ends never queues another callback', () => {
  const drawing = harness(() => drawing.loop.destroy());
  drawing.loop.resume(); drawing.fire(0);
  assert.equal(drawing.queued.size, 0);
  const loading = harness();
  loading.loop.setBlocked('model-loading', true); loading.loop.resume();
  loading.loop.destroy(); loading.loop.setBlocked('model-loading', false);
  assert.equal(loading.queued.size, 0);
});

test('idle uses one delay and events wake it immediately without duplicate frames', t => {
  const timers = fakeTimers(t);
  const h = harness(() => 100);
  h.loop.resume(); h.loop.resume();
  h.fire(0);
  assert.equal(h.queued.size, 0);
  assert.equal(timers.queued.size, 1);
  assert.deepEqual(timers.delays, [84]);
  h.loop.wake(); h.loop.wake(); h.loop.resume();
  assert.equal(timers.queued.size, 0);
  assert.deepEqual([...h.queued.keys()], [1]);
  h.fire(1, 32);
  const timer = [...timers.queued.keys()][0];
  timers.fire(timer);
  assert.equal(timers.queued.size, 0);
  assert.deepEqual([...h.queued.keys()], [2]);
  h.loop.destroy();
});

test('late cleared idle timer cannot clear or duplicate a newer idle timer', t => {
  const timers = fakeTimers(t);
  const h = harness(() => 100);
  h.loop.resume(); h.fire(0);
  const stale = [...timers.queued.keys()][0];
  h.loop.wake(); h.fire(1, 32);
  const current = [...timers.queued.keys()][0];
  timers.fire(stale);
  assert.equal(h.queued.size, 0);
  assert.deepEqual([...timers.queued.keys()], [current]);
  h.loop.wake();
  assert.equal(timers.queued.size, 0);
  assert.deepEqual([...h.queued.keys()], [2]);
  h.loop.destroy();
});

test('hide and destroy cancel idle delays and reject late timer delivery', t => {
  const timers = fakeTimers(t);
  const h = harness(() => 500);
  h.loop.resume(); h.fire(0);
  const hiddenTimer = [...timers.queued.keys()][0];
  h.loop.setBlocked('document-hidden', true);
  timers.fire(hiddenTimer);
  assert.equal(h.queued.size, 0);
  assert.equal(timers.queued.size, 0);
  h.loop.setBlocked('document-hidden', false); h.fire(1, 32);
  const destroyedTimer = [...timers.queued.keys()][0];
  h.loop.destroy(); h.loop.resume(); h.loop.wake();
  timers.fire(destroyedTimer);
  assert.equal(h.queued.size, 0);
  assert.equal(timers.queued.size, 0);
  assert.deepEqual(h.frames, [16, 32]);
});
