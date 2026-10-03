# Whale Companion Inochi 0.2.2 — QA

## Current verification

- `npm run check`: typecheck,171 application tests and production build pass.
- `npm run qa:inochi`:31 parser/raster tests and80 meal-interruption states pass.
- Official Creator0.8.6 exported final INP/INX:42 mesh parts,44 genuinely bound parameters. The bundled INP is the exact accepted export, not a renamed image or Cubism model.
- Release gate evaluates all83 supported physical keys and9 mouse positions using actual transformed mesh vertices. Authored fingertip/reference points are located by barycentric interpolation and checked in absolute world coordinates, including4px key depression. Maximum observed error:0.000019 source pixels. A100px hand-offset mutation correctly fails.
- Tests include every allowed keydown/up, repeats, simultaneous keys, long holds,32-key bound, recent-pointer/keyboard hand arbitration, button/wheel state, native-pixel to desktop geometry integration, disposal and lock/suspend sequencing.
- Normal sandboxed Linux Electron launched final model and passed19 actual action/capability/error/PNG assertions.13 original mood/meal/sleep checks plus chord,release,mouse extrema/buttons,wheel and full reset. `docs/inochi/native-full/renderer-report.json` identifies synthetic states explicitly; these tests do not exercise macOS TCC.
- Baseline v0.2.1 verification: the real production uiohook path on cloud Linux received OS desktop events generated in a blank editor through CUA. Actual keydown and keyup drove the final hand, mouse movement changed its target, and button down changed the real model. `docs/inochi/native-physical/` stores boolean outcomes/coarse counts and two app captures; no key text, native codes, or input history. This proves the Linux native chain, not a grant on the user's Mac.
-85 final-model/device-texture raster frames cover83 key states and mouse corners. Authoring QA independently evaluated92 endpoints for folded triangles.
- Rounded portrait PNG/SVG/tray,11 ICNS representations and7 ICO images are deterministically generated from the preserved source. Transparent margins and matching payloads pass.

## Permissions and privacy

First desired global-input ON on macOS presents an explanation and “现在授权 / 暂不”. Only an affirmative user action asks the OS for Accessibility permission. Defer persists; OFF and automated smoke do not prompt. A bounded90-second check resumes the hook after trust is granted. Lock and suspend are independent gates: resume cannot restart capture while still locked. Explicit disable, trust loss,lock,suspend and exit clear current key/button state. Ordinary app focus changes do not break global typing.

Current physical IDs and normalized mouse position exist only in memory for animation. No typed text, input-method text, released-key history, cursor trail or telemetry is retained. The source uses only known physical-key IDs. The UI separates component startup from receipt of an actual native keyboard event. Preview is clearly synthetic and does not increment native counters.

Mic/system audio requests occur only when their feature is explicitly enabled, with purpose and denial/retry messages. No unrelated startup permission requests are added. macOS permission grant and Secure Event Input behavior still require the user's actual OS; neither synthetic frames nor Linux hook success prove those.

## Targets and limits

Apple Silicon macOS arm64 and Windows x64 workflows must run on this exact commit before target-platform success is claimed. They build the44-parameter release, validate the model, launch the extracted executable, assert19 actions and retain PNG evidence. Mac uses native ad-hoc signing plus strict verification; it is not Developer ID/notarization. Windows is not Authenticode-signed. Do not disable OS security to launch it. No Intel Mac target.

83 ANSI physical positions are supported. Fn/Globe,media/brightness/TouchBar,ISO/JIS extras,numpad,Pause,PrintScreen,ScrollLock and ContextMenu are not mapped. Layout labels use Mac modifiers; user has deprioritized cmd/opt/fn. All held supported keys highlight independently; two hands can occupy at most two targets. New right-hand keyboard input takes over recent pointer movement, but a held mouse button keeps the right hand on the mouse. No claim of independently animated ten-finger touch typing.

Working hands use rigid translation, fingertip pressure and genuine rotating/scaling sleeve meshes. The keyboard/mouse are a dynamic texture quad between sleeves and hands in the same model-coordinate drawlist. Sleep/reduced motion suppresses work-hand/device animation; live key labels remain. Physical key repeats do not invent repeated keydown states.

Linux backend is actual CPU triangle rendering because normal WebGL contexts are unavailable. Observed working-frame times in the latest app run were about15–26ms; the active target is approximately30FPS, not a universal performance guarantee. Mac/Windows WebGL results come from their native CI. The renderer supports this authored Inochi0.8 subset, not arbitrary Inochi/Cubism features. No large3D turns,walking or extra anatomical hands are implied.

## 0.2.2 performance and distribution checks

See [OPTIMIZATION-QA.md](OPTIMIZATION-QA.md) for measured callback/render scheduling comparisons and limitations. Full bundled dependency notices are regenerated from actual build inputs. Native source/binding.gyp are explicitly distributed outside ASAR so packaging filters cannot remove rebuild material. Mac runtime licenses are copied before signing. Native target CI must validate this version before release.
