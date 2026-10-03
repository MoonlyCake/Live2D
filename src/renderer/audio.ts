/** Local amplitude analysis only. No recorder, network transport, or playback sink. */
export type AudioSource = { kind: 'microphone'; deviceId?: string } | { kind: 'system' };
export interface AudioState {
  state: 'off' | 'requesting' | 'active' | 'error';
  source?: AudioSource['kind'];
  message: string;
}
export interface AudioInput { deviceId: string; label: string }
export interface AudioControllerOptions {
  onState?: (state: AudioState) => void;
  onLevel?: (level: number) => void;
}
interface CaptureSession {
  stream: MediaStream;
  context?: AudioContext;
  source?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  timer?: number;
  ended: () => void;
}

export function audioErrorMessage(error: unknown, source: AudioSource['kind']): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError':
      return source === 'system'
        ? '系统声音共享被取消或未获授权。请在系统隐私设置中允许屏幕／音频共享后重试。'
        : '麦克风未获授权。请在系统隐私设置中允许麦克风，或保持音频关闭。';
    case 'NotFoundError': case 'DevicesNotFoundError':
      return source === 'system' ? '没有可共享的声音来源。请选择支持音频的屏幕或窗口。' : '没有找到所选输入设备，请重新选择设备。';
    case 'NotReadableError': case 'TrackStartError':
      return '无法读取所选声音来源，可能正被占用或被系统阻止。';
    case 'OverconstrainedError':
      return '所选输入设备已不可用，请重新选择。';
    case 'InvalidStateError':
      return '请直接点击开启按钮选择音频来源，并保持应用窗口处于前台。';
    case 'NotSupportedError': case 'TypeError':
      return source === 'system' ? '当前系统或 Electron 环境不支持此方式的系统声音共享。可以手动选择输入设备；不会自动改用麦克风。' : '当前环境不支持所选输入方式。';
    default:
      return error instanceof Error ? error.message : '音频来源启动失败，请重新选择。';
  }
}

export class AudioController {
  private generation = 0;
  private session?: CaptureSession;
  private disposed = false;
  private currentState: AudioState = { state: 'off', message: '音频已关闭' };
  private level = 0;

  constructor(private readonly options: AudioControllerOptions = {}) {}

  get state(): AudioState { return { ...this.currentState }; }

  /** Call only from an explicit user's Enable/Change-source click, never at startup. */
  async start(selection: AudioSource): Promise<AudioState> {
    if (this.disposed) return this.publish({ state: 'error', message: '音频控制器已关闭' });
    const generation = ++this.generation;
    this.release(); // Tracks stop synchronously, before any new permission prompt.
    this.level = 0;
    this.options.onLevel?.(0);
    if (selection?.kind !== 'microphone' && selection?.kind !== 'system') {
      return this.publish({ state: 'error', message: '请明确选择输入设备或系统声音' });
    }
    this.publish({ state: 'requesting', source: selection.kind, message: '等待你授权所选音频来源…' });
    let acquired: MediaStream | undefined;
    let candidate: CaptureSession | undefined;
    try {
      const media = navigator.mediaDevices;
      if (!media) throw new DOMException('此环境无法访问音频设备', 'NotSupportedError');
      // Do not await cleanup here: display capture must retain the click's transient activation.
      let request: Promise<MediaStream>;
      if (selection.kind === 'system') {
        if (typeof media.getDisplayMedia !== 'function') throw new DOMException('系统声音共享不可用', 'NotSupportedError');
        const constraints: DisplayMediaStreamOptions & { systemAudio: 'include' } = {
          video: true, audio: true, systemAudio: 'include',
        };
        request = media.getDisplayMedia(constraints);
      } else {
        if (typeof media.getUserMedia !== 'function') throw new DOMException('输入设备不可用', 'NotSupportedError');
        request = media.getUserMedia({
          video: false,
          audio: {
            ...(selection.deviceId ? { deviceId: { exact: selection.deviceId } } : {}),
            echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          },
        });
      }
      acquired = await request;
      if (generation !== this.generation || this.disposed) {
        acquired.getTracks().forEach(track => track.stop());
        return this.state;
      }
      if (!acquired.getAudioTracks().some(track => track.readyState === 'live')) {
        throw new Error(selection.kind === 'system'
          ? '所选共享来源没有音轨。请在共享窗口勾选音频，或选择支持音频的来源；不会改用麦克风。'
          : '所选输入设备没有提供有效音轨。');
      }
      candidate = {
        stream: acquired,
        ended: () => {
          if (generation !== this.generation) return;
          ++this.generation;
          this.release();
          this.level = 0;
          this.options.onLevel?.(0);
          this.publish({ state: 'off', message: '音频来源已停止共享' });
        },
      };
      this.session = candidate;
      for (const track of acquired.getTracks()) track.addEventListener('ended', candidate.ended);
      const context = new AudioContext();
      candidate.context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      const source = context.createMediaStreamSource(acquired);
      source.connect(analyser); // Deliberately no connection to audioContext.destination.
      candidate.source = source;
      candidate.analyser = analyser;
      await context.resume();
      if (generation !== this.generation || this.disposed) return this.state;
      if (context.state !== 'running') throw new Error('音频分析被系统暂停，请点击开启按钮重试。');
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (generation !== this.generation || this.session !== candidate) return;
        try {
          analyser.getFloatTimeDomainData(samples);
          let power = 0;
          for (const sample of samples) power += sample * sample;
          const rms = Math.sqrt(power / samples.length);
          // Noise floor + soft response; never retains the waveform between frames.
          const target = Math.min(1, Math.max(0, (rms - 0.008) * 6));
          this.level += (target - this.level) * (target > this.level ? 0.45 : 0.12);
          this.options.onLevel?.(this.level);
          candidate!.timer = window.setTimeout(tick, 50);
        } catch (error) {
          ++this.generation;
          this.release();
          this.level = 0;
          this.options.onLevel?.(0);
          this.publish({ state: 'error', source: selection.kind, message: audioErrorMessage(error, selection.kind) });
        }
      };
      candidate.timer = window.setTimeout(tick, 50);
      return this.publish({ state: 'active', source: selection.kind, message: selection.kind === 'system' ? '系统声音律动中 · 仅本机音量分析' : '输入设备律动中 · 仅本机音量分析' });
    } catch (error) {
      if (acquired) acquired.getTracks().forEach(track => track.stop());
      if (generation !== this.generation || this.disposed) return this.state;
      this.release();
      this.options.onLevel?.(0);
      return this.publish({ state: 'error', source: selection.kind, message: audioErrorMessage(error, selection.kind) });
    }
  }

  /** Does not request permission. Labels can be blank until an explicit microphone grant. */
  async listInputs(): Promise<AudioInput[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput').map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `输入设备 ${index + 1}（授权后显示名称）`,
    }));
  }

  async stop(): Promise<void> {
    ++this.generation; // Cancels late getUserMedia/getDisplayMedia responses, too.
    const closed = this.release();
    this.level = 0;
    this.options.onLevel?.(0);
    this.publish({ state: 'off', message: '音频已关闭' });
    await closed;
  }

  async destroy(): Promise<void> {
    this.disposed = true;
    await this.stop();
  }

  private publish(state: AudioState): AudioState {
    this.currentState = state;
    this.options.onState?.({ ...state });
    return { ...state };
  }

  private release(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (!session) return Promise.resolve();
    if (session.timer !== undefined) window.clearTimeout(session.timer);
    for (const track of session.stream.getTracks()) {
      track.removeEventListener('ended', session.ended);
      track.stop();
    }
    session.source?.disconnect();
    session.analyser?.disconnect();
    if (session.context && session.context.state !== 'closed') return session.context.close().catch(() => undefined);
    return Promise.resolve();
  }
}
