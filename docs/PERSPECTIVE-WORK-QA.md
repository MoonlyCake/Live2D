# Perspective working scene — 0.2.3 candidate

The final Creator 0.8.6 export has27 parts and20 actually bound parameters on a1672×1093 canvas. The application keeps this and the original42-part/44-parameter full-body model loaded together. A single renderer draws one scene at a time, inside a fixed700×458 default pet window.

## Readability and physical alignment

At default size the perspective keyboard spans about391 screen pixels. Main-letter glyph height is approximately10 pixels at the narrow end; the distant function row is smaller (about5 pixels). The character, both devices and contact positions share the authored scene coordinates. Keycap depression is4 logical plane pixels, projected through the same homography as the fingertip. Every held supported key lights independently; one keyboard hand follows the latest still-held key. The other hand independently follows the real mouse body on the left.

The release gate checks83 keyboard contacts and9 mouse positions against fixed local barycentric anchors in the actual transformed model vertices. Maximum measured error with the first native export:0.000029 source pixels. A100-pixel hand translation fails the gate. Raised and downward hands are mutually exclusive.

## Actual application checks

The normal sandboxed cloud Linux Electron application passed24 action assertions and captured actual windows using the official INP. This includes the original five moods/eating/interruption/sleep cases, physical chord/release/buttons/wheel/reset, and five genuine basic eye/mouth moods in the working scene. Inputs in this smoke are deliberately synthetic; OS hook evidence is separately documented in KEYBOARD-RECOVERY-QA.md.

The actual dual-scene lifecycle test holds a key, enters sleep or eating, releases/reset keys during the forced full-body scene, then resumes without stale presses. Ordinary release keeps the desk for4 seconds, followed by a360ms two-stage fade; new input immediately restores it. Only the initial two model loads and contract fetch occur, with no scene-switch reload.

## Current visual acceptance

Keyboard readability and hand/device alignment passed actual700×458 review. The eye-occluder cheek edge was corrected using an additional static layer from the original face pixels. The corrected27-part official export passed the same24 application checks and actual chord/release/button screenshots. Parent and artwork review accepted the corrected default-size composition; no draft model was used.

## Limits

Linux uses real CPU triangle rasterization because both normal WebGL contexts are unavailable; the actual700-pixel app captured roughly46–64ms warm working frames and an initial scene draw of about589ms for setup/cache work. These are not end-to-end input latency or a promise of smooth30FPS. Textures and mesh grids are cached; keycap textures redraw only when the pressed set changes. Apple Silicon/Windows final native results must come from this release's CI.

Rust macOS input work remains a separate experiment and is not included in this production source/package. Production continues the existing native input backend with the documented permission/reconnect repairs. No macOS TCC grant has been inferred from Linux or synthetic tests.
