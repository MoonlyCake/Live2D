/**
 * Platform-independent whale behavior. All time and randomness are supplied by
 * the caller; no Electron, timers, device access, or captured input is used here.
 */
export const MOODS = ['happy', 'shy', 'aggrieved', 'sleepy', 'unimpressed'] as const;
export type Mood = (typeof MOODS)[number];

export interface PetSettings {
  mood: Mood;
  randomMood: boolean;
  positionLocked: boolean;
  idleDelaySeconds: number;
  mealCooldownSeconds: number;
  sleepEnabled: boolean;
  /** Local wall-clock time in strict 24-hour HH:mm format. */
  sleepStart: string;
  sleepEnd: string;
  audioEnabled: boolean;
  reducedMotion: boolean;
  scale: number;
  opacity: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
}

export const DEFAULT_SETTINGS: Readonly<PetSettings> = Object.freeze({
  mood: 'happy',
  randomMood: false,
  positionLocked: false,
  idleDelaySeconds: 30,
  mealCooldownSeconds: 120,
  sleepEnabled: false,
  sleepStart: '23:00',
  sleepEnd: '07:00',
  audioEnabled: false,
  reducedMotion: false,
  scale: 1,
  opacity: 1,
  alwaysOnTop: true,
  clickThrough: false,
});

export const MEAL_DURATION_MS = 6_500;
export const MEAL_JITTER_MS = 20_000;
export const HIDE_BOWL_MS = 900;
export const TYPING_REACTION_MS = 450;
export const WAVE_REACTION_MS = 600;
export const BOUNCE_REACTION_MS = 700;
export const AUDIO_STALE_MS = 500;

const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function numberSetting(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  const result = typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  return integer ? Math.round(result) : result;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value);
}

/** Repair untrusted/old persistence; drop unknown keys, clamp finite numbers. */
export function sanitizeSettings(value: unknown): PetSettings {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    mood: isMood(source.mood) ? source.mood : DEFAULT_SETTINGS.mood,
    randomMood: booleanSetting(source.randomMood, false),
    positionLocked: booleanSetting(source.positionLocked, false),
    idleDelaySeconds: numberSetting(source.idleDelaySeconds, DEFAULT_SETTINGS.idleDelaySeconds, 5, 3_600, true),
    mealCooldownSeconds: numberSetting(source.mealCooldownSeconds, DEFAULT_SETTINGS.mealCooldownSeconds, 5, 3_600, true),
    sleepEnabled: booleanSetting(source.sleepEnabled, DEFAULT_SETTINGS.sleepEnabled),
    sleepStart: typeof source.sleepStart === 'string' && clockPattern.test(source.sleepStart) ? source.sleepStart : DEFAULT_SETTINGS.sleepStart,
    sleepEnd: typeof source.sleepEnd === 'string' && clockPattern.test(source.sleepEnd) ? source.sleepEnd : DEFAULT_SETTINGS.sleepEnd,
    audioEnabled: booleanSetting(source.audioEnabled, DEFAULT_SETTINGS.audioEnabled),
    reducedMotion: booleanSetting(source.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
    scale: numberSetting(source.scale, DEFAULT_SETTINGS.scale, 0.5, 2),
    opacity: numberSetting(source.opacity, DEFAULT_SETTINGS.opacity, 0.35, 1),
    alwaysOnTop: booleanSetting(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    clickThrough: booleanSetting(source.clickThrough, DEFAULT_SETTINGS.clickThrough),
  };
}

/** Malformed JSON is safe to replace with these repaired defaults. */
export function parseSettings(serialized: unknown): PetSettings {
  if (typeof serialized !== 'string') return sanitizeSettings(serialized);
  try {
    return sanitizeSettings(JSON.parse(serialized));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function serializeSettings(settings: PetSettings): string {
  return JSON.stringify(sanitizeSettings(settings));
}

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Start inclusive, end exclusive, in the supplied Date's local timezone.
 * Overnight windows are supported. Equal start/end means an empty window,
 * never an accidental all-day lock. Manual `mood: 'sleepy'` does not sleep.
 */
export function isWithinSleepSchedule(settings: PetSettings, date: Date): boolean {
  const safe = sanitizeSettings(settings);
  if (!safe.sleepEnabled || !Number.isFinite(date.getTime())) return false;
  const start = clockMinutes(safe.sleepStart);
  const end = clockMinutes(safe.sleepEnd);
  const minute = date.getHours() * 60 + date.getMinutes();
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** Coarse activity only: never send key codes, typed text, or window titles. */
export type ActivityKind = 'typing' | 'pointer' | 'click';
export type PetEvent =
  | { type: 'tick' }
  | { type: 'activity'; kind: ActivityKind }
  /** Gaze is normalized, not a screen coordinate; combine with activity for motion. */
  | { type: 'gaze'; x: number; y: number }
  /** A transient 0..1 meter sample. No audio buffer is retained. */
  | { type: 'audio'; level: number }
  /** Session override; changing the persisted settings.mood clears this override. */
  | { type: 'set-mood'; mood: Mood };

export interface PetContext {
  /** Milliseconds on the controller's timebase. Prefer a monotonic clock. */
  now: number;
  /** The current local wall clock, independently supplied for sleep scheduling. */
  date: Date;
  /** Used once per meal appointment, not once per frame or tick. */
  rng?: () => number;
}

export interface PetState {
  lastUpdatedAt: number;
  lastActivityAt: number;
  nextMealAt: number | null;
  mealStartedAt: number | null;
  mealEndsAt: number | null;
  cooldownUntil: number;
  hideUntil: number;
  typingUntil: number;
  waveUntil: number;
  bounceUntil: number;
  gaze: { x: number; y: number };
  audioLevel: number;
  audioAt: number | null;
  sleeping: boolean;
  moodOverride: Mood | null;
  observedSettingsMood: Mood | null;
  mealSettingsKey: string | null;
  randomMood: Mood | null;
  nextMoodAt: number | null;
}

export interface PetView {
  mood: Mood;
  sleeping: boolean;
  eating: boolean;
  /** Short concealment animation; bowl should leave the scene during this state. */
  hidingBowl: boolean;
  innocent: boolean;
  typing: boolean;
  waving: boolean;
  bouncing: boolean;
  gaze: { x: number; y: number };
  audioLevel: number;
  /** 0..1 only while eating; useful for a discrete rice/chopstick cycle. */
  mealProgress: number;
  reducedMotion: boolean;
}

/** Initial state contains no randomness and no pending external effects. */
export function createPetState(now = 0): PetState {
  const time = Number.isFinite(now) ? Math.max(0, now) : 0;
  return {
    lastUpdatedAt: time,
    lastActivityAt: time,
    nextMealAt: null,
    mealStartedAt: null,
    mealEndsAt: null,
    cooldownUntil: time,
    hideUntil: 0,
    typingUntil: 0,
    waveUntil: 0,
    bounceUntil: 0,
    gaze: { x: 0, y: 0 },
    audioLevel: 0,
    audioAt: null,
    sleeping: false,
    moodOverride: null,
    observedSettingsMood: null,
    mealSettingsKey: null,
    randomMood: null,
    nextMoodAt: null,
  };
}

function effectiveTime(state: PetState, supplied: number): number {
  return Number.isFinite(supplied) ? Math.max(state.lastUpdatedAt, supplied) : state.lastUpdatedAt;
}

function safeLevel(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

function safeGaze(value: number): number {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

/**
 * Pure reducer: call at 50–200ms and on coarse events. Settings take effect on
 * the very next call, including waking immediately when sleep is disabled.
 * Repeated ticks cannot increase the chance of a meal: each idle stretch has
 * one randomized appointment. Activity cancels it and starts a fresh stretch.
 */
export function reducePetState(previous: PetState, event: PetEvent, settings: PetSettings, context: PetContext): PetState {
  const safe = sanitizeSettings(settings);
  const now = effectiveTime(previous, context.now);
  const state: PetState = { ...previous, gaze: { ...previous.gaze }, lastUpdatedAt: now };
  const sleeping = isWithinSleepSchedule(safe, context.date);
  const mealSettingsKey = `${safe.idleDelaySeconds}:${safe.mealCooldownSeconds}`;

  if (state.observedSettingsMood !== safe.mood) {
    state.observedSettingsMood = safe.mood;
    state.moodOverride = null;
  }
  if (state.mealSettingsKey !== mealSettingsKey) {
    state.mealSettingsKey = mealSettingsKey;
    state.nextMealAt = null;
  }
  if (!safe.randomMood) { state.randomMood = null; state.nextMoodAt = null; }
  if (event.type === 'set-mood' && isMood(event.mood)) state.moodOverride = event.mood;

  if (sleeping) {
    if (!state.sleeping) {
      if (state.mealEndsAt !== null) state.cooldownUntil = now + safe.mealCooldownSeconds * 1_000;
      state.lastActivityAt = now;
    }
    state.sleeping = true;
    state.nextMealAt = null;
    state.mealStartedAt = null;
    state.mealEndsAt = null;
    state.hideUntil = 0;
    state.typingUntil = 0;
    state.waveUntil = 0;
    state.bounceUntil = 0;
    state.gaze = { x: 0, y: 0 };
    state.audioLevel = 0;
    state.audioAt = null;
    return state;
  }

  if (state.sleeping) {
    state.sleeping = false;
    state.lastActivityAt = now;
    state.nextMealAt = null;
  }
  if (!safe.audioEnabled || (state.audioAt !== null && now - state.audioAt >= AUDIO_STALE_MS)) {
    state.audioLevel = 0;
    state.audioAt = null;
  }
  if (state.mealEndsAt !== null && now >= state.mealEndsAt) {
    state.cooldownUntil = state.mealEndsAt + safe.mealCooldownSeconds * 1_000;
    state.mealStartedAt = null;
    state.mealEndsAt = null;
    state.nextMealAt = null;
  }

  if (event.type === 'activity') {
    if (state.mealEndsAt !== null) {
      state.mealStartedAt = null;
      state.mealEndsAt = null;
      state.hideUntil = now + HIDE_BOWL_MS;
      state.cooldownUntil = now + safe.mealCooldownSeconds * 1_000;
    }
    state.lastActivityAt = now;
    state.nextMealAt = null;
    if (event.kind === 'typing') state.typingUntil = now + TYPING_REACTION_MS;
    if (event.kind === 'pointer') state.waveUntil = now + WAVE_REACTION_MS;
    if (event.kind === 'click') state.bounceUntil = now + BOUNCE_REACTION_MS;
  } else if (event.type === 'gaze') {
    state.gaze = { x: safeGaze(event.x), y: safeGaze(event.y) };
  } else if (event.type === 'audio' && safe.audioEnabled) {
    state.audioLevel = safeLevel(event.level);
    state.audioAt = now;
  }

  if (state.mealEndsAt === null && state.nextMealAt === null) {
    const random = safeLevel(context.rng ? context.rng() : 0.5);
    state.nextMealAt = Math.max(
      state.lastActivityAt + safe.idleDelaySeconds * 1_000,
      state.cooldownUntil,
      state.hideUntil,
    ) + Math.round(random * MEAL_JITTER_MS);
  }
  if (state.mealEndsAt === null && state.nextMealAt !== null && now >= state.nextMealAt) {
    state.mealStartedAt = now;
    state.mealEndsAt = now + MEAL_DURATION_MS;
    state.nextMealAt = null;
  }
  // One stable appointment, never per-frame random sampling. Defer mood
  // changes while eating or reacting; scheduled sleep returned above.
  if (safe.randomMood && event.type === 'tick' && state.mealEndsAt === null &&
      now >= Math.max(state.hideUntil, state.typingUntil, state.waveUntil, state.bounceUntil)) {
    if (state.randomMood === null) {
      state.randomMood = safe.mood;
      state.nextMoodAt = now + 30_000 + Math.round(safeLevel(context.rng?.() ?? .5) * 30_000);
    } else if (state.nextMoodAt !== null && now >= state.nextMoodAt) {
      const choices = MOODS.filter(mood => mood !== state.randomMood);
      state.randomMood = choices[Math.min(choices.length - 1, Math.floor(safeLevel(context.rng?.() ?? .5) * choices.length))];
      state.nextMoodAt = now + 30_000 + Math.round(safeLevel(context.rng?.() ?? .5) * 30_000);
    }
  }
  return state;
}

/** Derived rendering data. Querying does not sample RNG or mutate state. */
export function getPetView(state: PetState, settings: PetSettings, context: Pick<PetContext, 'now' | 'date'>): PetView {
  const safe = sanitizeSettings(settings);
  const now = effectiveTime(state, context.now);
  // Read the current setting directly so toggling sleep/audio is visible even
  // before the next scheduled tick. The reducer should still run after edits.
  const sleeping = isWithinSleepSchedule(safe, context.date);
  const hidingBowl = !sleeping && now < state.hideUntil;
  const eating = !sleeping && state.mealStartedAt !== null && state.mealEndsAt !== null && now < state.mealEndsAt;
  const audioAge = state.audioAt === null ? AUDIO_STALE_MS : Math.max(0, now - state.audioAt);
  const audioLevel = !sleeping && safe.audioEnabled && audioAge < AUDIO_STALE_MS
    ? state.audioLevel * Math.exp(-audioAge / 180)
    : 0;
  const selectedMood = state.observedSettingsMood === safe.mood && state.moodOverride !== null ? state.moodOverride : safe.randomMood ? state.randomMood ?? safe.mood : safe.mood;
  return {
    mood: sleeping ? 'sleepy' : selectedMood,
    sleeping,
    eating,
    hidingBowl,
    innocent: hidingBowl,
    typing: !sleeping && !hidingBowl && now < state.typingUntil,
    waving: !sleeping && !hidingBowl && now < state.waveUntil,
    bouncing: !sleeping && !hidingBowl && now < state.bounceUntil,
    gaze: sleeping ? { x: 0, y: 0 } : { ...state.gaze },
    audioLevel,
    mealProgress: eating && state.mealStartedAt !== null ? clamp((now - state.mealStartedAt) / MEAL_DURATION_MS, 0, 1) : 0,
    reducedMotion: safe.reducedMotion,
  };
}
