import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_STALE_MS,
  DEFAULT_SETTINGS,
  HIDE_BOWL_MS,
  MEAL_DURATION_MS,
  MEAL_JITTER_MS,
  MOODS,
  createPetState,
  getPetView,
  isWithinSleepSchedule,
  parseSettings,
  reducePetState,
  sanitizeSettings,
  serializeSettings,
} from '../src/shared/domain.js';
import type { PetContext, PetSettings, PetState } from '../src/shared/domain.js';

const dateAt = (hour = 12, minute = 0): Date => new Date(2026, 9, 3, hour, minute);
const settings = (changes: Partial<PetSettings> = {}): PetSettings => sanitizeSettings({ ...DEFAULT_SETTINGS, ...changes });
const context = (now: number, date = dateAt(), rng: () => number = () => 0): PetContext => ({ now, date, rng });
const tick = (state: PetState, now: number, config = settings(), date = dateAt(), rng: () => number = () => 0): PetState =>
  reducePetState(state, { type: 'tick' }, config, context(now, date, rng));

test('defaults are private-by-default and include all five moods', () => {
  assert.equal(DEFAULT_SETTINGS.audioEnabled, false);
  assert.equal(DEFAULT_SETTINGS.sleepEnabled, false);
  assert.deepEqual(MOODS, ['happy', 'shy', 'aggrieved', 'sleepy', 'unimpressed']);
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
});

test('malformed, stale, and non-object persistence repairs to safe defaults', () => {
  for (const value of ['{broken', 'null', '[]', 'true', '42', null, undefined]) {
    assert.deepEqual(parseSettings(value), DEFAULT_SETTINGS);
  }
  const repaired = sanitizeSettings({
    mood: 'unknown', idleDelaySeconds: '12', mealCooldownSeconds: Infinity,
    audioEnabled: 'yes', sleepEnabled: 1, sleepStart: '7:00', sleepEnd: '24:00',
    reducedMotion: null, scale: NaN, opacity: false, extraUnknownField: 'discard',
  });
  assert.deepEqual(repaired, DEFAULT_SETTINGS);
  assert.equal('extraUnknownField' in repaired, false);
});

test('settings bounds clamp valid finite numbers and round whole-second durations', () => {
  const repaired = sanitizeSettings({
    idleDelaySeconds: -100, mealCooldownSeconds: 99_999, scale: 99, opacity: -1,
    mood: 'aggrieved', audioEnabled: true, sleepEnabled: true,
  });
  assert.equal(repaired.idleDelaySeconds, 5);
  assert.equal(repaired.mealCooldownSeconds, 3_600);
  assert.equal(repaired.scale, 2);
  assert.equal(repaired.opacity, 0.35);
  assert.equal(repaired.mood, 'aggrieved');
  assert.equal(repaired.audioEnabled, true);
  assert.equal(sanitizeSettings({ idleDelaySeconds: 20.7 }).idleDelaySeconds, 21);
  assert.deepEqual(parseSettings(serializeSettings(repaired)), repaired);
});

test('overnight sleep uses local wall clock and exact boundary semantics', () => {
  const config = settings({ sleepEnabled: true, sleepStart: '23:00', sleepEnd: '07:00' });
  assert.equal(isWithinSleepSchedule(config, dateAt(22, 59)), false);
  assert.equal(isWithinSleepSchedule(config, dateAt(23, 0)), true);
  assert.equal(isWithinSleepSchedule(config, dateAt(0, 0)), true);
  assert.equal(isWithinSleepSchedule(config, dateAt(6, 59)), true);
  assert.equal(isWithinSleepSchedule(config, dateAt(7, 0)), false);
  assert.equal(isWithinSleepSchedule(config, dateAt(12, 0)), false);
});

test('daytime, disabled, equal-time, and invalid-date sleep windows are safe', () => {
  const config = settings({ sleepEnabled: true, sleepStart: '13:00', sleepEnd: '14:00' });
  assert.equal(isWithinSleepSchedule(config, dateAt(12, 59)), false);
  assert.equal(isWithinSleepSchedule(config, dateAt(13, 0)), true);
  assert.equal(isWithinSleepSchedule(config, dateAt(14, 0)), false);
  assert.equal(isWithinSleepSchedule({ ...config, sleepEnabled: false }, dateAt(13, 30)), false);
  assert.equal(isWithinSleepSchedule({ ...config, sleepEnd: '13:00' }, dateAt(13, 30)), false);
  assert.equal(isWithinSleepSchedule(config, new Date(NaN)), false);
});

test('meal waits for the idle threshold plus one bounded random delay', () => {
  const config = settings({ idleDelaySeconds: 5 });
  let state = tick(createPetState(0), 0, config, dateAt(), () => 0.5);
  const due = 5_000 + MEAL_JITTER_MS / 2;
  assert.equal(state.nextMealAt, due);
  state = tick(state, due - 1, config);
  assert.equal(getPetView(state, config, context(due - 1)).eating, false);
  state = tick(state, due, config);
  assert.equal(state.mealStartedAt, due);
  assert.equal(state.mealEndsAt, due + MEAL_DURATION_MS);
  assert.equal(getPetView(state, config, context(due)).eating, true);
});

test('50ms and 200ms controllers sample the same single meal appointment', () => {
  const config = settings({ idleDelaySeconds: 30 });
  const run = (interval: number) => {
    let count = 0;
    const rng = () => { count += 1; return 0.5; };
    let state = createPetState(0);
    for (let now = 0; now <= 40_000; now += interval) state = tick(state, now, config, dateAt(), rng);
    return { state, count };
  };
  const fast = run(50);
  const slow = run(200);
  assert.equal(fast.count, 1);
  assert.equal(slow.count, 1);
  assert.equal(fast.state.mealStartedAt, 40_000);
  assert.equal(slow.state.mealStartedAt, 40_000);
  assert.equal(fast.state.mealEndsAt, slow.state.mealEndsAt);
});

test('completed meals are finite and enforce cooldown before another meal', () => {
  const config = settings({ idleDelaySeconds: 5, mealCooldownSeconds: 15 });
  let state = tick(createPetState(0), 5_000, config);
  const end = 5_000 + MEAL_DURATION_MS;
  assert.equal(getPetView(state, config, context(end - 1)).eating, true);
  assert.equal(getPetView(state, config, context(end)).eating, false);
  state = tick(state, end, config);
  assert.equal(state.mealEndsAt, null);
  assert.equal(state.nextMealAt, end + 15_000);
  state = tick(state, end + 14_999, config);
  assert.equal(state.mealEndsAt, null);
  state = tick(state, end + 15_000, config);
  assert.equal(state.mealStartedAt, end + 15_000);
});

test('each kind of resumed input hides the bowl and acts innocent for exactly 900ms', () => {
  const config = settings({ idleDelaySeconds: 5, mealCooldownSeconds: 15 });
  for (const kind of ['typing', 'pointer', 'click'] as const) {
    let state = tick(createPetState(0), 5_000, config);
    state = reducePetState(state, { type: 'activity', kind }, config, context(5_100));
    assert.equal(state.mealEndsAt, null);
    assert.equal(state.cooldownUntil, 20_100);
    const hiding = getPetView(state, config, context(5_100));
    assert.equal(hiding.eating, false);
    assert.equal(hiding.hidingBowl, true);
    assert.equal(hiding.innocent, true);
    assert.equal(hiding.typing || hiding.waving || hiding.bouncing, false);
    assert.equal(getPetView(state, config, context(5_100 + HIDE_BOWL_MS - 1)).innocent, true);
    assert.equal(getPetView(state, config, context(5_100 + HIDE_BOWL_MS)).innocent, false);
    state = tick(state, 6_000, config);
    assert.equal(getPetView(state, config, context(6_000)).mood, config.mood);
  }
});

test('repeated input during concealment does not permanently prolong innocence', () => {
  const config = settings({ idleDelaySeconds: 5 });
  let state = tick(createPetState(0), 5_000, config);
  state = reducePetState(state, { type: 'activity', kind: 'typing' }, config, context(5_100));
  state = reducePetState(state, { type: 'activity', kind: 'typing' }, config, context(5_500));
  assert.equal(state.hideUntil, 6_000);
  assert.equal(getPetView(state, config, context(6_000)).innocent, false);
});

test('activity at the exact meal deadline prevents a meal rather than flashing food', () => {
  const config = settings({ idleDelaySeconds: 5 });
  let state = tick(createPetState(0), 0, config);
  state = reducePetState(state, { type: 'activity', kind: 'pointer' }, config, context(5_000));
  assert.equal(state.mealEndsAt, null);
  assert.equal(state.nextMealAt, 10_000);
  assert.equal(getPetView(state, config, context(5_000)).innocent, false);
});

test('typing, pointer waves, and click bounces expire without further events', () => {
  const config = settings();
  const cases = [['typing', 'typing'], ['pointer', 'waving'], ['click', 'bouncing']] as const;
  for (const [kind, property] of cases) {
    const state = reducePetState(createPetState(0), { type: 'activity', kind }, config, context(100));
    assert.equal(getPetView(state, config, context(100))[property], true);
    assert.equal(getPetView(state, config, context(1_000))[property], false);
    assert.equal(state.lastActivityAt, 100);
  }
});

test('gaze is normalized, rejects non-finite values, and does not retain raw coordinates', () => {
  const config = settings();
  let state = reducePetState(createPetState(0), { type: 'gaze', x: 42, y: -18 }, config, context(10));
  assert.deepEqual(getPetView(state, config, context(10)).gaze, { x: 1, y: -1 });
  state = reducePetState(state, { type: 'gaze', x: Infinity, y: NaN }, config, context(20));
  assert.deepEqual(state.gaze, { x: 0, y: 0 });
  assert.equal(state.lastActivityAt, 0);
});

test('audio is opt-in, amplitude-only, clamped, decaying, and time-limited', () => {
  let config = settings();
  let state = reducePetState(createPetState(0), { type: 'audio', level: 1 }, config, context(100));
  assert.equal(state.audioLevel, 0);
  config = settings({ audioEnabled: true });
  state = reducePetState(state, { type: 'audio', level: 9 }, config, context(200));
  assert.equal(getPetView(state, config, context(200)).audioLevel, 1);
  const decayed = getPetView(state, config, context(300)).audioLevel;
  assert.ok(decayed > 0 && decayed < 1);
  assert.equal(getPetView(state, config, context(200 + AUDIO_STALE_MS)).audioLevel, 0);
  state = tick(state, 200 + AUDIO_STALE_MS, config);
  assert.equal(state.audioLevel, 0);
  assert.equal(state.audioAt, null);
  state = reducePetState(state, { type: 'audio', level: NaN }, config, context(800));
  assert.equal(state.audioLevel, 0);
});

test('disabling audio immediately suppresses a previous sample', () => {
  const config = settings({ audioEnabled: true });
  const state = reducePetState(createPetState(0), { type: 'audio', level: 1 }, config, context(100));
  const disabled = { ...config, audioEnabled: false };
  assert.equal(getPetView(state, disabled, context(100)).audioLevel, 0);
  assert.equal(tick(state, 100, disabled).audioLevel, 0);
});

test('schedule sleep overrides a meal, reactions, gaze, and audio without sampling RNG', () => {
  const config = settings({ idleDelaySeconds: 5, audioEnabled: true, sleepEnabled: true });
  let state = tick(createPetState(0), 5_000, config);
  state = reducePetState(state, { type: 'audio', level: 1 }, config, context(5_050));
  const noRandom = () => { throw new Error('Sleeping must not sample randomness'); };
  state = tick(state, 5_100, config, dateAt(23), noRandom);
  assert.equal(state.mealEndsAt, null);
  assert.equal(state.nextMealAt, null);
  for (const event of [
    { type: 'activity', kind: 'click' } as const,
    { type: 'activity', kind: 'typing' } as const,
    { type: 'gaze', x: 1, y: -1 } as const,
    { type: 'audio', level: 1 } as const,
  ]) state = reducePetState(state, event, config, context(5_200, dateAt(23), noRandom));
  const view = getPetView(state, config, context(5_200, dateAt(23)));
  assert.equal(view.sleeping, true);
  assert.equal(view.mood, 'sleepy');
  assert.equal(view.audioLevel, 0);
  assert.equal(view.eating || view.typing || view.waving || view.bouncing || view.innocent, false);
  assert.deepEqual(view.gaze, { x: 0, y: 0 });
});

test('turning sleep off immediately wakes and starts a fresh idle delay', () => {
  const asleep = settings({ idleDelaySeconds: 5, sleepEnabled: true });
  let state = tick(createPetState(0), 0, asleep, dateAt(23));
  const awake = { ...asleep, sleepEnabled: false };
  assert.equal(getPetView(state, awake, context(1_000, dateAt(23))).sleeping, false);
  state = tick(state, 1_000, awake, dateAt(23));
  assert.equal(state.sleeping, false);
  assert.equal(state.nextMealAt, 6_000);
  assert.equal(state.lastActivityAt, 1_000);
  state = reducePetState(state, { type: 'activity', kind: 'click' }, awake, context(1_100, dateAt(23)));
  assert.equal(getPetView(state, awake, context(1_100, dateAt(23))).bouncing, true);
});

test('normal schedule end wakes without making an immediate overnight meal', () => {
  const config = settings({ idleDelaySeconds: 5, sleepEnabled: true });
  let state = tick(createPetState(0), 0, config, dateAt(6, 59));
  state = tick(state, 60_000, config, dateAt(7, 0));
  assert.equal(state.sleeping, false);
  assert.equal(state.mealStartedAt, null);
  assert.equal(state.nextMealAt, 65_000);
});

test('manual sleepy mood remains awake and permits meals and audio', () => {
  const config = settings({ mood: 'sleepy', idleDelaySeconds: 5, audioEnabled: true });
  let state = tick(createPetState(0), 5_000, config);
  state = reducePetState(state, { type: 'audio', level: 0.7 }, config, context(5_100));
  const view = getPetView(state, config, context(5_100));
  assert.equal(view.mood, 'sleepy');
  assert.equal(view.sleeping, false);
  assert.equal(view.eating, true);
  assert.equal(view.audioLevel, 0.7);
});

test('all moods can be selected; a persisted mood change supersedes a session override', () => {
  const config = settings();
  let state = createPetState(0);
  for (const mood of MOODS) {
    state = reducePetState(state, { type: 'set-mood', mood }, config, context(0));
    assert.equal(getPetView(state, config, context(0)).mood, mood);
  }
  const changed = { ...config, mood: 'shy' as const };
  assert.equal(getPetView(state, changed, context(0)).mood, 'shy');
  state = tick(state, 0, changed);
  assert.equal(state.moodOverride, null);
});

test('changing the idle delay reschedules once with the new delay', () => {
  let config = settings({ idleDelaySeconds: 30 });
  let state = tick(createPetState(0), 0, config);
  assert.equal(state.nextMealAt, 30_000);
  config = { ...config, idleDelaySeconds: 10 };
  state = tick(state, 5_000, config);
  assert.equal(state.nextMealAt, 10_000);
});

test('reducer does not mutate prior state or settings; rendering never calls RNG', () => {
  const config = settings();
  const previous = createPetState(0);
  const before = structuredClone(previous);
  const settingsBefore = structuredClone(config);
  const next = reducePetState(previous, { type: 'gaze', x: 1, y: -1 }, config, context(100));
  getPetView(next, config, context(100, dateAt(), () => { throw new Error('Unexpected RNG'); }));
  assert.deepEqual(previous, before);
  assert.deepEqual(config, settingsBefore);
  assert.notEqual(previous, next);
  assert.notEqual(previous.gaze, next.gaze);
});

test('bad RNG/time values remain finite and backward time cannot extend events', () => {
  const config = settings({ idleDelaySeconds: 5 });
  for (const random of [NaN, Infinity, -3, 8]) {
    const state = tick(createPetState(0), 0, config, dateAt(), () => random);
    assert.ok(state.nextMealAt !== null && Number.isFinite(state.nextMealAt));
    assert.ok(state.nextMealAt >= 5_000 && state.nextMealAt <= 5_000 + MEAL_JITTER_MS);
  }
  let state = tick(createPetState(NaN), 100, config);
  state = reducePetState(state, { type: 'activity', kind: 'typing' }, config, context(-9_000));
  assert.equal(state.lastUpdatedAt, 100);
  assert.equal(state.lastActivityAt, 100);
  state = tick(state, NaN, config);
  assert.equal(state.lastUpdatedAt, 100);
});

test('meal progress is bounded and reduced-motion preference reaches rendering', () => {
  const config = settings({ idleDelaySeconds: 5, reducedMotion: true });
  const state = tick(createPetState(0), 5_000, config);
  assert.equal(getPetView(state, config, context(5_000)).mealProgress, 0);
  assert.equal(getPetView(state, config, context(5_000 + MEAL_DURATION_MS / 2)).mealProgress, 0.5);
  assert.equal(getPetView(state, config, context(5_000 + MEAL_DURATION_MS)).mealProgress, 0);
  assert.equal(getPetView(state, config, context(5_000)).reducedMotion, true);
});
