# Whale Girl：Inochi2D 作者工程

`WhaleGirl.inx` 是经官方 Inochi Creator 0.8.6 打开并保存的可编辑工程；`WhaleGirl.inp` 是同一工程经 File → Export → Inochi2D Puppet 导出的模型。2026-10-03 导出，2048×2048 单图集，42 个网格部件、44 个参数。格式为 Inochi2D 0.8，并非 Cubism / MOC3。

## 原始素材与制作

- `build_core.py`：23 个核心分层，真实网格、眼皮遮挡、嘴型、有限头身/手臂形变。
- `build_full.py`：增加米饭、持碗/勺手、饭粒、脸红、泪光、五情绪，共35张源贴图、36个部件。
- `opaque_rice.py`：持碗手不做透明淡出；离开进食前先不透明收勺，再互斥切回普通双手。
- `pack_textures.py`：无损裁去透明留白并换算UV，不缩放原始像素。
- 固定来源：`art/production-v3-core-ready`、`production-v3-extras-ready`、`production-v3-eyesocket-fix-ready`。后者替换两个眼眶遮挡层，补齐意外透明裂缝。
- `*-DRAFT.inx` 是生成器的中间输出，不随本版源码/二进制交付。生成器输出必须经 Creator 检查/导出，不能改扩展名充当原生导出。

## 已检查的原生状态

完整形象中性通过；闭眼、张嘴和低幅头身动作在核心工程检查。完整35贴图模型的 EyeOpen=0.25/0.5/0.75 在 Creator 逐一检查：虹膜保持圆形，眼皮遮挡生效，原先的眼睫外蓝弧已消失。情绪不直接叠加眼皮形变，由应用合成唯一 EyeOpen 驱动。桌宠应用已完成实际渲染与参数回归；完整进食和中断证据见 `../docs/inochi/native-full/`，可复现的80状态互斥双手检查为 `node --import tsx scripts/qa-inochi-interrupt.mts`（项目根目录运行）。

原生 View → Save Screenshot 导出的PNG存在半透明边缘颜色异常，因此不作为最终展示图。展示与连续动画验收使用应用实际输出。

## 设计边界

本模型适合小幅正面桌宠运动。眉毛仍与部分前发/头饰组合；没有独立尾鳍、大角度转身、背面或腿部步行。进食手与碗为合并美术，归碗后互斥换手仍是离散姿态切换。没有伪装成支持这些能力。

当前应用使用自有有限 Inochi2D 0.8 网格解释器，支持本工程使用的普通透明图层、二维变换、一维线性形变与透明度；并不宣称官方SDK或通用Inochi模型兼容。INX保留后续原生编辑能力。

## 逐键与鼠标扩展
`typing-v2/build_typing.py` 从固定旧基底追加6个工作手/袖桥部件，`typing-v2/rig-contract.json`提供指尖、鼠标reference和袖桥固定/移动锚点。应用每帧按目标坐标计算袖桥角度/长度，手保持刚性；83键和9鼠标位置经真实网格几何检查。新原生导出替换本目录canonical INP/INX；不能对已经扩展的模型再次追加同一组部件。
