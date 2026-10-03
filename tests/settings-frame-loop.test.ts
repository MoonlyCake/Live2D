import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { AnimationFrameLoop } from '../src/shared/animation-frame-loop';
import { sanitizeSettings, isWithinSleepSchedule, createPetState, reducePetState, getPetView } from '../src/shared/domain';
import { MealPreview } from '../src/shared/preview-meal';
import { PetDrag } from '../src/shared/drag';
import { physicalDemo } from '../src/shared/physical-demo';
import type { PhysicalInputSnapshot } from '../src/shared/physical-input';

// Execute the real renderer entry points with deterministic DOM/IPC/RAF boundaries.
// Only imported services are replaced; the startup, visibility and draw wiring run.
const scripts = Object.fromEntries(['settings', 'pet'].map(entry => {
  const source = readFileSync(new URL(`../src/renderer/${entry}.ts`, import.meta.url), 'utf8');
  return [entry, transformSync(`(async () => {${source.replace(/^import .*;\r?\n/gm, '')}})()`, {
    loader: 'ts', target: 'es2022',
  }).code];
}));
const cleared: PhysicalInputSnapshot = {
  pressed: [], mouse: { x: 0, y: 0, buttons: { left: false, right: false, middle: false }, wheel: { x: 0, y: 0 } },
  targets: { left: null, right: null },
};
const held: PhysicalInputSnapshot = {
  pressed: ['KeyA'], mouse: { ...cleared.mouse, buttons: { ...cleared.mouse.buttons, left: true } },
  targets: { left: 'KeyA', right: 'mouse' },
};
const released: PhysicalInputSnapshot = { ...held, pressed: [], targets: { left: null, right: 'mouse' } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function panelHarness(entry: 'settings' | 'pet' = 'settings') {
  const bootstrap = deferred<any>();
  const model = deferred<void>();
  const loadStarted = deferred<void>();
  const ipc = new Map<string, (value: any) => void>();
  const documentEvents = new Map<string, () => void>();
  const windowEvents = new Map<string, (() => void)[]>();
  const frames = new Map<number, (timestamp: number) => void>();
  const pastFrames = new Map<number, (timestamp: number) => void>();
  const updates: any[] = [];
  let time = 0;
  let nextFrame = 0;
  let destroyed = false;
  const elements = new Map<string, any>();
  const document = {
    hidden: false,
    body: { dataset: {} as Record<string, string> },
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, {
        style: {}, classList: { toggle() {} }, addEventListener() {},
        setAttribute() {}, replaceChildren() {}, clientWidth: 300, clientHeight: 300,
        querySelector: () => ({ textContent: '' }),
      });
      return elements.get(id);
    },
    querySelector: (selector: string) => document.getElementById(selector.slice(1)),
    querySelectorAll: () => [],
    addEventListener: (name: string, callback: () => void) => documentEvents.set(name, callback),
    removeEventListener: (name: string) => documentEvents.delete(name),
  };
  class FakeCharacter {
    backend = 'test'; renderMilliseconds = 0; lastParameters = {}; capabilities = {};
    load() { loadStarted.resolve(); return model.promise; }
    resize() {}
    update(value: any) { assert.equal(destroyed, false); updates.push(value); }
    destroy() { destroyed = true; }
  }
  class FakeInochi extends FakeCharacter { constructor(_options: unknown) { super(); } }
  const window = {
    whale: {
      bootstrap: () => bootstrap.promise,
      on(name: string, callback: (value: any) => void) {
        ipc.set(name, callback);
        return () => ipc.delete(name);
      },
    },
    addEventListener(name: string, callback: () => void) {
      windowEvents.set(name, [...windowEvents.get(name) ?? [], callback]);
    },
  };
  const frameOptions = {
    requestFrame(callback: (timestamp: number) => void) {
      const handle = nextFrame++;
      frames.set(handle, callback); pastFrames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number) => frames.delete(handle),
  };
  const ready = runInNewContext(scripts[entry], {
    window, document,
    performance: { now: () => time },
    setInterval() { return 1; }, setTimeout() { return 1; }, clearTimeout() {},
    ResizeObserver: class { observe() {} },
    Character2D: FakeCharacter, InochiRenderer: FakeInochi, Live2DRenderer: class extends FakeCharacter {},
    AudioController: class { async destroy() {} },
    AnimationFrameLoop: class extends AnimationFrameLoop {
      constructor(options: ConstructorParameters<typeof AnimationFrameLoop>[0]) {
        super({ ...options, ...frameOptions });
      }
    },
    MealPreview, isWithinSleepSchedule, createPetState, reducePetState, getPetView, PetDrag,
    physicalDemo, keyboardLayout: { keys: [] },
  }) as Promise<void>;
  return {
    frames, updates, ready, document, window,
    emitPanel: (visible: boolean) => ipc.get('panel-visibility')?.(visible),
    emitPhysical: (snapshot: PhysicalInputSnapshot) => ipc.get('physical-input')?.(snapshot),
    preview: () => ipc.get('physical-preview')?.(undefined),
    hideDocument(hidden: boolean) { document.hidden = hidden; documentEvents.get('visibilitychange')?.(); },
    async finishBootstrap(panelVisible: boolean, physical = cleared) {
      bootstrap.resolve({
        panelVisible, settings: sanitizeSettings({ sleepEnabled: false }),
        model: { rendererType: 'inochi-0.8-subset' }, ciSmoke: true,
        inputStatus: { message: '', keyboard: true }, physical, platform: 'linux',
        edition: 'inochi', version: 'test',
      });
      await loadStarted.promise;
    },
    async finishModel() { model.resolve(); await ready; },
    fire(handle: number, timestamp: number) {
      time = timestamp; frames.delete(handle); pastFrames.get(handle)!(timestamp);
    },
    unload() { for (const callback of windowEvents.get('beforeunload') ?? []) callback(); },
  };
}

test('real panel honors hidden bootstrap, independent document visibility, and repeated restores', async () => {
  const h = panelHarness();
  await h.finishBootstrap(false);
  await h.finishModel();
  assert.equal(h.document.body.dataset.ready, 'true');
  assert.equal(h.frames.size, 0);
  h.emitPanel(true); h.emitPanel(true);
  assert.equal(h.frames.size, 1);
  h.fire(0, 32);
  assert.equal(h.updates.length, 1);
  assert.ok((h.window as any).__inochiQA, 'existing CI draw hook remains populated');
  h.hideDocument(true);
  h.emitPanel(false); h.emitPanel(true);
  assert.equal(h.frames.size, 0);
  h.hideDocument(false); h.hideDocument(false);
  assert.equal(h.frames.size, 1);
  h.unload();
  h.fire(2, 64);
  assert.equal(h.frames.size, 0);
  assert.equal(h.updates.length, 1);
});

test('real panel retains hide or show while bootstrap is in flight instead of applying stale snapshots', async () => {
  const hiding = panelHarness();
  hiding.emitPanel(false);
  await hiding.finishBootstrap(true);
  await hiding.finishModel();
  assert.equal(hiding.frames.size, 0);
  hiding.emitPanel(true);
  assert.equal(hiding.frames.size, 1);
  hiding.unload();

  const showing = panelHarness();
  showing.emitPanel(true);
  await showing.finishBootstrap(false);
  await showing.finishModel();
  assert.equal(showing.frames.size, 1);
  showing.unload();
});

test('real panel retains minimize/restore during model loading and stays stopped after unload', async () => {
  const h = panelHarness();
  await h.finishBootstrap(true);
  h.emitPanel(false); h.emitPanel(true); h.emitPanel(false);
  await h.finishModel();
  assert.equal(h.frames.size, 0);
  h.emitPanel(true);
  assert.equal(h.frames.size, 1);
  h.unload(); h.emitPanel(true); h.hideDocument(false);
  h.fire(0, 32);
  assert.equal(h.frames.size, 0);
  assert.equal(h.updates.length, 0);
});

for (const entry of ['settings', 'pet'] as const) {
  for (const phase of ['bootstrap', 'model'] as const) {
    for (const [event, snapshot] of [['keyup', released], ['OFF reset', cleared]] as const) {
      test(`${entry} keeps ${event} received during ${phase} instead of stale held keys`, async () => {
        const h = panelHarness(entry);
        if (phase === 'bootstrap') h.emitPhysical(snapshot);
        await h.finishBootstrap(true, held);
        if (phase === 'model') h.emitPhysical(snapshot);
        await h.finishModel();
        h.fire(0, 32); h.fire(1, 64);
        assert.equal(h.updates.length, 2);
        for (const update of h.updates) assert.equal(update.physical, snapshot);
        if (entry === 'settings') {
          assert.equal(h.document.getElementById('physical-keys').textContent, '当前没有按住的物理键');
        }
        h.unload();
      });
    }
  }

  test(`${entry} preserves the bootstrap fallback, explicit preview and CI physical setter`, async () => {
    const h = panelHarness(entry);
    await h.finishBootstrap(true, held);
    await h.finishModel();
    h.fire(0, 32);
    assert.equal(h.updates.at(-1).physical, held);
    h.preview(); h.fire(1, 64);
    assert.deepEqual(h.updates.at(-1).physical.pressed, ['KeyF']);
    (h.window as any).__setPhysicalQA(cleared); h.fire(2, 96);
    assert.equal(h.updates.at(-1).physical, cleared);
    h.preview(); h.emitPhysical(released); h.fire(3, 128);
    assert.equal(h.updates.at(-1).physical, released, 'live input cancels a synthetic preview');
    h.unload();
  });
}
