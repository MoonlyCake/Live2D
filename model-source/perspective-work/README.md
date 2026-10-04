# Perspective working-scene model

`WhaleGirl-work.inx` is the editable source saved in official Inochi Creator 0.8.6 on 2026-10-03. `WhaleGirl-work.inp` is the corresponding native Puppet export: 27 mesh parts, 20 parameters, two texture atlases. It uses Inochi2D 0.8, not Cubism/MOC3.

This scene follows the approved angled whale-girl composition: left mouse, right keyboard, with the original raised-hand rest and a separately authored downward keypress hand. The existing full-body model remains the idle/eating scene. The keyboard's labelled keycaps are drawn by the application through a shared perspective-plane mapping; they are intentionally not baked into the native model.

## Rebuild the editable draft

Requires Python 3 and Pillow. From the repository root:

    python model-source/perspective-work/build_work.py art/production-v6-perspective-ready art/production-v6-rigfix-ready art/production-v6-face-surface-ready

The builder uses the small checked-in `authoring-template.json`, the registered 26-layer artwork, all six frozen rig fixes, and the static FaceSurfaceRestore addition. It does not depend on an older binary full-body model. Lossless transparent-padding crops preserve registered pixels. An isolated rebuild reproduced the draft bytes and rig contract exactly.

The output `WhaleGirl-work-DRAFT.inx` is an authoring draft. Open it in Creator, visually verify, save an editable INX, and use File → Export → Inochi2D Puppet for the native INP. Do not rename a draft to claim an official export. Keep `rig-contract.json` with the corresponding model.

## Geometry and validation

- One homography governs keyboard rectangles, lettering and the right-hand contact point. Mouse movement uses the real pad plane and the left hand/body center.
- Explicit local mesh anchors allow absolute contact tests; no transformed-default subtraction can conceal model drift.
- The right hand rotates about the fingertip toward its fixed sleeve anchor. The sleeve root does not stretch backwards. Raised/press poses are mutually exclusive.
- Eye occluders use columns aligned to each tilted eye axis. Every local column intersects and pins the actual rectangle's four edges. Monotone eyelid deformation keeps the iris round and avoids both outer-edge iris leaks and inverted triangles.
- A static FaceSurfaceRestore layer restores the exact original cheeks/blush outside the original eye apertures; moving eyelid skin is visible only through the apertures. This fixes the rectangular skin-color blocks found in the actual application.
- Open/closed mouth and eyelid changes use narrow mutually exclusive thresholds, not long translucent overlap of two anatomies.
- Actual mesh QA covers 83 keys plus 31 eye, mouth, gaze and mouse poses. Artist review accepted intermediate blinks and far-key sleeves. Native Creator quarter-open-eye and neutral views were checked before export.
- The native model has real blink/gaze/mouth controls. The application's five working moods use these basic eye/mouth controls; the full-body scene retains its richer separate mood artwork and eating rig.

Run the standalone geometry/contact-sheet test with:

    node --import tsx model-source/perspective-work/qa-work.mts model-source/perspective-work/WhaleGirl-work.inp

See `native-export-qa.json`, `numeric-qa.json` and the application's integrated scene/input reports. Platform binaries require their separate application checks.
