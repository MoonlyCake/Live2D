import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync, existsSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanSettings, loadSettings, saveSettings } from '../src/main/config.js';
import { inside, safeLocalPath, validateModel, clampWindow } from '../src/main/security.js';
import { DEFAULT_SETTINGS } from '../src/shared/domain.js';

function fixture(t: { after(fn: () => void): void }) {
  // macOS temporary roots can be /var aliases for /private/var.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'whale-security-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'model');
  mkdirSync(root);
  const write = (name: string, data: string | Buffer) => {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    return file;
  };
  write('whale.moc3', 'MOC3test-fixture-header-only');
  write('textures/whale.png', 'fixture-image');
  const descriptor = (references: Record<string, unknown> = {}) => write('whale.model3.json', JSON.stringify({
    Version: 3,
    FileReferences: { Moc: 'whale.moc3', Textures: ['textures/whale.png'], ...references },
  }));
  return { directory, root, write, descriptor };
}

test('app settings repair malformed values and discard unrecognized properties', () => {
  for (const input of [null, undefined, false, 'invalid', 42, []]) {
    const result = cleanSettings(input);
    assert.equal(result.audioEnabled, false);
    assert.equal(result.globalInputEnabled, true);
    assert.equal(result.clickThrough, false);
    assert.equal(result.mood, DEFAULT_SETTINGS.mood);
  }
  const result = cleanSettings({ globalInputEnabled: 'true', audioSource: 'other', audioDeviceId: 2, corePath: false, modelPath: null, x: '25', y: NaN, arbitrary: true });
  assert.equal(result.globalInputEnabled, true);
  assert.equal(result.audioSource, 'microphone');
  assert.equal(result.audioDeviceId, '');
  assert.equal(result.modelPath, '');
  assert.equal(result.corePath, '');
  assert.equal(result.x, undefined);
  assert.equal(result.y, undefined);
  assert.equal('arbitrary' in result, false);
});

test('clean settings bound device identifiers and preserve ordinary rounded negative positions', () => {
  const result = cleanSettings({ audioDeviceId: 'x'.repeat(1_000), x: -1820.7, y: 239.2 });
  assert.equal(result.audioDeviceId.length, 256);
  assert.equal(result.x, -1821);
  assert.equal(result.y, 239);
});

test('persisted huge finite positions cannot reach native window constructors', () => {
  const result = cleanSettings({ x: 1e100, y: -1e100 });
  for (const value of [result.x, result.y]) {
    assert.ok(value === undefined || (Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647));
  }
});

test('loading preserves global-input intent while audio and click-through reset', t => {
  const f = fixture(t);
  const path = join(f.directory, 'settings.json');
  writeFileSync(path, JSON.stringify({ ...DEFAULT_SETTINGS, mood: 'shy', audioEnabled: true, globalInputEnabled: true, clickThrough: true, sleepEnabled: true }));
  const result = loadSettings(path);
  assert.equal(result.audioEnabled, false);
  assert.equal(result.globalInputEnabled, true);
  assert.equal(result.clickThrough, false);
  assert.equal(result.mood, 'shy');
  assert.equal(result.sleepEnabled, true);
});

test('missing and corrupt settings load repaired defaults without throwing', t => {
  const f = fixture(t);
  const path = join(f.directory, 'settings.json');
  assert.equal(loadSettings(path).mood, DEFAULT_SETTINGS.mood);
  for (const text of ['{broken', 'null', '[]', '"text"', '{"audioEnabled":"yes","globalInputEnabled":1}']) {
    writeFileSync(path, text);
    const result = loadSettings(path);
    assert.equal(result.audioEnabled, false);
    assert.equal(result.globalInputEnabled, true);
    assert.equal(result.clickThrough, false);
  }
});

test('settings write atomically to a private file and remain loadable', t => {
  const f = fixture(t);
  const path = join(f.directory, 'nested', 'settings.json');
  const original = cleanSettings({ mood: 'aggrieved', x: -10, y: 20 });
  saveSettings(path, original);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), original);
  assert.equal(loadSettings(path).mood, 'aggrieved');
  assert.equal(existsSync(path + '.tmp'), false);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('inside uses directory boundaries rather than root name prefixes', t => {
  const f = fixture(t);
  assert.equal(inside(f.root, f.root), true);
  assert.equal(inside(f.root, join(f.root, 'textures', 'whale.png')), true);
  assert.equal(inside(f.root, f.root + '-other/secret.txt'), false);
  assert.equal(inside(f.root, join(f.root, '..', 'secret.txt')), false);
});

test('legitimate filenames beginning with two dots remain inside their folder', t => {
  const f = fixture(t);
  const file = f.write('..palette.png', 'fixture');
  assert.equal(inside(f.root, file), true);
  assert.equal(safeLocalPath(f.root, '..palette.png'), file);
});

test('safe local paths allow nested regular files and protocol-root slash paths', t => {
  const f = fixture(t);
  const expected = join(f.root, 'textures', 'whale.png');
  assert.equal(safeLocalPath(f.root, 'textures/whale.png'), expected);
  assert.equal(safeLocalPath(f.root, '/textures/whale.png'), expected);
  assert.equal(safeLocalPath(f.root, 'textures/../whale.moc3'), join(f.root, 'whale.moc3'));
});

test('safe local paths reject traversal, directories, NUL bytes, and missing files', t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, 'secret.txt'), 'private fixture');
  for (const path of ['../secret.txt', '/../../secret.txt', 'textures', '', '.', 'whale.moc3\0ignored', 'missing.png']) {
    assert.equal(safeLocalPath(f.root, path), null, path);
  }
  assert.equal(safeLocalPath(join(f.directory, 'missing-root'), 'file'), null);
});

test('safe local paths reject a file or directory symlink escaping the chosen model folder', t => {
  const f = fixture(t);
  const outside = join(f.directory, 'private');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'private fixture');
  try {
    symlinkSync(join(outside, 'secret.txt'), join(f.root, 'linked.txt'));
    symlinkSync(outside, join(f.root, 'linked-directory'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return t.skip('Windows symlinks need local developer permission');
    throw error;
  }
  assert.equal(safeLocalPath(f.root, 'linked.txt'), null);
  assert.equal(safeLocalPath(f.root, 'linked-directory/secret.txt'), null);
});

test('minimal model metadata checks a Moc header and nested texture reference', t => {
  const f = fixture(t);
  const model = validateModel(f.descriptor());
  assert.equal(model.name, 'whale');
  assert.equal(model.fileName, 'whale.model3.json');
  assert.equal(model.manifest, null);
  // Header validation is deliberately not a claim that this fixture is a
  // compiled/renderable Cubism model; the official runtime checks that later.
});

test('model rejects wrong entry extension, malformed JSON, huge descriptors, and wrong Moc header', t => {
  const f = fixture(t);
  assert.throws(() => validateModel(f.write('whale.json', '{}')));
  assert.throws(() => validateModel(f.write('broken.model3.json', '{broken')));
  assert.throws(() => validateModel(f.write('huge.model3.json', ' '.repeat(1024 * 1024 + 1))));
  f.write('whale.moc3', 'not a MOC3');
  assert.throws(() => validateModel(f.descriptor()));
});

test('model signature validation rejects truncated Moc headers', t => {
  const f = fixture(t);
  const model = f.descriptor();
  for (const signature of ['', 'M', 'MO', 'MOC', 'MOC2', 'moc3']) {
    f.write('whale.moc3', signature);
    assert.throws(() => validateModel(model), JSON.stringify(signature));
  }
});

test('model signature validation handles a large sparse binary without loading its body', t => {
  const f = fixture(t);
  const binary = f.write('whale.moc3', 'MOC3');
  const descriptor = openSync(binary, 'r+');
  try { ftruncateSync(descriptor, 512 * 1024 * 1024); }
  finally { closeSync(descriptor); }
  assert.equal(statSync(binary).size, 512 * 1024 * 1024);
  assert.doesNotThrow(() => validateModel(f.descriptor()));
});

test('model rejects remote, traversal, and missing file references in known fields', t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, 'outside.moc3'), 'MOC3outside');
  for (const references of [
    { Moc: '../outside.moc3' },
    { Moc: 'https://example.invalid/whale.moc3' },
    { Textures: ['https://example.invalid/whale.png'] },
    { Textures: ['missing.png'] },
    { Physics: '../../physics.json' },
    { Expressions: [{ Name: 'test', File: 'missing.exp3.json' }] },
    { Motions: { Idle: [{ File: 'missing.motion3.json' }] } },
  ]) assert.throws(() => validateModel(f.descriptor(references)), JSON.stringify(references));
});

test('model rejects a symlinked reference escaping its folder', t => {
  const f = fixture(t);
  const outside = join(f.directory, 'outside.moc3');
  writeFileSync(outside, 'MOC3outside');
  try { symlinkSync(outside, join(f.root, 'linked.moc3')); }
  catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return t.skip('Windows symlinks need local developer permission');
    throw error;
  }
  assert.throws(() => validateModel(f.descriptor({ Moc: 'linked.moc3' })));
});

test('model cannot validate one root-relative Moc and then read another absolute Moc', t => {
  if (process.platform === 'win32') return t.skip('POSIX absolute path regression; Windows backslash references have separate rejection');
  const f = fixture(t);
  const absolute = join(f.directory, 'outside.moc3');
  writeFileSync(absolute, 'MOC3outside');
  // The former implementation stripped the leading slash during validation,
  // but later used resolve(root, reference), which reads the absolute path.
  f.write(absolute.replace(/^\/+/, ''), 'not a MOC3');
  assert.throws(() => validateModel(f.descriptor({ Moc: absolute })));
});

test('texture references must be a nonempty flat array of path strings', t => {
  const f = fixture(t);
  for (const Textures of [[], [''], [123], [null], [{ File: 'textures/whale.png' }], [['textures/whale.png']]]) {
    assert.throws(() => validateModel(f.descriptor({ Textures })), JSON.stringify(Textures));
  }
});

test('optional single-file model references must be path strings', t => {
  const f = fixture(t);
  for (const Physics of ['', 42, { File: 'textures/whale.png' }, ['textures/whale.png']]) {
    assert.throws(() => validateModel(f.descriptor({ Physics })), JSON.stringify(Physics));
  }
});

test('expressions require a well-formed array of entries with a File path', t => {
  const f = fixture(t);
  f.write('happy.exp3.json', '{}');
  assert.doesNotThrow(() => validateModel(f.descriptor({ Expressions: [{ Name: 'happy', File: 'happy.exp3.json' }] })));
  for (const Expressions of [[{}], ['happy.exp3.json'], [{ Name: 'happy' }], [{ Name: 'happy', File: '' }], [{ File: 42 }]]) {
    assert.throws(() => validateModel(f.descriptor({ Expressions })), JSON.stringify(Expressions));
  }
});

test('motion groups require arrays of entries with a File path and valid optional Sound', t => {
  const f = fixture(t);
  f.write('idle.motion3.json', '{}');
  f.write('sound.wav', 'fixture');
  assert.doesNotThrow(() => validateModel(f.descriptor({ Motions: { Idle: [{ File: 'idle.motion3.json', Sound: 'sound.wav' }] } })));
  for (const Motions of [
    { Idle: 'idle.motion3.json' },
    { Idle: ['idle.motion3.json'] },
    { Idle: [{}] },
    { Idle: [{ File: '' }] },
    { Idle: [{ File: 42 }] },
    { Idle: [{ File: 'idle.motion3.json', Sound: '' }] },
    { Idle: [{ File: 'idle.motion3.json', Sound: 42 }] },
  ]) assert.throws(() => validateModel(f.descriptor({ Motions })), JSON.stringify(Motions));
});

test('manifest loading is optional, bounded, and tolerant of invalid JSON', t => {
  const f = fixture(t);
  const path = f.descriptor();
  f.write('whale.manifest.json', JSON.stringify({ version: 1, name: 'Whale' }));
  assert.deepEqual(validateModel(path).manifest, { version: 1, name: 'Whale' });
  f.write('whale.manifest.json', '{broken');
  assert.equal(validateModel(path).manifest, null);
  f.write('whale.manifest.json', ' '.repeat(100_001));
  assert.equal(validateModel(path).manifest, null);
});

test('window clamp preserves negative-origin monitor coordinates', () => {
  const work = { x: -1920, y: -200, width: 1920, height: 1080 };
  const original = { x: -1600, y: -100, width: 320, height: 420 };
  assert.deepEqual(clampWindow(original, work), original);
  assert.deepEqual(clampWindow({ ...original, x: -9000, y: -9000 }, work), { ...original, x: -1920, y: -200 });
  assert.deepEqual(clampWindow({ ...original, x: 9000, y: 9000 }, work), { ...original, x: -320, y: 460 });
});

test('window clamp rounds fractional placement and leaves inputs unchanged', () => {
  const work = { x: 2560, y: 80, width: 1280, height: 720 };
  const bounds = { x: 2600.7, y: 100.2, width: 320, height: 420 };
  const original = { ...bounds };
  assert.deepEqual(clampWindow(bounds, work), { ...bounds, x: 2601, y: 100 });
  assert.deepEqual(bounds, original);
});
