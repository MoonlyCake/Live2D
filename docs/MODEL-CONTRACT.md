# 可选 Live2D 开发适配器 / Model contract

## 当前交付范围与许可边界

普通版使用应用自有的 2D 角色绘制器。`src/renderer/live2d.ts` 是独立的、可选的开发适配器，不能把普通版动画或 JPEG 预览称作 Live2D。所提供的 5 张 JPEG 是角色参考图，不包含 Cubism 模型、网格、参数、纹理分层、物理或动作数据。

仓库不包含、不下载、不从 CDN 载入 Cubism Core，也不包含已绑定的 `.moc3` 模型。用户/开发者需要自行拥有所选角色素材、模型与 Cubism Core 的相应使用权。导入陌生 JavaScript 运行时等同于执行代码，请只选择经确认的官方 Core 文件。

**不要将支持任意用户模型导入的 Live2D 开发版直接作为已获许可的产品发布。** Live2D 的可扩展应用规则特别涵盖用户自定义模型上传等用途，并要求发行前审查与特别出版许可；普通个人/小企业豁免并不自动适用。此说明不是法律意见，发行者应向 Live2D 确认具体方案。

官方说明：
- [SDK 发行许可](https://www.live2d.com/zh-CHS/sdk/license/)
- [可扩展性应用程序](https://www.live2d.com/zh-CHS/sdk/license/expandable/)
- [SDK / Cubism Core 文档](https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/)

## 模型作者需提供

一个完整本地文件夹，典型结构：

```text
Whale/
  Whale.model3.json
  Whale.moc3
  textures/texture_00.png
  Whale.physics3.json           # 可选
  expressions/happy.exp3.json
  motions/idle.motion3.json
  whale.manifest.json           # 可选，以下规范
```

必须使用与所提供运行时兼容的 Cubism 4 导出结果。本适配器使用 `pixi.js 6.5.10` 和 `pixi-live2d-display 0.4.0/cubism4`；未验证 Cubism 5 新特性。纹理与所有资源应为本地相对路径。禁止 HTTP(S)、`file:`、`data:`、协议相对地址、路径穿越、查询字符串或碎片。主进程仍需做真实路径、扩展名、大小和符号链接边界校验；渲染器校验不能代替主进程隔离。

模型入口固定映射到 `app-model://bundle/<文件名>.model3.json`。Core 唯一地址为 `app-core://runtime/live2dcubismcore.min.js`，主进程只允许读取用户明确选定的单个 Core 文件。Core 是有权使用的本地文件，不是自动下载依赖。主进程 Content Security Policy 应允许上述本地资源，并禁止模型访问互联网。

## 绑定参数与能力检测

适配器枚举 Core 实际参数 ID 和数值范围。不会通过 `getParameterIndex` 探测不存在的参数，因为 Cubism 可能为缺失 ID 创建虚拟索引。缺失、常量范围或不合法范围的参数不驱动。

默认语义映射：

| 功能 | 参数 |
|---|---|
| 头部和身体 | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`, `ParamBodyAngleX`, `ParamBodyAngleY` |
| 跟随视线 | `ParamEyeBallX`, `ParamEyeBallY` |
| 呼吸 | `ParamBreath` |
| 眨眼 / 困倦 | `ParamEyeLOpen`, `ParamEyeROpen` |
| 口型 / 表情 | `ParamMouthOpenY`, `ParamMouthForm` |
| 专用打字动作 | `ParamTyping` |
| 专用弹跳形变 | `ParamBounce` |
| 吃饭动作 | `ParamRiceBowlOpacity`, `ParamRiceArm`, `ParamCheekPuff`, `ParamMouthOpenY` |

`typing` / `bounce` 能力标记专指专用参数。即使缺少专用参数，已有头部/身体参数仍可能产生轻微反馈，但 UI 不能据此称模型具备专用手部打字/弹跳绑定。

**吃饭必须由模型作者绘制并绑定碗、持碗/舀饭手臂、鼓腮与口型。** 四个实际且互不相同的参数都存在时，才报告 `eating.supported = true`。若不完整，适配器不会触发吃饭动作，不会在模型外画假碗来冒充 Live2D。导入成功仍不证明模型美术绑定正确，需要作者目视验收。

角度参数按导出默认值左右归一化；正值朝最大值，负值朝最小值。单位参数按导出最小/最大值映射 0–1。因此碗透明度必须把最小值绑定成隐藏、最大值绑定成显示；眼睛开合必须把最小值绑定闭眼；口型最小值应闭合。

## 可选 whale.manifest.json

```json
{
  "version": 1,
  "parameters": {
    "riceBowl": "ParamRiceBowlOpacity",
    "riceArm": "ParamRiceArm",
    "cheekPuff": "ParamCheekPuff",
    "typing": "ParamTyping",
    "bounce": "ParamBounce"
  },
  "expressions": {
    "happy": "Happy",
    "shy": "Shy",
    "aggrieved": "Aggrieved",
    "sleepy": "Sleepy",
    "unimpressed": "Unimpressed"
  },
  "motions": {
    "idle": { "group": "Idle" },
    "typing": { "group": "Typing", "index": 0 },
    "bounce": { "group": "Bounce", "index": 0 },
    "eat": { "group": "Eat", "index": 0 },
    "mood:shy": { "group": "Greeting", "index": 0 }
  }
}
```

表情名称必须等于 `.model3.json` 的 `FileReferences.Expressions[].Name`。动作组/index 对应 `FileReferences.Motions`，index 是从零开始的数组序号；不填 index 时由模型库选择组内动作。`idle` 指定自动待机组；不指定时禁用库的默认自动待机，仅使用轻微程序化呼吸。为一致性，idle 不指定 index。缺失映射会在 `capabilities.warnings` 中报告。所有模型动作声音均禁用。

可映射的 parameters 键为：`angleX`, `angleY`, `angleZ`, `bodyX`, `bodyY`, `breath`, `eyeX`, `eyeY`, `eyeLOpen`, `eyeROpen`, `mouthOpen`, `mouthForm`, `typing`, `bounce`, `riceBowl`, `riceArm`, `cheekPuff`。

当一个有效的作者表情被选中时，适配器保留其眼睛开合与嘴角参数，不用程序化表情覆盖它；音量口型、头部视线、呼吸和进食仍单独驱动。作者需避免这些参数间的冲突。外部 motion 的这些控制参数可能被程序化控制覆盖。所有应用参数在 `beforeModelUpdate` 写入，避免在渲染后才写入而没有效果。

## 渲染器调用约定

```ts
const renderer = new Live2DRenderer({ canvas, onStatus });
await renderer.load({ modelUrl, coreAvailable, manifest });
renderer.resize(canvas.clientWidth, canvas.clientHeight);
renderer.update({
  timeSeconds: performance.now() / 1000,
  deltaSeconds: 1 / 30,
  gaze: { x: 0, y: 0 }, // -1..1，y 正向上
  typing: 0, audioLevel: 0, bounce: 0, // 0..1
  eating: 0, // 0 表示无进食，(0,1] 为进度
  mood: 'happy',
  sleeping: false, hidingBowl: false, innocent: false, reducedMotion: false
});
renderer.destroy();
```

`load` 可重复调用，旧模型、事件监听、纹理与加载请求会清理；迟到结果不会替换新模型。`destroy` 是最终关闭，不可再 load。适配器自己不创建动画帧循环，由 UI 调用 update，便于节流与暂停。

状态有：
- `missing-model`：没有选择编译模型；图片仅可作参考预览
- `missing-runtime`：缺失/未能加载有效本地 Core
- `loading`：正在读取模型
- `ready`：真实模型已完成初始化与首帧绘制；能力仍以 capabilities 为准
- `error`：无效模型、资源错误或渲染错误

Core 在页面内只加载一次；更换 Core 版本后应重启应用，不能安全地热替换全局运行时。模型重新导入无需重启。

Pixi 6 的 shader/uniform 代码使用官方 `@pixi/unsafe-eval@6.5.10` 的 `install({ShaderSystem})` 静态实现，不要求放宽 JavaScript CSP。该包的名字不代表开启 eval。某些 Core 构建使用 WebAssembly，可能需要开发版 CSP 单独允许 `wasm-unsafe-eval`；带有额外 `.wasm` 文件、Worker、外部请求或 JavaScript eval 的 Core 变体未获此适配器支持。不要为陌生脚本放宽 CSP。

## 音频与隐私约定

`AudioController` 默认关闭。只有用户主动点击开启/切换来源时才调用 `start({kind:'microphone',deviceId?})` 或 `start({kind:'system'})`。

- 设备 ID 使用精确匹配；指定设备失效时报告错误，不擅自选择其他设备
- `system` 调用 `getDisplayMedia`，必须由用户选择共享来源；系统声音不受当前操作系统支持或未勾选共享音频时，报告错误并停止全部共享轨道，绝不自动改用麦克风
- 浏览器/Electron 要求显示捕获包含视频轨道，所以可能显示屏幕共享提示。视频帧不读取、不显示、不录制、不上传；它仅随捕获会话存在，并在关闭时停止
- 使用不依赖可见窗口 rAF 的 50ms 定时器（宿主禁用后台节流），只用 `AnalyserNode` 计算瞬时 RMS，做降噪阈值和简单包络平滑；不连接到扬声器、不录音、不保存、不发往网络
- Off、来源切换、错误、用户停止共享与应用退出，都停止所有 tracks、取消 20Hz 音量计定时器、断开音频节点并调用 `AudioContext.close()`
- 在授权对话框仍开启时点 Off，之后迟到的流会立即被停止，不会重新开启采集
- `listInputs()` 只列设备，不请求授权。授权前标签可能不可用；用户明确允许麦克风后可再次列出名称
- macOS/Windows 的屏幕音频支持不同，需在目标操作系统实测，不能用模拟测试宣称系统采集已验证

调用接口：`new AudioController({onState,onLevel})`，`start(...)` 返回 `AudioState`；`stop()` 和 `destroy()` 返回 Promise。请在 beforeunload 调用 destroy，并让宿主窗口销毁终止所有会话。

## 验收要求

可在没有 Core/模型的情况下验证缺失状态、清理和模型资源校验，但不得把这些测试描述成 Live2D 视觉验收。完整验收需合法的、与上面参数匹配的真实鲸系模型，依次检查：跟随、呼吸、连续打字、弹跳、音频、五个情绪、进食、被发现藏碗、夜间、重载、关闭、设备切换和权限拒绝。部署的 Windows/macOS 还需各自实测系统音频与全局输入权限。

技术依据：
- [pixi-live2d-display 官方完整指南](https://github.com/guansss/pixi-live2d-display/wiki/Complete-Guide)
- [0.4.0 Cubism4 更新顺序](https://github.com/guansss/pixi-live2d-display/blob/v0.4.0/src/cubism4/Cubism4InternalModel.ts)
- [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [MDN AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode)

- [Pixi 官方无 eval 环境兼容层](https://api.pixijs.io/%40pixi/unsafe-eval.html)

## 独立 Live2D 工程：驱动权与睡眠/吃饭规则

这是新工程的契约扩展，不修改已冻结的普通 2D 发行包。

可在 version 1 清单中加入：

```json
{
  "version": 1,
  "parameterOwnership": {
    "eyeLOpen": "adapter",
    "eyeROpen": "adapter",
    "mouthForm": "expression",
    "riceBowl": "adapter",
    "riceArm": "adapter",
    "cheekPuff": "adapter",
    "mouthOpen": "adapter"
  },
  "moodEyeOpen": { "sleepy": 0.42, "unimpressed": 0.55 },
  "expressions": {
    "happy": "Happy", "shy": "Shy", "aggrieved": "Aggrieved",
    "sleepy": "Sleepy", "unimpressed": "Unimpressed", "sleeping": "Sleeping"
  }
}
```

- adapter：每帧在模型更新前由适配器最终写入。
- expression：exp3 活动期间交由表达式，否则使用程序默认反馈。mouthForm 默认此项。
- model：适配器不写入，交由模型/物理/动作自行负责。
- 其余已知语义角色默认 adapter。未知的附加参数如 ParamBrowMood、ParamBlush、ParamEyeSmile、ParamTear、头发物理参数均不会被适配器碰触。
- 真实睡眠是特殊安全优先级：如果实际眼皮参数存在且映射不冲突，即使其平时驱动权是 model/expression 也会强制闭合。Sleepy 只表示困倦，不能替代 Sleeping。没有 Sleeping exp3 时清除旧表达式后闭眼。
- 开眼程度来自 moodEyeOpen，再乘以眨眼曲线。exp3 活动不会全局禁用眨眼。若故意将眼皮设为 model/expression，能力报告会明确 blink.supported=false，作者需承担自行眨眼。
- 吃饭四参数必须都实际存在、互不冲突且由 adapter 拥有才报告支持。碗用 160 ms 渐入、220 ms 渐隐；藏碗当帧停止咀嚼，手臂/鼓腮跟随收回。睡眠和减少动态直接清零，不播放收回动画。
- 能力报告含 externallyOwned 列表、parameterOwnership、blink、sleepEyes。多个语义角色映射到同一真实参数会全部禁用相关冲突驱动并给出警告。

目前这份契约和单元测试不能替代实际 .moc3 模型的视觉验收。

### 异步加载和状态切换

表情请求有独立代次与模型身份校验。加载期间不宣称 exp3 已生效；实际加载失败则恢复 expression 所有权的程序默认驱动，并在能力警告中报告。库返回 false 时会区分“已经是当前表情”与真正失败。切换或清空表情会同时取消上游 reserveExpressionIndex、清除表情队列并重置 currentExpression，避免晚到 Happy 覆盖睡眠。进入睡眠/减少动态后，每帧模型更新前停止动作队列，以覆盖上游异步 Idle 在首次停止之后才加载完成的情况。

77 项自动化用例已通过（含延迟表情、失败/拒绝、晚到待机与重复切换）；这些只验证程序状态和驱动，不代表真实模型美术或系统权限已验收。
