/**
 * Ordinary 2D artwork renderer. This is deliberately independent of Cubism:
 * illustrated sprite poses + seamless eased whole-pose motion, or a hand-drawn canvas fallback.
 * No timers, device access, remote requests, or private activity data live here.
 */
export interface Character2DFrame {
  timeSeconds: number;
  deltaSeconds: number;
  gaze?: { x: number; y: number };
  typing?: number;
  waving?: number;
  audioLevel?: number;
  bounce?: number;
  eating?: number;
  mealProgress?: number;
  mood?: string;
  hidingBowl?: boolean;
  innocent?: boolean;
  sleeping?: boolean;
  reducedMotion?: boolean;
}

export interface Character2DSprite {
  file: string;
  /** Exact source rectangle in an atlas, in pixels. Omit for a whole image. */
  rect?: [number, number, number, number];
  /** Normalized full-art registration, useful for poses with unequal cropping. */
  offset?: [number, number];
  scale?: number;
}
export interface Character2DLayer extends Character2DSprite {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  motion?: 'hair' | 'body' | 'tail' | 'head';
}
export interface Character2DManifest {
  version?: number;
  base?: string;
  artwork?: string;
  design?: { width: number; height: number };
  /** Full-body transparent poses, all registered to the same design canvas. */
  sprites?: Record<string, Character2DSprite | string>;
  moods?: Record<string, string>;
  layers?: Character2DLayer[];
  /** x/y center and width/height in normalized coordinates; no synthetic eye overlay. */
  face?: [number, number, number, number];
}

type LoadedSprite = { image: HTMLImageElement | HTMLCanvasElement; rect: [number, number, number, number]; offset: [number, number]; scale: number };
type Pose = { t: number; reduced: boolean; gx: number; gy: number; breath: number; sway: number; bounce: number; typing: number; wave: number; audio: number; eating: number; hide: number; innocent: boolean; sleeping: boolean; blink: number; mood: string; chew: number };
const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));
const smooth = (a: number, b: number, dt: number, rate = 8): number => a + (b - a) * (1 - Math.exp(-dt * rate));
const TAU = Math.PI * 2;
const INK = '#202749';

export class Character2D {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 500;
  private height = 650;
  private dpr = 1;
  private dead = false;
  private loading?: Promise<void>;
  private manifest: Character2DManifest = {};
  private sprites = new Map<string, LoadedSprite>();
  private images = new Map<string, Promise<HTMLImageElement>>();
  private layers: { spec: Character2DLayer; sprite: LoadedSprite }[] = [];
  private pathCache = new Map<string, Path2D>();
  private gaze = { x: 0, y: 0 };
  private audio = 0;
  private dancing = false;
  private typingAmount = 0;
  private waveAmount = 0;
  private bounceAmount = 0;
  private bounceStart = -10;
  private wasBouncing = false;
  private nextBlink = 2.9;
  private blinkStart = -10;
  private blinkCount = 0;
  private eatingStarted = -1;
  private hideStarted = -1;
  private lastEating?: LoadedSprite;
  private wasHiding = false;
  private previousKey = '';
  private previousSprite?: LoadedSprite;
  private currentSprite?: LoadedSprite;
  private poseChangedAt = -10;
  private lastFrame?: Character2DFrame;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) throw new Error('A Canvas 2D context is required for the 2D edition.');
    this.ctx = context;
    this.resize();
  }

  get hasArtwork(): boolean { return this.sprites.size > 0 || this.layers.length > 0; }

  /** Resolves even if optional artwork is absent; fallback remains animated. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.loadAssets();
    return this.loading;
  }

  private assetURL(file: string): string {
    // The packaged and source renderer directories have the same relative depth.
    // Only relative local asset names are accepted from the art manifest.
    if (!file || /^(?:[a-z]+:|\/\/|\/)/i.test(file) || file.split('/').includes('..')) throw new Error('Invalid local artwork path');
    return new URL(`../../assets/character2d/${file}`, document.baseURI).href;
  }

  private async readSprite(spec: Character2DSprite | string): Promise<LoadedSprite> {
    const record = typeof spec === 'string' ? { file: spec } : spec;
    let imagePromise = this.images.get(record.file);
    if (!imagePromise) {
      imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Optional artwork unavailable'));
        image.src = this.assetURL(record.file);
      });
      this.images.set(record.file, imagePromise);
    }
    const image = await imagePromise;
    if (this.dead) throw new Error('Renderer destroyed');
    const rect = record.rect ?? [0, 0, image.naturalWidth, image.naturalHeight];
    if (rect.length !== 4 || rect.some(n => !Number.isFinite(n)) || rect[2] <= 0 || rect[3] <= 0 || rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > image.naturalWidth + 1 || rect[1] + rect[3] > image.naturalHeight + 1) throw new Error('Invalid artwork source rectangle');
    let source: HTMLImageElement | HTMLCanvasElement = image;
    let sourceRect = rect as [number, number, number, number];
    // Pre-filter oversized single illustrations once. This avoids undersampling
    // fine lace/linework when a 1254px source is displayed as a small desktop pet.
    if (Math.max(rect[2], rect[3]) > 768) {
      const raster = document.createElement('canvas');
      const shrink = 768 / Math.max(rect[2], rect[3]);
      raster.width = Math.max(1, Math.round(rect[2] * shrink));
      raster.height = Math.max(1, Math.round(rect[3] * shrink));
      const context = raster.getContext('2d');
      if (context) {
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'medium';
        context.drawImage(image, ...sourceRect, 0, 0, raster.width, raster.height);
        source = raster; sourceRect = [0, 0, raster.width, raster.height];
      }
    }
    return { image: source, rect: sourceRect, offset: record.offset ?? [0, 0], scale: record.scale ?? 1 };
  }

  private async loadAssets(): Promise<void> {
    try {
      const response = await fetch(this.assetURL('manifest.json'));
      if (response.ok) {
        const candidate: unknown = await response.json();
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          this.manifest = candidate as Character2DManifest;
          if (!Array.isArray(this.manifest.layers)) this.manifest.layers = [];
        }
      }
    } catch { /* File-origin/old installations still get the direct image fallback. */ }
    const manifest = this.manifest;
    const jobs: Promise<unknown>[] = [];
    for (const [key, sprite] of Object.entries(manifest.sprites ?? {})) {
      jobs.push(this.readSprite(sprite).then(result => { if (!this.dead) this.sprites.set(key, result); }).catch(() => undefined));
    }
    for (const [key, file] of Object.entries(manifest.moods ?? {})) {
      if (!manifest.sprites?.[key]) jobs.push(this.readSprite(file).then(result => { if (!this.dead) this.sprites.set(key, result); }).catch(() => undefined));
    }
    const base = manifest.base ?? manifest.artwork ?? 'body.png';
    if (!manifest.sprites?.neutral) jobs.push(this.readSprite(base).then(result => { if (!this.dead) this.sprites.set('neutral', result); }).catch(() => undefined));
    for (const spec of manifest.layers ?? []) jobs.push(this.readSprite(spec).then(sprite => { if (!this.dead) this.layers.push({ spec, sprite }); }).catch(() => undefined));
    await Promise.all(jobs);
    // Preserve manifest order, independent of the time an image decoded.
    this.layers.sort((a, b) => (manifest.layers ?? []).indexOf(a.spec) - (manifest.layers ?? []).indexOf(b.spec));
    if (!this.dead && this.lastFrame) this.update(this.lastFrame);
  }

  resize(width?: number, height?: number): void {
    if (this.dead) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, width ?? (bounds.width || 500));
    this.height = Math.max(1, height ?? (bounds.height || 650));
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const w = Math.round(this.width * this.dpr);
    const h = Math.round(this.height * this.dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'medium';
    if (this.lastFrame) this.update(this.lastFrame);
  }

  update(frame: Character2DFrame): void {
    if (this.dead) return;
    this.lastFrame = frame;
    const t = Number.isFinite(frame.timeSeconds) ? frame.timeSeconds : 0;
    const dt = clamp(frame.deltaSeconds, 0, .15);
    const reduced = frame.reducedMotion === true;
    this.gaze.x = smooth(this.gaze.x, clamp(frame.gaze?.x ?? 0, -1, 1), dt);
    this.gaze.y = smooth(this.gaze.y, clamp(frame.gaze?.y ?? 0, -1, 1), dt);
    this.audio = smooth(this.audio, clamp(frame.audioLevel ?? 0), dt, 12);
    this.dancing = this.dancing ? this.audio > .045 : this.audio > .12;
    if (t >= this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + 3.1 + Math.abs(Math.sin(++this.blinkCount * 12.9898)) * 3.4;
    }
    const blinkAge = t - this.blinkStart;
    const blink = blinkAge >= 0 && blinkAge < .17 ? Math.sin(blinkAge / .17 * Math.PI) : 0;
    const eating = !frame.sleeping && !frame.hidingBowl && (frame.eating ?? 0) > 0;
    if (eating && this.eatingStarted < 0) this.eatingStarted = t;
    if (!eating) this.eatingStarted = -1;
    if (frame.hidingBowl && !this.wasHiding) this.hideStarted = t;
    this.wasHiding = frame.hidingBowl === true;
    const eatPhase = eating ? (t - this.eatingStarted) % 2.6 / 2.6 : 0;
    const active = !frame.sleeping && !reduced;
    this.typingAmount = smooth(this.typingAmount, active ? clamp(frame.typing ?? 0) : 0, dt, 10);
    this.waveAmount = smooth(this.waveAmount, active ? clamp(frame.waving ?? 0) : 0, dt, 7);
    const bouncing = active && (frame.bounce ?? 0) > 0;
    if (bouncing && !this.wasBouncing) this.bounceStart = t;
    this.wasBouncing = bouncing;
    const jumpAge = t - this.bounceStart;
    const jumpEnvelope = jumpAge >= 0 && jumpAge < .72 ? Math.pow(Math.sin(jumpAge / .72 * Math.PI), 1.4) : 0;
    this.bounceAmount = active ? jumpEnvelope : 0;
    const pose: Pose = {
      t, reduced, gx: reduced ? 0 : this.gaze.x, gy: reduced ? 0 : this.gaze.y,
      breath: reduced ? 0 : Math.sin(t * (frame.sleeping ? 1.35 : 1.75)) * .85 + Math.sin(t * .63 + .8) * .15,
      sway: reduced ? 0 : Math.sin(t * .85) * .7 + Math.sin(t * .37 + 1.1) * .3,
      bounce: reduced ? 0 : this.bounceAmount,
      typing: reduced ? 0 : this.typingAmount, wave: reduced ? 0 : this.waveAmount,
      audio: reduced || frame.sleeping ? 0 : this.audio,
      eating: eating ? 1 : 0,
      hide: frame.hidingBowl ? clamp((t - this.hideStarted) / .22) : 1,
      innocent: frame.innocent === true || frame.hidingBowl === true,
      sleeping: frame.sleeping === true, blink,
      mood: frame.sleeping ? 'sleepy' : frame.mood ?? 'happy',
      chew: eatPhase,
    };
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.hasArtwork) this.drawArtwork(pose);
    else this.drawVector(pose);
  }

  private selectedSprite(p: Pose): { key: string; sprite?: LoadedSprite } {
    const candidates: string[] = [];
    if (p.innocent) candidates.push('caught', 'innocent', 'neutral');
    else if (p.sleeping) candidates.push('sleepy', 'sleep');
    else if (p.eating) {
      if (p.chew < .35) candidates.push('eat', 'rice', 'scoop');
      else if (p.chew < .57) candidates.push('bite', 'eat');
      else candidates.push('chew', 'puff', 'eat');
    } else if (p.blink > .6 && p.mood !== 'sleepy') candidates.push(`${p.mood}Blink`, `${p.mood}-blink`, 'blink');
    if (!p.innocent && !p.eating && !p.sleeping) {
      if (p.wave > .05) candidates.push('wave');
      if (p.typing > .05) candidates.push(Math.floor(p.t * 3) % 2 ? 'typingAlt' : 'typing', 'typing');
      else if (this.dancing && p.audio > .045) candidates.push(Math.floor(p.t * 1.8) % 2 ? 'musicAlt' : 'music', 'music');
    }
    candidates.push(p.mood, p.mood === 'aggrieved' ? 'sad' : p.mood, 'neutral', 'happy');
    for (const key of candidates) if (this.sprites.has(key)) return { key, sprite: this.sprites.get(key) };
    const first = this.sprites.entries().next().value as [string, LoadedSprite] | undefined;
    return first ? { key: first[0], sprite: first[1] } : { key: '' };
  }

  private drawArtwork(p: Pose): void {
    const selected = this.selectedSprite(p);
    if (selected.key !== this.previousKey) {
      this.previousSprite = this.currentSprite;
      this.currentSprite = selected.sprite;
      this.previousKey = selected.key;
      this.poseChangedAt = p.t;
    }
    if (p.eating && selected.sprite) this.lastEating = selected.sprite;
    const ref = selected.sprite ?? this.layers[0]?.sprite;
    if (!ref) return;
    const ratio = this.manifest.design ? this.manifest.design.width / this.manifest.design.height : ref.rect[2] / ref.rect[3];
    const availableW = this.width * .95;
    const availableH = this.height * .965;
    const height = Math.min(availableH, availableW / ratio);
    const width = height * ratio;
    const x = (this.width - width) / 2;
    const y = this.height - height - this.height * .018;
    const ctx = this.ctx;
    ctx.save();
    const bop = Math.abs(Math.sin(p.t * 13)) * p.typing * height * .006;
    const jump = p.bounce * height * .032;
    ctx.translate(x + width / 2, y + height - jump - bop);
    ctx.rotate((p.sway * .012 + Math.sin(p.t * 5) * p.audio * .032 + p.gx * .006) * (p.reduced ? 0 : 1));
    const breathScale = 1 + p.breath * .007;
    ctx.scale(1 - p.breath * .0025 + p.bounce * .008, breathScale - p.bounce * .006);
    // A single affine bend keeps every pixel joined, including face and hair.
    // Never slice the existing artwork or crossfade two differently drawn faces.
    ctx.transform(1, 0, p.reduced ? 0 : Math.sin(p.t * .85 - .45) * .004 + p.gx * .006, 1, 0, 0);
    ctx.translate(-width / 2, -height);
    // Whole registered poses avoid strip seams and crossfade double faces.
    if (selected.sprite) this.warp(selected.sprite, width, height, p, 1);
    for (const { spec, sprite } of this.layers) {
      const dw = this.manifest.design?.width ?? 1024;
      const dh = this.manifest.design?.height ?? 1024;
      const lx = (spec.x ?? 0) / dw * width;
      const ly = (spec.y ?? 0) / dh * height;
      const lw = (spec.width ?? sprite.rect[2]) / dw * width;
      const lh = (spec.height ?? sprite.rect[3]) / dh * height;
      ctx.save();
      const ax = (spec.anchorX ?? .5) * lw, ay = (spec.anchorY ?? .1) * lh;
      ctx.translate(lx + ax, ly + ay);
      const motion = spec.motion ?? 'body';
      ctx.rotate(p.reduced ? 0 : motion === 'tail' ? Math.sin(p.t * 1.7) * .055 : motion === 'hair' ? Math.sin(p.t * 1.15 + lx) * .025 : motion === 'head' ? p.gx * .025 : 0);
      ctx.drawImage(sprite.image, ...sprite.rect, -ax, -ay, lw, lh);
      ctx.restore();
    }
    // Brief last bowl pose slips sideways before the illustrated caught pose wins.
    if (p.innocent && p.hide < 1 && this.lastEating && !p.reduced) {
      ctx.save();
      ctx.translate(width * .22 * p.hide, height * .09 * p.hide);
      // Only the little bowl area moves: never ghost an entire second face.
      ctx.beginPath(); ctx.rect(width * .38, height * .53, width * .25, height * .18); ctx.clip();
      this.warp(this.lastEating, width, height, p, (1 - p.hide) * .65);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Seamless registered artwork movement supplies gaze response,
   * without claiming to be a Live2D mesh or drawing fake eyes over artwork. */
  private warp(sprite: LoadedSprite, width: number, height: number, p: Pose, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= clamp(alpha);
    const [sx, sy, sw, sh] = sprite.rect;
    const ox = sprite.offset[0] * width, oy = sprite.offset[1] * height;
    const scale = sprite.scale;
    const outW = width * scale, outH = height * scale;
    const baseX = (width - outW) / 2 + ox, baseY = height - outH + oy;
    // Keep the illustrated face intact. Breathing, tilt and bounce are applied
    // to the complete pose by drawArtwork; cut-strip deformation creates seams.
    ctx.drawImage(sprite.image, sx, sy, sw, sh,
      baseX + (p.reduced ? 0 : p.gx * outW * .018), baseY + (p.reduced ? 0 : p.gy * outH * .008), outW, outH);
    ctx.restore();
  }

  private path(data: string, fill?: string | CanvasGradient, stroke: string | null = INK, lineWidth = 2): void {
    let path = this.pathCache.get(data);
    if (!path) { path = new Path2D(data); this.pathCache.set(data, path); }
    const c = this.ctx;
    if (fill) { c.fillStyle = fill; c.fill(path); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lineWidth; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(path); }
  }
  private oval(x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, stroke?: string, width = 2): void {
    const c = this.ctx;
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
  }
  private gradient(y1: number, y2: number, colors: [number, string][]): CanvasGradient {
    const g = this.ctx.createLinearGradient(0, y1, 0, y2);
    colors.forEach(([stop, color]) => g.addColorStop(stop, color)); return g;
  }
  private bow(x: number, y: number, s: number, blue = true): void {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(s, s);
    const color = blue ? '#4d9fda' : '#efd394';
    this.path('M0 0C-7-11-24-21-25-12L-21 12Q-18 19 0 3Q18 19 21 12L25-12C24-21 7-11 0 0Z', color, INK, 1.8);
    this.path('M-5 6L-13 25L0 21L7 27L11 6', color, INK, 1.8);
    this.path('M-15-5L-4 1M15-5L4 1', undefined, blue ? '#286eae' : '#bd9964', 1.5);
    this.path('M0-3C-7-10-11 0 0 8C11 0 7-10 0-3Z', '#f6d58e', '#bd9964', 1);
    c.restore();
  }
  private scallop(x: number, y: number, width: number, count: number, radius: number, color = '#fffdf8'): void {
    for (let i = 0; i <= count; i++) this.oval(x + width * i / count, y, radius, radius * .8, color, '#d3cedc', 1.1);
  }
  private whale(x: number, y: number, s: number): void {
    const c = this.ctx; c.save(); c.translate(x,y); c.scale(s,s);
    this.path('M-32 4C-35-12-21-24-5-22C12-20 15 0 27-3Q28-15 36-14Q42-6 34 1Q48-4 46 4Q42 15 24 13C12 28-28 25-32 4Z', '#68b3e3', '#326bab', 1.6);
    this.path('M-30 4Q-14-2 8 17Q-13 27-30 4Z', '#d6f3ff', '#508bbd', 1);
    this.path('M-25 6L-14 20M-18 5L-6 20M-10 7L2 19', undefined, '#79acd0', 1);
    this.oval(-11,-8,1.6,2.2,'#203c74');
    this.path('M-7-27Q-20-39-10-39Q-4-39-7-27M-3-27Q-1-41 5-37Q11-32-3-27', '#68b3e3', null);
    c.restore();
  }

  private drawVector(p: Pose): void {
    const c = this.ctx;
    const s = Math.min(this.width / 500, this.height / 650);
    c.save(); c.translate((this.width - 500*s)/2, this.height - 642*s); c.scale(s,s);
    const jump = p.bounce*18 + p.typing*Math.abs(Math.sin(p.t*12))*2;
    c.translate(250,596-jump); c.rotate(p.sway*.007 + Math.sin(p.t*4.5)*p.audio*.045); c.scale(1-p.breath*.002,1+p.breath*.004); c.translate(-250,-596);
    const hair = this.gradient(95,562,[[0,'#303f85'],[.38,'#4d65b1'],[.8,'#65a3df'],[1,'#85ceeb']]);
    const dress = this.gradient(330,537,[[0,'#334575'],[.5,'#253563'],[1,'#354c85']]);
    const white = this.gradient(335,535,[[0,'#fffefb'],[1,'#e5e9f5']]);
    // Cascading back hair: separate overlapping curls, not a solid disk.
    c.save(); c.translate(250,145); c.rotate(Math.sin(p.t*1.1)*.012); c.translate(-250,-145);
    this.path('M135 147C73 210 94 266 71 321C38 383 50 420 65 447C24 477 63 510 83 504C54 548 95 570 122 548C147 586 176 566 184 550L339 553C371 578 397 548 387 525C432 536 462 499 428 466C452 420 417 389 424 349C435 275 395 195 362 157Z',hair,INK,3);
    this.path('M107 235C85 334 163 349 100 426C66 465 86 504 116 484C86 534 121 550 147 530M385 231C418 325 343 352 408 421C439 467 405 502 387 485C411 529 379 553 355 532',undefined,'#3b5796',2);
    this.path('M115 289C94 352 147 362 117 407M376 292C401 348 351 374 394 422M112 499Q128 511 142 486M366 498Q387 509 398 486',undefined,'#a2d9f2',2);
    c.restore();
    // Fine stockings and polished Mary Jane shoes.
    for (const x of [214,284]) {
      this.path(`M${x-19} 514L${x+20} 514L${x+19} 583Q${x} 599 ${x-20} 581Z`,'#ffeadf',INK,2);
      this.path(`M${x-21} 553Q${x} 546 ${x+20} 553L${x+23} 580Q${x} 595 ${x-23} 579Z`,white,INK,2);
      this.scallop(x-19,552,38,5,5);
      this.path(`M${x-23} 573Q${x-9} 582 ${x+18} 570Q${x+29} 579 ${x+25} 595Q${x+4} 613 ${x-24} 599Q${x-32} 589 ${x-23} 573Z`,'#263967',INK,3);
      this.path(`M${x-20} 578Q${x} 589 ${x+18} 576`,undefined,'#d4e8fa',5);
      this.oval(x+14,578,4,5,'#f3d18e','#8c7450',1);
      this.oval(x-11,594,4,2,'#7e9ddb');
    }
    // Articulated whale tail, matching the blue tail detail in the reference.
    c.save(); c.translate(350,477); c.rotate(Math.sin(p.t*1.7)*.06); c.translate(-350,-477);
    this.path('M342 495Q374 482 373 459C352 440 371 402 385 393Q402 423 394 443Q422 420 450 435Q440 468 405 468Q388 501 355 516Z',hair,INK,2.8);
    this.path('M380 470Q389 438 386 410M395 457Q420 443 439 440M374 484Q390 476 397 463',undefined,'#356697',1.4);
    c.restore();
    // Layered skirt lace, embroidery and apron.
    this.path('M190 389Q249 376 311 389Q343 437 370 490Q378 513 350 524Q320 552 289 537Q251 557 218 541Q178 552 155 532Q121 526 135 500Z',white,INK,3);
    for(let i=0;i<13;i++){const x=139+i*18.2;const y=515+Math.sin(i/12*Math.PI)*22;this.oval(x,y,12,8,'#fffdf8','#c6bfce',1);this.oval(x,y+1,7,3,'#fffdf8','#e1cda0',1);}
    this.path('M189 379Q249 367 311 379C321 414 341 453 360 491Q258 546 142 493Q173 450 189 379Z',dress,INK,3);
    this.path('M155 486Q252 533 348 487M160 478Q251 522 342 479',undefined,'#d9b882',1.5);
    for(let i=0;i<9;i++){const x=172+i*19;const y=490+Math.sin(i/8*Math.PI)*20;this.path(`M${x-6} ${y-4}Q${x} ${y-13} ${x+6} ${y-4}M${x} ${y-8}Q${x+5} ${y-14} ${x+7} ${y-10}`,undefined,'#d5b786',1.2);}
    this.path('M207 325Q250 315 292 325L318 402Q253 422 186 402Z',dress,INK,3);
    this.path('M222 327L274 327L285 393L214 393Z',white,INK,1.6);
    this.scallop(215,338,68,8,5);
    for(const x of [209,290]){this.path(`M${x} 338Q${x-6} 368 ${x} 397`,undefined,'#fffdfb',10);for(let i=0;i<5;i++)this.oval(x+(x<250?-4:4),342+i*12,4.5,7,'#fffdfa','#d1cad9',.8);}
    this.path('M195 392Q247 402 307 392L304 407Q246 420 197 407Z','#fffdfa',INK,1.5);
    this.scallop(202,438,97,12,6);
    this.path('M202 409Q250 403 299 409L303 459Q296 491 252 494Q207 490 198 461Z',white,'#d6d1dd',2);
    for(let i=0;i<12;i++){const a=Math.PI*i/11;const x=250-51*Math.cos(a);const y=449+44*Math.sin(a);this.oval(x,y,6,5,'#fffdf8','#d9d1de',.8);}
    this.path('M209 419L207 456Q212 481 251 482Q289 481 294 456L292 419',undefined,'#ddc698',1);
    this.whale(249,449,.68);
    this.bow(179,487,.65,false);this.bow(324,489,.65,false);
    // Collar ribbons and pearl buttons.
    this.path('M224 327L241 348L250 333L261 348L281 327',white,INK,1.5);
    this.bow(250,340,1.0);
    this.oval(250,340,7,9,'#e5c184','#7f633e',1.4);this.oval(250,339,4.5,6,'#78cfec','#457baf',1.1);
    for (const y of [372,386]) for(const x of [240,259]) this.oval(x,y,2.4,2.6,'#f6e5b9','#ab9267',.5);
    this.arms(p,dress,white);
    this.head(p,hair);
    if(p.eating || p.hide<1)this.rice(p);
    c.restore();
  }

  private arms(p: Pose, dress: CanvasGradient, white: CanvasGradient): void {
    const c=this.ctx;
    for(const side of [-1,1]){
      const shoulder=250+side*48;
      c.save();c.translate(shoulder,346);
      const shy=p.mood==='shy'&&!p.innocent;
      let angle=side*(p.eating?.36:shy?.75:.12);
      if(!p.eating&&!shy)angle+=side*Math.sin(p.t*13)*p.typing*.12;
      if(side===1&&!p.eating)angle+=p.wave*(.65+Math.sin(p.t*16)*.2);
      c.rotate(angle);c.translate(-shoulder,-346);
      const handY=shy?392:417;
      this.path(`M${shoulder-17} 340Q${shoulder-32} 355 ${shoulder-23} 391L${shoulder-21} ${handY}Q${shoulder} ${handY+14} ${shoulder+21} ${handY}L${shoulder+22} 371Q${shoulder+24} 346 ${shoulder+17} 341Z`,dress,INK,2.5);
      this.path(`M${shoulder-23} ${handY-7}L${shoulder+22} ${handY-7}L${shoulder+20} ${handY+5}Q${shoulder} ${handY+15} ${shoulder-20} ${handY+5}Z`,'#3a527f',INK,1.6);
      this.path(`M${shoulder-19} ${handY-3}Q${shoulder} ${handY+3} ${shoulder+18} ${handY-3}`,undefined,'#d7ba85',1);
      this.scallop(shoulder-16,handY+7,32,5,5);
      this.oval(shoulder,handY+17,15,15,'#ffe8dc',INK,1.8);
      for(const dx of [-6,0,6])this.path(`M${shoulder+dx} ${handY+24}L${shoulder+dx} ${handY+29}`,undefined,'#d79e95',.8);
      c.restore();
    }
  }

  private head(p: Pose, hair: CanvasGradient): void {
    const c=this.ctx;c.save();c.translate(250,320);c.rotate(p.gx*.025+(p.mood==='shy'?-.045:0));c.translate(-250+p.gx*3,-320+p.gy*1.5);
    // White shell-like maid headdress.
    c.save();c.translate(250,184);
    for(let i=0;i<=12;i++){const a=Math.PI+Math.PI*i/12;const x=Math.cos(a)*128;const y=Math.sin(a)*105;this.oval(x,y,19,18,'#fffdfb',INK,2);this.oval(x,y,12,11,'#f5f2f8','#d2c8df',1);this.oval(x,y+2,3.7,4.5,'#d0c3dc');}
    c.restore();
    this.path('M244 88C267 42 218 30 188 57Q163 74 158 85C151 44 212 6 253 35Q280 56 260 90Z',hair,INK,2.5);
    this.path('M120 204Q111 115 202 99Q296 62 357 131C397 170 384 257 359 287Q324 326 251 331Q173 330 137 294Z',hair,INK,3);
    const skin=this.gradient(183,329,[[0,'#fff2e7'],[1,'#ffe4d8']]);
    this.path('M146 216Q154 171 250 172Q342 173 355 218L349 282Q333 329 250 332Q170 329 148 288Z',skin,INK,2.4);
    // Blush, eyes, and small expressive mouth are genuine local paths.
    const blush=p.mood==='shy'?.43:p.innocent?.22:.27;
    c.save();c.globalAlpha=blush;
    for(const x of [177,324]){const g=c.createRadialGradient(x,281,0,x,281,28);g.addColorStop(0,'#ee7593');g.addColorStop(1,'rgba(244,140,153,0)');this.oval(x,281,28,16,g);}
    c.restore();
    for(const side of [-1,1])this.eye(250+side*55,255,side,p);
    const chew=p.eating&&p.chew>.57;
    if(chew){this.oval(197,290,13,8,'#ffe2d5');this.oval(304,290,13,8,'#ffe2d5');this.path('M242 295Q250 299 257 295',undefined,'#aa626c',1.8);}
    else if(p.sleeping||p.mood==='sleepy')this.oval(250,301,5,6,'#cc7c84','#9b5a66',1);
    else if(p.mood==='aggrieved'&&!p.innocent)this.path('M241 303Q245 299 249 303Q253 299 258 303',undefined,'#a95f77',1.7);
    else if(p.mood==='unimpressed'&&!p.innocent)this.path('M245 300L254 300',undefined,'#a46577',1.7);
    else if(p.mood==='happy'&&!p.innocent&&!p.eating){this.path('M234 294Q251 303 267 292Q266 320 250 316Q237 313 234 294Z','#d87885','#a05065',1.6);this.oval(251,310,10,5,'#f3a0a0');}
    else this.path('M242 299Q250 306 259 298',undefined,'#a96177',1.8);
    // Swooping front locks with a recognizable navy-to-blue sweep.
    this.path('M228 108C182 128 202 234 245 250Q266 266 281 252C250 228 263 173 268 145C281 195 304 227 329 229Q344 226 353 215C326 202 322 164 310 138Q282 93 250 111Z',hair,INK,2.3);
    this.path('M219 111C159 110 128 171 128 239Q128 284 165 300Q172 301 180 298C142 272 176 208 172 174Q177 138 219 111Z',hair,INK,2.3);
    this.path('M301 112Q370 128 375 217C382 260 369 292 335 299Q325 300 320 293C360 276 331 228 341 194Q337 147 301 112Z',hair,INK,2.3);
    this.path('M221 123Q208 163 237 222M151 208Q144 255 157 275M357 216Q363 254 347 276',undefined,'#a1bdee',1.5);
    c.save();c.globalAlpha=.6;
    this.oval(189,154,6,14,'#a4c3ed');this.oval(203,145,4,10,'#a4c3ed');this.oval(286,147,5,12,'#a4c3ed');this.oval(298,151,4,8,'#a4c3ed');
    c.restore();
    // Feathered fins and turquoise bow clips frame the hairstyle.
    this.path('M132 192Q114 221 89 229Q109 245 141 228L151 205Z','#eaf7fd',INK,2);this.path('M363 190Q379 216 407 225Q387 242 357 225L348 204Z','#eaf7fd',INK,2);
    this.path('M132 204Q116 224 103 228M365 202Q381 222 394 226',undefined,'#b1cada',1);
    this.bow(134,198,.79);this.bow(365,194,.89);
    c.restore();
  }

  private eye(x:number,y:number,side:number,p:Pose):void{
    const c=this.ctx;
    const closed=p.sleeping||p.mood==='sleepy'||p.blink>.72;
    if(closed){this.path(`M${x-24} ${y+5}Q${x} ${y+20} ${x+24} ${y+3}`,undefined,'#38293c',5);for(let i=0;i<3;i++)this.path(`M${x+side*(15+i*4)} ${y+9-i}L${x+side*(20+i*5)} ${y+16-i}`,undefined,'#38293c',2.5);return;}
    const low=p.mood==='unimpressed'?.55:p.mood==='aggrieved'?.7:1;
    c.save();c.beginPath();c.ellipse(x,y+4,25,29*low,0,0,TAU);c.clip();
    this.oval(x,y+4,25,32,'#fffdfb');
    const iris=this.gradient(y-22,y+33,[[0,'#26326d'],[.3,'#315cac'],[.7,'#54b8eb'],[1,'#b9f2ff']]);
    this.oval(x+p.gx*4,y+8+p.gy*3,19,27,iris,'#283a74',1.2);
    this.oval(x+p.gx*4,y+6+p.gy*3,6.5,17,'#263768');
    this.oval(x+p.gx*3-7,y-7,6,7,'#fffdfb');this.oval(x+p.gx*3+7,y,2.5,3,'#d7f9ff');this.oval(x,y+24,9,4,'#a8e5f5');
    if(p.mood==='happy'){this.path(`M${x} ${y+10}L${x+2} ${y+16}L${x+7} ${y+18}L${x+2} ${y+20}L${x} ${y+26}L${x-2} ${y+20}L${x-7} ${y+18}L${x-2} ${y+16}Z`,'#ffe3a0',null);}
    c.restore();
    const top=y+4-29*low;
    this.path(`M${x-24} ${top+9}Q${x-3} ${top-3} ${x+23} ${top+8}`,undefined,'#342536',5);
    const edge=x+side*23;this.path(`M${edge} ${top+8}L${edge+side*9} ${top+2}M${edge-side*6} ${top+5}L${edge+side*1} ${top-3}`,undefined,'#342536',2.5);
    const browY=top-13;
    this.path(p.mood==='aggrieved'?`M${x-21} ${browY+side*5}Q${x} ${browY} ${x+20} ${browY-side*5}`:`M${x-19} ${browY+3}Q${x} ${browY-5} ${x+18} ${browY+2}`,undefined,'#4d4262',1.6);
    if(p.mood==='aggrieved'){this.oval(x,y+23,18,4,'rgba(162,225,249,.8)','#77b4d4',.8);this.oval(x-side*19,y+30,3,5,'#c9f0ff','#89c9e3',.7);}
  }

  private rice(p:Pose):void{
    const c=this.ctx;c.save();
    const hide=p.eating?0:p.hide;
    c.globalAlpha=1-hide;c.translate(hide*100,hide*55);
    const lift=p.chew>.35&&p.chew<.57?Math.sin((p.chew-.35)/.22*Math.PI):0;
    // China bowl with a clearly white mound of individual rice grains.
    this.path('M199 405Q250 385 301 405Q299 446 272 451L231 451Q201 442 199 405Z','#e9f6fc',INK,2.2);
    this.oval(250,404,51,13,'#94bfde',INK,1.8);
    this.path('M203 404Q205 388 220 391Q222 375 235 383Q248 371 260 382Q276 376 282 390Q297 388 298 403Z','#fffefa','#dedbce',1.1);
    for(let i=0;i<23;i++){const x=214+(i*17)%74;const y=388+(i*7)%15;this.oval(x,y,3.1,1.25,'#fffffc','#e5dfd2',.45);}
    this.path('M211 422Q250 442 289 421',undefined,'#6eabd0',2);
    this.whale(251,433,.24);
    this.path('M236 451L270 451L266 457L241 457Z','#d4e8f6',INK,1.4);
    // One hand cradles the bowl, the other carries a rice-filled spoon to the mouth.
    this.oval(201,421,12,13,'#ffe8dd',INK,1.6);
    c.save();c.translate(300,405);c.rotate(-lift*.8);c.translate(-300,-405);
    this.oval(302,413,11,12,'#ffe8dd',INK,1.6);
    this.path('M302 408L274 381',undefined,'#d7b681',5);
    this.oval(269,377,13,6,'#edf7fb','#788ea1',1.3);
    if(p.chew<.57)this.oval(269,374,10,4,'#fffefa','#ddd8cd',.8);
    c.restore();
    c.restore();
  }

  destroy(): void {
    this.dead = true;
    this.sprites.clear(); this.images.clear(); this.layers = []; this.pathCache.clear();
    this.currentSprite = undefined; this.previousSprite = undefined; this.lastEating = undefined;
    this.lastFrame = undefined;
    this.ctx.setTransform(1,0,0,1,0,0);
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  }
}
