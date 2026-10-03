/**
 * Optional developer adapter. Cubism Core and a licensed, rigged model are required.
 * JPEG artwork is never promoted to a Live2D model. No SDK/CDN is downloaded here.
 */
import type { Application, Container } from 'pixi.js';

const CORE_URL = 'app-core://runtime/live2dcubismcore.min.js';
const DEFAULT_PARAMETERS = {
  angleX: 'ParamAngleX', angleY: 'ParamAngleY', angleZ: 'ParamAngleZ',
  bodyX: 'ParamBodyAngleX', bodyY: 'ParamBodyAngleY', breath: 'ParamBreath',
  eyeX: 'ParamEyeBallX', eyeY: 'ParamEyeBallY', eyeLOpen: 'ParamEyeLOpen', eyeROpen: 'ParamEyeROpen',
  mouthOpen: 'ParamMouthOpenY', mouthForm: 'ParamMouthForm',
  typing: 'ParamTyping', bounce: 'ParamBounce',
  riceBowl: 'ParamRiceBowlOpacity', riceArm: 'ParamRiceArm', cheekPuff: 'ParamCheekPuff',
} as const;
export type ParameterRole = keyof typeof DEFAULT_PARAMETERS;
export type ParameterOwner = 'adapter' | 'expression' | 'model';
export interface MotionBinding { group: string; index?: number }
export interface RigManifest {
  version: 1;
  parameters?: Partial<Record<ParameterRole, string>>;
  /** adapter: driven here; expression: authored expression while active, adapter otherwise;
   * model: never driven here. Sleep's forced eyelid closure has safety precedence. */
  parameterOwnership?: Partial<Record<ParameterRole, ParameterOwner>>;
  /** Adapter-owned eyelid resting openness per mood, normalized 0..1. */
  moodEyeOpen?: Record<string, number>;
  /** Key is application mood (e.g. happy, shy, aggrieved, sleepy, unimpressed). */
  expressions?: Record<string, string>;
  /** Supported keys: idle, typing, bounce, eat, or mood:<application mood>. */
  motions?: Record<string, MotionBinding>;
}
export interface CapabilityDetail { supported: boolean; present: string[]; missing: string[]; externallyOwned: string[] }
export interface Live2DCapabilities {
  parameters: string[];
  gaze: CapabilityDetail;
  breathing: CapabilityDetail;
  blink: CapabilityDetail;
  sleepEyes: CapabilityDetail;
  parameterOwnership: Partial<Record<ParameterRole, ParameterOwner>>;
  typing: CapabilityDetail;
  bounce: CapabilityDetail;
  audio: CapabilityDetail;
  eating: CapabilityDetail;
  expressions: string[];
  motions: string[];
  warnings: string[];
}
export interface Live2DStatus {
  state: 'missing-runtime' | 'missing-model' | 'loading' | 'ready' | 'error';
  message: string;
  capabilities?: Live2DCapabilities;
}
export interface Live2DLoadRequest {
  modelUrl?: string | null;
  coreAvailable?: boolean;
  coreUrl?: string;
  manifest?: unknown;
}
export interface Live2DFrame {
  timeSeconds: number;
  deltaSeconds: number;
  /** Normalized cursor position, x/y in [-1, 1], positive y looks upward. */
  gaze?: { x: number; y: number };
  typing?: number;
  physical?: import('../shared/physical-input').PhysicalInputSnapshot;
  audioLevel?: number;
  bounce?: number;
  /** Normalized meal progress: 0/inactive or (0, 1] during a meal. */
  eating?: number;
  mood?: string;
  sleeping?: boolean;
  hidingBowl?: boolean;
  innocent?: boolean;
  reducedMotion?: boolean;
}
export interface Live2DRendererOptions {
  canvas: HTMLCanvasElement;
  onStatus?: (status: Live2DStatus) => void;
}
interface Parameter { id: string; min: number; max: number; initial: number }
interface CoreModel {
  getModel(): { parameters: { ids: string[]; minimumValues: ArrayLike<number>; maximumValues: ArrayLike<number>; defaultValues: ArrayLike<number> } };
  setParameterValueById(id: string, value: number, weight?: number): void;
}
interface ExpressionManager {
  resetExpression(): void;
  stopAllExpressions?(): void;
  reserveExpressionIndex?: number;
  currentExpression?: unknown;
  defaultExpression?: unknown;
  expressions?: unknown[];
  getExpressionIndex?(name: string): number;
}
interface InternalModel {
  width: number; height: number; coreModel: CoreModel;
  on(event: string, callback: () => void): unknown;
  off(event: string, callback: () => void): unknown;
  motionManager: { expressionManager?: ExpressionManager; groups: { idle: string }; stopAllMotions(): void };
  emit(event: string): boolean;
}
type Model = Container & {
  internalModel: InternalModel;
  anchor: { set(x: number, y: number): void };
  update(milliseconds: number): void;
  expression(name: string): Promise<boolean>;
  motion(group: string, index?: number, priority?: number): Promise<boolean>;
};
interface ModelSettings extends Record<string, unknown> {
  FileReferences: {
    Moc: string; Textures: string[]; Expressions?: { Name: string; File: string }[];
    Motions?: Record<string, { File: string; Sound?: string }[]>;
    [key: string]: unknown;
  };
}

const clamp = (value: unknown, low = 0, high = 1): number => typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const safeKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);

export function validateRigManifest(input: unknown): RigManifest {
  if (input === null || input === undefined) return { version: 1 };
  if (!isRecord(input) || input.version !== 1) throw new Error('模型动作清单必须使用 version: 1');
  const result: RigManifest = { version: 1 };
  if (input.parameters !== undefined) {
    if (!isRecord(input.parameters)) throw new Error('parameters 必须是参数映射');
    result.parameters = {};
    for (const [role, id] of Object.entries(input.parameters)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_PARAMETERS, role) || !safeKey(id)) throw new Error(`无效模型参数映射：${role}`);
      result.parameters[role as ParameterRole] = id;
    }
  }
  if (input.parameterOwnership !== undefined) {
    if (!isRecord(input.parameterOwnership)) throw new Error('parameterOwnership 必须是参数驱动权映射');
    result.parameterOwnership = {};
    for (const [role, owner] of Object.entries(input.parameterOwnership)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_PARAMETERS, role) || (typeof owner !== 'string' || !['adapter', 'expression', 'model'].includes(owner))) throw new Error(`无效参数驱动权：${role}`);
      result.parameterOwnership[role as ParameterRole] = owner as ParameterOwner;
    }
  }
  if (input.moodEyeOpen !== undefined) {
    if (!isRecord(input.moodEyeOpen) || Object.keys(input.moodEyeOpen).length > 64) throw new Error('moodEyeOpen 必须是有限的心情开眼值映射');
    result.moodEyeOpen = Object.create(null) as Record<string, number>;
    for (const [mood, openness] of Object.entries(input.moodEyeOpen)) {
      if (!safeKey(mood) || typeof openness !== 'number' || !Number.isFinite(openness) || openness < 0 || openness > 1) throw new Error('心情开眼值必须是 0–1');
      result.moodEyeOpen[mood] = openness;
    }
  }
  if (input.expressions !== undefined) {
    if (!isRecord(input.expressions) || Object.keys(input.expressions).length > 64) throw new Error('无效表情映射');
    result.expressions = Object.create(null) as Record<string, string>;
    for (const [mood, name] of Object.entries(input.expressions)) {
      if (!safeKey(mood) || !safeKey(name)) throw new Error('无效表情名称');
      result.expressions[mood] = name;
    }
  }
  if (input.motions !== undefined) {
    if (!isRecord(input.motions) || Object.keys(input.motions).length > 64) throw new Error('无效动作映射');
    result.motions = Object.create(null) as Record<string, MotionBinding>;
    for (const [key, binding] of Object.entries(input.motions)) {
      if (!safeKey(key) || !isRecord(binding) || !safeKey(binding.group) || (binding.index !== undefined && (!Number.isInteger(binding.index) || Number(binding.index) < 0))) throw new Error(`无效动作映射：${key}`);
      result.motions[key] = { group: binding.group, ...(binding.index === undefined ? {} : { index: Number(binding.index) }) };
    }
  }
  return result;
}

/** Restrict all model resources to the selected local bundle, including nested files. */
export function validateModelSettings(input: unknown, modelUrl: string): ModelSettings {
  const url = new URL(modelUrl);
  if (url.protocol !== 'app-model:' || url.hostname !== 'bundle' || url.username || url.password || url.port || url.search || url.hash || !url.pathname.endsWith('.model3.json')) throw new Error('仅支持本地 app-model://bundle/ 下的 .model3.json 模型');
  if (!isRecord(input) || input.Version !== 3 || !isRecord(input.FileReferences)) throw new Error('不是有效的 Cubism model3.json 文件');
  const refs = input.FileReferences;
  if (typeof refs.Moc !== 'string' || !refs.Moc.endsWith('.moc3') || !Array.isArray(refs.Textures) || refs.Textures.length < 1 || refs.Textures.length > 64 || !refs.Textures.every(item => typeof item === 'string')) throw new Error('模型需要 .moc3 和至少一张纹理；JPEG 参考图不是 Live2D 模型');
  const checkPath = (value: unknown): void => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || /[\\\u0000-\u001f?#]/.test(value) || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) throw new Error('模型资源必须使用相对本地路径');
    let decoded: string;
    try { decoded = decodeURIComponent(value); } catch { throw new Error('模型资源路径编码无效'); }
    if (decoded.split('/').some(segment => segment === '..') || /[\\\u0000-\u001f]/.test(decoded)) throw new Error('模型资源不能跳出导入的文件夹');
    const resolved = new URL(value, url);
    if (resolved.protocol !== 'app-model:' || resolved.hostname !== 'bundle') throw new Error('模型资源不能访问网络或其他位置');
  };
  checkPath(refs.Moc);
  refs.Textures.forEach(checkPath);
  for (const name of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) if (refs[name] !== undefined) checkPath(refs[name]);
  if (refs.Expressions !== undefined) {
    if (!Array.isArray(refs.Expressions) || refs.Expressions.length > 128) throw new Error('模型表情列表无效');
    for (const expression of refs.Expressions) {
      if (!isRecord(expression) || !safeKey(expression.Name)) throw new Error('模型表情名称无效');
      checkPath(expression.File);
    }
  }
  if (refs.Motions !== undefined) {
    if (!isRecord(refs.Motions) || Object.keys(refs.Motions).length > 128) throw new Error('模型动作组无效');
    for (const motions of Object.values(refs.Motions)) {
      if (!Array.isArray(motions) || motions.length > 256) throw new Error('模型动作列表无效');
      for (const motion of motions) {
        if (!isRecord(motion)) throw new Error('模型动作无效');
        checkPath(motion.File);
        if (motion.Sound !== undefined) checkPath(motion.Sound);
      }
    }
  }
  return input as ModelSettings;
}

let corePromise: Promise<void> | undefined;
function loadCore(coreUrl: string): Promise<void> {
  if (coreUrl !== CORE_URL) return Promise.reject(new Error('Cubism Core 只能从用户指定的本地运行时加载'));
  if ((window as Window & { Live2DCubismCore?: unknown }).Live2DCubismCore) return Promise.resolve();
  if (corePromise) return corePromise;
  corePromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CORE_URL;
    script.async = true;
    const timeout = window.setTimeout(() => finish(new Error('本地 Cubism Core 加载超时')), 15_000);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      if (error) reject(error); else resolve();
    };
    script.onload = () => finish((window as Window & { Live2DCubismCore?: unknown }).Live2DCubismCore ? undefined : new Error('所选脚本不是有效的 Cubism Core'));
    script.onerror = () => finish(new Error('未找到可用的本地 Cubism Core 运行时'));
    document.head.append(script);
  }).catch(error => { corePromise = undefined; throw error; });
  return corePromise;
}

export class Live2DRenderer {
  private app?: Application;
  private model?: Model;
  private pendingModel?: Model;
  private cancelPending?: () => void;
  private generation = 0;
  private abort?: AbortController;
  private disposed = false;
  private manifest: RigManifest = { version: 1 };
  private parameters = new Map<ParameterRole, Parameter>();
  private capabilities?: Live2DCapabilities;
  private frame: Live2DFrame = { timeSeconds: 0, deltaSeconds: 0 };
  private currentStatus: Live2DStatus = { state: 'missing-model', message: '待导入已绑定的 Live2D 模型' };
  private width = 360;
  private height = 480;
  private previousMood = '';
  private bowlOpacity = 0;
  private lastRiceArm = 0;
  private lastCheekPuff = 0;
  private previousTyping = false;
  private previousBounce = false;
  private previousEating = false;
  private previousSuppressed = false;
  private activeExpression = '';
  private expressionRequest = 0;
  private availableExpressions = new Set<string>();
  private availableMotions = new Map<string, number>();
  private smooth = { gazeX: 0, gazeY: 0, typing: 0, audio: 0, bounce: 0 };
  private readonly applyParameters = () => this.driveParameters();

  constructor(private readonly options: Live2DRendererOptions) {
    this.width = options.canvas.clientWidth || 360;
    this.height = options.canvas.clientHeight || 480;
  }

  get status(): Live2DStatus { return this.currentStatus; }

  async load(request: Live2DLoadRequest): Promise<Live2DStatus> {
    if (this.disposed) return this.publish({ state: 'error', message: 'Live2D 渲染器已销毁' });
    const generation = ++this.generation;
    this.cleanupModel();
    if (!request?.modelUrl) return this.publish({ state: 'missing-model', message: '待导入已绑定的 Live2D 模型；参考图片不含可驱动骨骼' });
    if (request.coreAvailable === false) return this.publish({ state: 'missing-runtime', message: '缺少本地 Cubism Core；请先确认使用许可并提供运行时' });
    this.publish({ state: 'loading', message: '正在加载本地 Live2D 模型…' });
    let phase: 'runtime' | 'model' = 'model';
    try {
      this.manifest = validateRigManifest(request.manifest);
      const modelUrl = new URL(request.modelUrl);
      // Validate the endpoint before any fetch. FileReferences are validated after reading JSON.
      if (modelUrl.protocol !== 'app-model:' || modelUrl.hostname !== 'bundle' || modelUrl.username || modelUrl.password || modelUrl.port || modelUrl.search || modelUrl.hash || !modelUrl.pathname.endsWith('.model3.json')) throw new Error('模型地址必须是本地 app-model://bundle/ 下的 .model3.json');
      phase = 'runtime';
      await loadCore(request.coreUrl ?? CORE_URL);
      if (generation !== this.generation) return this.status;
      phase = 'model';
      this.abort = new AbortController();
      const response = await fetch(modelUrl.href, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`本地模型描述读取失败 (${response.status})`);
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('模型描述过大');
      const settings = validateModelSettings(JSON.parse(text), modelUrl.href);
      const [PIXI, live2d, noEval] = await Promise.all([import('pixi.js'), import('pixi-live2d-display/cubism4'), import('@pixi/unsafe-eval')]);
      if (generation !== this.generation) return this.status;
      // Motion sounds are deliberately disabled. Only amplitude input is supported.
      live2d.config.sound = false;
      // Official static shader/uniform implementation: does NOT relax CSP.
      noEval.install({ ShaderSystem: PIXI.ShaderSystem });
      if (!this.app) {
        this.app = new PIXI.Application({
          view: this.options.canvas, width: this.width, height: this.height,
          backgroundAlpha: 0, antialias: true, autoStart: false, sharedTicker: false,
          resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
        });
        this.app.stop();
      }
      const configuredIdle = this.manifest.motions?.idle?.group;
      const model = await new Promise<Model>((resolve, reject) => {
        let settled = false;
        let cancelled = false;
        let loading: Model;
        const disposeCompleted = () => {
          if (loading.destroyed) return;
          // Upstream 0.4 destroy() dereferences internalModel even before it exists.
          // Only dispose from factory completion/error, never in the middle of its pipeline.
          if (loading.internalModel) loading.destroy({ children: true, texture: true, baseTexture: true });
          else {
            loading.emit('destroy');
            PIXI.Container.prototype.destroy.call(loading, { children: true });
          }
        };
        const settle = (error?: unknown) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          if (this.cancelPending === cancel) this.cancelPending = undefined;
          if (error) reject(error); else resolve(loading);
        };
        const cancel = () => {
          cancelled = true;
          // The factory's own listeners abort model/optional XHRs without assuming
          // initialization is complete. Its eventual callback owns final disposal.
          loading.emit('destroy');
          loading.internalModel?.emit('destroy');
          settle(new DOMException('模型加载已取消', 'AbortError'));
        };
        const complete = (error?: unknown) => {
          if (cancelled || error || generation !== this.generation) disposeCompleted();
          settle(error);
        };
        const timeout = window.setTimeout(() => {
          cancelled = true;
          loading.emit('destroy');
          loading.internalModel?.emit('destroy');
          settle(new Error('Live2D 模型资源加载超时'));
        }, 30_000);
        loading = live2d.Live2DModel.fromSync({ ...settings, url: modelUrl.href }, {
          autoUpdate: false, autoInteract: false, motionPreload: live2d.MotionPreloadStrategy.NONE,
          idleMotionGroup: configuredIdle ?? '__whale_no_automatic_idle__',
          onLoad: () => complete(), onError: error => complete(error),
        }) as unknown as Model;
        this.pendingModel = loading;
        this.cancelPending = cancel;
      });
      if (generation !== this.generation || this.disposed) {
        if (!model.destroyed) model.destroy({ children: true, texture: true, baseTexture: true });
        return this.status;
      }
      this.pendingModel = undefined;
      this.model = model;
      this.collectCapabilities(settings);
      model.anchor.set(0.5, 1);
      model.internalModel.on('beforeModelUpdate', this.applyParameters);
      this.app.stage.addChild(model);
      this.resize(this.width, this.height);
      model.update(16);
      this.app.render(); // Ready means actual initialization/render succeeded, not merely a JPEG shown.
      return this.publish({ state: 'ready', message: this.capabilities?.eating.supported ? 'Live2D 已就绪 · 检测到吃饭参数' : 'Live2D 已就绪 · 此模型未完整绑定吃饭动作', capabilities: this.capabilities });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return this.status;
      this.cleanupModel();
      return this.publish({ state: phase === 'runtime' ? 'missing-runtime' : 'error', message: error instanceof Error ? error.message : 'Live2D 模型加载失败' });
    }
  }

  update(frame: Live2DFrame): void {
    if (!this.model || !this.app || this.disposed) return;
    this.frame = frame;
    const dt = clamp(frame.deltaSeconds, 0, 0.1);
    const blend = 1 - Math.exp(-dt * 11);
    for (const [key, target] of Object.entries({ gazeX: clamp(frame.gaze?.x, -1, 1), gazeY: clamp(frame.gaze?.y, -1, 1), typing: clamp(frame.typing), audio: clamp(frame.audioLevel), bounce: clamp(frame.bounce) })) {
      const role = key as keyof typeof this.smooth;
      this.smooth[role] += (target - this.smooth[role]) * blend;
    }
    try {
      this.triggerAnimations();
      this.model.update(dt * 1000);
      this.app.render();
    } catch (error) {
      this.cleanupModel();
      this.publish({ state: 'error', message: error instanceof Error ? error.message : 'Live2D 绘制失败' });
    }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, clamp(width, 1, 8192));
    this.height = Math.max(1, clamp(height, 1, 8192));
    this.app?.renderer.resize(this.width, this.height);
    const model = this.model;
    if (!model) return;
    const w = model.internalModel.width;
    const h = model.internalModel.height;
    if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) throw new Error('模型画布尺寸无效');
    const scale = Math.min(this.width * 0.92 / w, this.height * 0.94 / h);
    model.scale.set(scale);
    model.position.set(this.width / 2, this.height * 0.98);
  }

  destroy(): void {
    ++this.generation;
    this.disposed = true;
    this.cleanupModel();
    this.app?.destroy(false, { children: true, texture: true, baseTexture: true });
    this.app = undefined;
  }

  private publish(status: Live2DStatus): Live2DStatus {
    this.currentStatus = status;
    this.options.onStatus?.(status);
    return status;
  }

  private cleanupModel(): void {
    this.resetAuthoredExpression();
    this.abort?.abort();
    this.abort = undefined;
    this.cancelPending?.();
    this.cancelPending = undefined;
    if (this.model) {
      this.model.internalModel.off('beforeModelUpdate', this.applyParameters);
      this.app?.stage.removeChild(this.model);
      if (!this.model.destroyed) this.model.destroy({ children: true, texture: true, baseTexture: true });
    }
    // Pending factory callbacks retain disposal ownership after cancellation.
    this.model = undefined;
    this.pendingModel = undefined;
    this.parameters.clear();
    this.capabilities = undefined;
    this.previousMood = this.activeExpression = '';
    this.bowlOpacity = this.lastRiceArm = this.lastCheekPuff = 0;
    this.previousBounce = this.previousTyping = this.previousEating = this.previousSuppressed = false;
    this.smooth = { gazeX: 0, gazeY: 0, typing: 0, audio: 0, bounce: 0 };
    try { this.app?.render(); } catch { /* A lost WebGL context must not prevent cleanup. */ }
  }

  private collectCapabilities(settings: ModelSettings): void {
    const raw = this.model!.internalModel.coreModel.getModel().parameters;
    if (!raw || !Array.isArray(raw.ids)) throw new Error('无法读取模型真实参数列表');
    this.parameters.clear();
    const ids = new Set(raw.ids);
    const roles = { ...DEFAULT_PARAMETERS, ...this.manifest.parameters };
    for (const role of Object.keys(roles) as ParameterRole[]) {
      const id = roles[role];
      const index = raw.ids.indexOf(id);
      if (index < 0) continue; // Never call getParameterIndex: Cubism creates synthetic absent IDs.
      const min = raw.minimumValues[index];
      const max = raw.maximumValues[index];
      const initial = raw.defaultValues[index];
      if (![min, max, initial].every(Number.isFinite) || max <= min) continue;
      this.parameters.set(role, { id, min, max, initial });
    }
    const collisions: string[] = [];
    const parameterRoles = new Map<string, ParameterRole[]>();
    for (const [role, parameter] of this.parameters) parameterRoles.set(parameter.id, [...(parameterRoles.get(parameter.id) ?? []), role]);
    for (const [id, assigned] of parameterRoles) if (assigned.length > 1) {
      collisions.push(`参数 ${id} 同时映射到 ${assigned.join(', ')}，已禁用冲突驱动`);
      assigned.forEach(role => this.parameters.delete(role));
    }
    const feature = (required: ParameterRole[], force = false): CapabilityDetail => ({
      supported: required.every(role => this.parameters.has(role) && (force || this.owner(role) === 'adapter')) && new Set(required.map(role => roles[role])).size === required.length,
      present: required.filter(role => this.parameters.has(role)).map(role => roles[role]),
      missing: required.filter(role => !this.parameters.has(role)).map(role => roles[role]),
      externallyOwned: force ? [] : required.filter(role => this.parameters.has(role) && this.owner(role) !== 'adapter').map(role => roles[role]),
    });
    this.availableExpressions = new Set(settings.FileReferences.Expressions?.map(expression => expression.Name) ?? []);
    this.availableMotions = new Map(Object.entries(settings.FileReferences.Motions ?? {}).map(([group, motions]) => [group, motions.length]));
    const warnings: string[] = [...collisions];
    for (const [mood, name] of Object.entries(this.manifest.expressions ?? {})) if (!this.availableExpressions.has(name)) warnings.push(`表情映射 ${mood} 缺少 ${name}`);
    for (const [key, binding] of Object.entries(this.manifest.motions ?? {})) if (!this.motionExists(binding)) warnings.push(`动作映射 ${key} 不存在：${binding.group}`);
    this.capabilities = {
      parameters: [...ids], gaze: feature(['eyeX', 'eyeY']), breathing: feature(['breath']),
      blink: feature(['eyeLOpen', 'eyeROpen']), sleepEyes: feature(['eyeLOpen', 'eyeROpen'], true),
      parameterOwnership: Object.fromEntries((Object.keys(roles) as ParameterRole[]).map(role => [role, this.owner(role)])),
      typing: feature(['typing']), bounce: feature(['bounce']), audio: feature(['mouthOpen']),
      eating: feature(['riceBowl', 'riceArm', 'cheekPuff', 'mouthOpen']),
      expressions: [...this.availableExpressions], motions: [...this.availableMotions.keys()], warnings,
    };
  }

  private motionExists(binding: MotionBinding): boolean {
    const count = this.availableMotions.get(binding.group) ?? 0;
    return count > 0 && (binding.index === undefined || binding.index < count);
  }

  private triggerAnimations(): void {
    const model = this.model!;
    const mood = this.frame.sleeping ? 'sleeping' : this.frame.mood ?? 'happy';
    if (mood !== this.previousMood) {
      const expression = this.manifest.expressions?.[mood];
      if (expression && this.availableExpressions.has(expression)) this.requestAuthoredExpression(expression);
      else this.resetAuthoredExpression();
      if (!this.frame.sleeping && !this.frame.reducedMotion) this.playMotion(`mood:${mood}`);
      this.previousMood = mood;
    }
    const suppressed = this.frame.sleeping === true || this.frame.reducedMotion === true;
    if (suppressed !== this.previousSuppressed) {
      model.internalModel.motionManager.groups.idle = suppressed ? '__whale_no_automatic_idle__' : this.manifest.motions?.idle?.group ?? '__whale_no_automatic_idle__';
      this.previousSuppressed = suppressed;
    }
    if (suppressed) {
      // A pending upstream IDLE request can start after the reservation reset.
      // Stop on every suppressed frame before model.update, not only on entry.
      model.internalModel.motionManager.stopAllMotions();
      this.previousTyping = this.previousBounce = this.previousEating = false;
      return;
    }
    const typing = clamp(this.frame.typing) > 0.25;
    const bounce = clamp(this.frame.bounce) > 0.2;
    const eating = clamp(this.frame.eating) > 0;
    if (typing && !this.previousTyping) this.playMotion('typing');
    if (bounce && !this.previousBounce) this.playMotion('bounce');
    if (eating && !this.previousEating && this.capabilities?.eating.supported) this.playMotion('eat');
    this.previousTyping = typing;
    this.previousBounce = bounce;
    this.previousEating = eating;
  }

  private resetAuthoredExpression(): void {
    ++this.expressionRequest;
    this.activeExpression = '';
    const manager = this.model?.internalModel.motionManager.expressionManager;
    if (!manager) return;
    // pixi-live2d-display 0.4 resetExpression does not invalidate a pending load
    // and leaves currentExpression unchanged. Reset both explicitly.
    manager.reserveExpressionIndex = -1;
    manager.stopAllExpressions?.();
    manager.resetExpression();
    manager.currentExpression = manager.defaultExpression;
  }

  private requestAuthoredExpression(expression: string): void {
    const model = this.model!;
    const manager = model.internalModel.motionManager.expressionManager;
    const index = manager?.getExpressionIndex?.(expression) ?? -1;
    const alreadyCurrent = index >= 0 && manager?.expressions?.[index] != null && manager.expressions[index] === manager.currentExpression;
    // Keep a legitimately current expression: setExpression may return false
    // for this success-equivalent case. All other changes cancel reservations.
    if (!alreadyCurrent) this.resetAuthoredExpression();
    const request = ++this.expressionRequest;
    const current = () => request === this.expressionRequest && model === this.model && !this.disposed;
    const fail = () => {
      if (!current()) return;
      this.resetAuthoredExpression();
      const warning = `表情 ${expression} 加载失败，已恢复程序表情驱动；切换心情或重载模型可重试`;
      if (this.capabilities && !this.capabilities.warnings.includes(warning)) this.capabilities.warnings.push(warning);
      if (this.currentStatus.state === 'ready') this.publish({ ...this.currentStatus, capabilities: this.capabilities });
    };
    try {
      void model.expression(expression).then(applied => {
        if (!current()) return;
        const indexNow = manager?.getExpressionIndex?.(expression) ?? -1;
        const matchesCurrent = indexNow >= 0 && manager?.expressions?.[indexNow] != null && manager.expressions[indexNow] === manager.currentExpression;
        if (applied || matchesCurrent) this.activeExpression = expression;
        else fail();
      }, fail);
    } catch { fail(); }
  }

  private playMotion(key: string): void {
    const binding = this.manifest.motions?.[key];
    if (binding && this.motionExists(binding)) void this.model?.motion(binding.group, binding.index, 2).catch(() => undefined);
  }

  private owner(role: ParameterRole): ParameterOwner {
    return this.manifest.parameterOwnership?.[role] ?? (role === 'mouthForm' ? 'expression' : 'adapter');
  }
  private canDrive(role: ParameterRole): boolean {
    const owner = this.owner(role);
    return owner === 'adapter' || (owner === 'expression' && !this.activeExpression);
  }
  private setSigned(role: ParameterRole, normalized: number): void {
    const parameter = this.parameters.get(role);
    if (!parameter || !this.canDrive(role)) return;
    const value = clamp(normalized, -1, 1);
    this.model!.internalModel.coreModel.setParameterValueById(parameter.id, parameter.initial + value * (value >= 0 ? parameter.max - parameter.initial : parameter.initial - parameter.min));
  }
  private setUnit(role: ParameterRole, normalized: number, force = false): void {
    const parameter = this.parameters.get(role);
    if (parameter && (force || this.canDrive(role))) this.model!.internalModel.coreModel.setParameterValueById(parameter.id, parameter.min + clamp(normalized) * (parameter.max - parameter.min));
  }

  private driveParameters(): void {
    const t = clamp(this.frame.timeSeconds, 0, Number.MAX_SAFE_INTEGER);
    const s = this.smooth;
    const mood = this.frame.sleeping ? 'sleepy' : this.frame.mood ?? 'happy';
    const sleepy = mood === 'sleepy' || this.frame.sleeping === true;
    const reduced = this.frame.reducedMotion === true;
    const sleeping = this.frame.sleeping === true;
    const shy = mood === 'shy';
    const aggrieved = mood === 'aggrieved';
    const unimpressed = mood === 'unimpressed';
    const suppressed = reduced || sleeping;
    const activity = suppressed ? 0 : sleepy ? 0.35 : unimpressed ? 0.6 : 1;
    const breath = reduced ? 0.5 : (Math.sin(t * (sleepy ? 1.1 : 1.8)) + 1) * 0.5;
    const typingWiggle = suppressed ? 0 : Math.sin(t * 16) * s.typing;
    const bounce = suppressed ? 0 : s.bounce;
    const audio = suppressed ? 0 : s.audio;
    const gazeX = sleeping ? 0 : s.gazeX;
    const gazeY = sleeping ? 0 : s.gazeY;
    this.setUnit('breath', breath);
    this.setSigned('eyeX', gazeX);
    this.setSigned('eyeY', gazeY);
    this.setSigned('angleX', gazeX * 0.62 + Math.sin(t * 0.9) * 0.07 * activity);
    this.setSigned('angleY', gazeY * 0.52 + (breath - 0.5) * 0.08 + bounce * 0.2 + typingWiggle * 0.06);
    this.setSigned('angleZ', Math.sin(t * 0.7) * 0.045 * activity + typingWiggle * 0.045 + (shy ? 0.12 : aggrieved ? -0.09 : 0));
    this.setSigned('bodyX', Math.sin(t * 0.8) * 0.07 * activity + audio * Math.sin(t * 8) * 0.09);
    this.setSigned('bodyY', bounce * 0.32 + typingWiggle * 0.05);
    this.setUnit('typing', suppressed ? 0 : s.typing * (0.5 + 0.5 * Math.sin(t * 16)));
    this.setUnit('bounce', bounce);
    const blinkPhase = t % 4.8;
    const blink = blinkPhase < 0.16 ? Math.abs(blinkPhase - 0.08) / 0.08 : 1;
    // An exp3 never disables blinking globally. Ownership is resolved per role.
    const restingEye = this.manifest.moodEyeOpen?.[mood] ?? (sleepy ? 0.42 : 1);
    this.setUnit('eyeLOpen', sleeping ? 0 : blink * restingEye, sleeping);
    this.setUnit('eyeROpen', sleeping ? 0 : blink * restingEye, sleeping);
    this.setSigned('mouthForm', this.frame.innocent ? 0.45 : sleepy ? -0.1 : aggrieved ? -0.4 : unimpressed ? -0.25 : shy ? 0.18 : 0.4);
    const eating = clamp(this.frame.eating) > 0 && !this.frame.hidingBowl && !suppressed && this.capabilities?.eating.supported === true;
    const chew = eating ? (Math.sin(t * 9) + 1) * 0.5 : 0;
    this.setUnit('mouthOpen', Math.max(audio * 0.9, chew * 0.55));
    // Finite concealment transition; never keep feeding while hiding the bowl.
    // Sleep/reduced-motion and absent capability reset immediately by design.
    const dt = clamp(this.frame.deltaSeconds, 0, 0.1);
    if (suppressed || !this.capabilities?.eating.supported) this.bowlOpacity = 0;
    else this.bowlOpacity = eating ? Math.min(1, this.bowlOpacity + dt / 0.16) : Math.max(0, this.bowlOpacity - dt / 0.22);
    if (eating) {
      this.lastRiceArm = (Math.sin(t * 3.6) + 1) * 0.5;
      this.lastCheekPuff = 0.25 + chew * 0.65;
    }
    this.setUnit('riceBowl', this.bowlOpacity);
    this.setUnit('riceArm', this.lastRiceArm * this.bowlOpacity);
    this.setUnit('cheekPuff', this.lastCheekPuff * this.bowlOpacity);

  }
}
