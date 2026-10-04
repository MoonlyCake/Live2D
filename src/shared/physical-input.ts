/** Current physical input only. Never store typed text, event payloads, or released-key history. */
export type PhysicalHand = 'left' | 'right';
export type PhysicalMouseButton = 'left' | 'right' | 'middle';
type Letter = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'|'U'|'V'|'W'|'X'|'Y'|'Z';
type Digit = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9';
const SPECIAL_KEYS = [
 'Backquote','Minus','Equal','Backspace','Tab','BracketLeft','BracketRight','Backslash',
 'CapsLock','Semicolon','Quote','Comma','Period','Slash','Enter','ShiftLeft','ShiftRight','ControlLeft','AltLeft',
 'MetaLeft','Space','MetaRight','AltRight','ControlRight','Escape','Insert','Home',
 'PageUp','Delete','End','PageDown','ArrowUp','ArrowLeft','ArrowDown','ArrowRight',
] as const;
export type PhysicalKeyId = `Key${Letter}` | `Digit${Digit}` | `F${1|2|3|4|5|6|7|8|9|10|11|12}` | typeof SPECIAL_KEYS[number];
/** JSON asset input; constructor validates and narrows its fixed IDs and hand names. */
export interface PhysicalKeyBinding { readonly id: string; readonly nativeCode: number; readonly hand: string }
export type PhysicalWheelPulse = -1 | 0 | 1;
export interface PhysicalInputSnapshot {
 /** Canonical layout order, never the order in which keys were pressed. */
 pressed: PhysicalKeyId[];
 mouse: {
  x: number; y: number;
  buttons: Record<PhysicalMouseButton, boolean>;
  wheel: { x: PhysicalWheelPulse; y: PhysicalWheelPulse };
 };
 /** keyboard is the latest currently held key across both sides; mouse state never replaces it. */
 targets: { left: PhysicalKeyId | null; right: PhysicalKeyId | 'mouse' | null; keyboard?: PhysicalKeyId | null };
}
export const MAX_PRESSED_KEYS = 32;
export const MOUSE_RECENT_MS = 700;
export const WHEEL_PULSE_MS = 180;

function isKeyId(value: string): value is PhysicalKeyId {
 return /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(value) || (SPECIAL_KEYS as readonly string[]).includes(value);
}
function isButton(value: PhysicalMouseButton): boolean { return value === 'left' || value === 'right' || value === 'middle'; }
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const sign = (value: number): PhysicalWheelPulse => value < 0 ? -1 : value > 0 ? 1 : 0;

/**
 * Feed native key down/up codes and normalized mouse events. The caller owns lifecycle resets.
 * Read snapshot() on render/publish ticks to observe mouse/wheel expiry. There are no timers,
 * persistence, IPC, OS hooks, permission requests, or arbitrary held-key expiry in this class.
 */
export class PhysicalInput {
 private readonly keys: {id: PhysicalKeyId; nativeCode: number; hand: PhysicalHand}[];
 private readonly byCode = new Map<number, {id: PhysicalKeyId; hand: PhysicalHand}>();
 // Insertion order exists only for currently held keys, to choose each hand's latest target.
 private readonly held = new Map<PhysicalKeyId, PhysicalHand>();
 private x = 0; private y = 0; private hasPosition = false; private mouseUntil = 0;
 private buttons: Record<PhysicalMouseButton, boolean> = {left:false, right:false, middle:false};
 private wheelX: PhysicalWheelPulse = 0; private wheelY: PhysicalWheelPulse = 0;
 private wheelUntil = 0;

 constructor(bindings: readonly PhysicalKeyBinding[], private readonly now: () => number = Date.now) {
  if (bindings.length > 83) throw new Error('Physical key allowlist exceeds the supported 83-key layout');
  const ids = new Set<string>();
  this.keys = bindings.map(binding => {
   if (!isKeyId(binding.id) || !Number.isInteger(binding.nativeCode) || binding.nativeCode < 0 || binding.nativeCode > 0xffff ||
       (binding.hand !== 'left' && binding.hand !== 'right') || ids.has(binding.id) || this.byCode.has(binding.nativeCode)) {
    throw new Error('Invalid or duplicate physical key binding');
   }
   const key: {id:PhysicalKeyId; nativeCode:number; hand:PhysicalHand} = {id:binding.id, nativeCode:binding.nativeCode, hand:binding.hand};
   ids.add(key.id); this.byCode.set(key.nativeCode, {id:key.id, hand:key.hand});
   return key;
  });
 }

 keyDown(nativeCode: number): boolean {
  const key = this.byCode.get(nativeCode);
  if (!key || this.held.has(key.id) || this.held.size >= MAX_PRESSED_KEYS) return false;
  this.held.set(key.id, key.hand);if(key.hand==='right')this.mouseUntil=0;return true;
 }
 keyUp(nativeCode: number): boolean {
  const key = this.byCode.get(nativeCode);
  return key ? this.held.delete(key.id) : false;
 }
 move(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const nextX = clamp(x), nextY = clamp(y);
  if (this.hasPosition && nextX === this.x && nextY === this.y) return false;
  this.x = nextX; this.y = nextY; this.hasPosition = true;
  this.mouseUntil = this.now() + MOUSE_RECENT_MS; return true;
 }
 buttonDown(button: PhysicalMouseButton): boolean {
  if (!isButton(button) || this.buttons[button]) return false;
  this.buttons[button] = true; return true;
 }
 buttonUp(button: PhysicalMouseButton): boolean {
  if (!isButton(button) || !this.buttons[button]) return false;
  this.buttons[button] = false; return true;
 }
 wheel(deltaX: number, deltaY: number): boolean {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) return false;
  this.wheelX = sign(deltaX); this.wheelY = sign(deltaY);
  this.wheelUntil = this.now() + WHEEL_PULSE_MS;this.mouseUntil=this.wheelUntil; return true;
 }
 reset(): void {
  this.held.clear(); this.x = 0; this.y = 0; this.hasPosition = false; this.mouseUntil = 0;
  this.buttons = {left:false, right:false, middle:false};
  this.wheelX = 0; this.wheelY = 0; this.wheelUntil = 0;
 }
 snapshot(): PhysicalInputSnapshot {
  const now = this.now();
  if (now >= this.wheelUntil) { this.wheelX = 0; this.wheelY = 0; this.wheelUntil = 0; }
  if (now >= this.mouseUntil) this.mouseUntil = 0;
  let left: PhysicalKeyId | null = null, right: PhysicalKeyId | 'mouse' | null = null, keyboard: PhysicalKeyId | null = null;
  for (const [id, hand] of this.held) { keyboard = id; if (hand === 'left') left = id; else right = id; }
  if (this.buttons.left || this.buttons.right || this.buttons.middle || this.mouseUntil > now) right = 'mouse';
  return {
   pressed:this.keys.filter(key => this.held.has(key.id)).map(key => key.id),
   mouse:{x:this.x, y:this.y, buttons:{...this.buttons}, wheel:{x:this.wheelX, y:this.wheelY}},
   targets:{left, right, keyboard},
  };
 }
}
