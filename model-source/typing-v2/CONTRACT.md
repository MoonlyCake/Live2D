# Per-key typing rig extension (in progress)

The archived `base-v0.2.0.inx` is the immutable authoring input (25 parameters). The top-level canonical model now contains the new version, so it must never be fed back into this extension builder. This version adds independently positioned typing hands and sleeve bridges. It does not reinterpret the previous symmetric `ParamTyping` gesture as per-key typing.

The runtime keyboard layout is the single source of physical-key geometry. Coordinates use the original 1254×1254 artwork canvas, before subtracting the mesh origin (627,627). Key centers, hand fingertip anchors, and overlay projection must share the same model-to-viewport transform.

Proposed controls:

- `ParamTypingMode`: exact 0/1, exclusively changes ordinary arms to typing arms; never opacity-crossfade anatomy.
- `ParamTypingHandLX`, `ParamTypingHandRX`: absolute target fingertip X, range 360–910.
- `ParamTypingHandLY`, `ParamTypingHandRY`: absolute target fingertip Y, range 820–1030.
- `ParamTypingPressL`, `ParamTypingPressR`: 0–1, fingertip travels down 4 source pixels at full press.

Default fingertip locations come from the layout's F and J key centers. Artwork records fingertip, wrist, and fixed upper-arm anchors. Hand/cuff meshes translate rigidly. Each sleeve bridge uses its fixed elbow as a local origin, rotates around that origin, and scales along its own cloth axis to meet the moving cuff. The initial weighted XY bridge was rejected because 21 peripheral keys caused triangle foldover. Native angle/length parameters now preserve positive mesh orientation across all 83 keys. This is a limited frontal illustration rig, not skeletal three-dimensional inverse kinematics.

Each physical key has independent pressed state and visual feedback. Up to two hands can target two simultaneously pressed keys; additional keys remain independently depressed/highlighted. Unknown/unavailable keys must not be remapped to another key. Full text must not be stored or logged.

Typing and eating arm sets are mutually exclusive. An input during eating first performs the bounded opaque spoon return, then enters typing. Body sway/bounce/breath displacement should be held steady while typing unless keyboard and hands share the same displacement; head and eyes may continue independent motion.

Pending gates: artwork and exact key layout; mesh authoring; endpoint and all-key fingertip coordinate tests; arm-connection visual review; Creator round-trip export; actual event-to-key-to-hand app tests.


Mouse controls: `ParamMouseMode` is a binary right-hand replacement within typing/work mode; `ParamMouseX/Y` are the mouse body reference center, range X938–1002/Y897–957 from the shared layout; `ParamMouseLeft/Right` locally depress the corresponding fingers, while `ParamMouseWheel` moves the index finger slightly. The mouse hand has a separate authored grip and sleeve.

`rig-contract.json` records the exact fixed/moving anchors and polar sleeve parameter names. Evaluate sleeve angle and length every frame from the interpolated hand target, including typing press travel. Do not interpolate angle/length independently from the target, or the cuff connection can drift. `qa.mjs` renders all physical key endpoints plus nine mouse positions through actual mesh triangles; it also rejects triangle orientation inversions.

Layer order: ordinary character, working sleeve bridges (z≈−40), dynamic keyboard/mouse quad (z=−50), rigid working hands (z≈−60). This keeps the keyboard from covering fingertips and keeps long cloth bridges behind its upper edge.
