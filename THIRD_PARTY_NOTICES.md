# Third-party notices

Full notices are distributed with the application, not replaced by this summary.

- `licenses/BUNDLED-NPM.txt` contains complete license/copyright texts for the
  packages actually included by esbuild, plus the external native input module
  and its runtime dependencies. This includes PixiJS and its component packages,
  pixi-live2d-display (Guan), uiohook-napi (Alexander Drozdov), node-gyp-build and
  bundled transitive dependencies. Exact versions are listed beside each text.
- Electron's full MIT notice is `licenses/LICENSE.electron.txt` inside the
  application. The runtime's full Chromium third-party notices are also supplied:
  `Contents/Resources/LICENSES.chromium.html` on Mac, and
  `LICENSES.chromium.html` beside the Windows executable. Mac also includes the
  Electron notice in `Contents/Resources/LICENSE.electron.txt`.
- uiohook-napi contains libuiohook, Copyright 2006–2023 Alexander Barker and
  contributors, licensed LGPL-3.0-or-later. Full LGPLv3 and GPLv3 texts are in
  `licenses/libuiohook/`. The corresponding native source, binding.gyp and
  replacement/rebuild instructions are supplied in `third-party-source/`,
  outside app.asar. Original source notices are preserved.

The license collector reads the exact installed dependencies and Electron runtime
on each build platform. The generated Chromium HTML is a binary-release notice;
source checkouts regenerate it when building, rather than storing a second
20 MB copy in version control. No third-party rights are removed by this project's
package metadata or by publishing its source repository.

## Inochi model tooling and format

The character was authored and validated with official Inochi Creator 0.8.6
(BSD-2-Clause). Creator and official SDK/WASM binaries are not bundled. The default
runtime is this project's restricted Inochi 0.8 interpreter and mesh renderer.
Cubism Core is not bundled and is not needed for the included character.

## Design references for performance changes

Activity-driven scheduling and pointer coalescing ideas were reviewed in
MerZlin/dsh-pet-indesktop and ayangweb/BongoCat. No source code, character assets,
models, binaries or scripts from those repositories were copied into this app.
