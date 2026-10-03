# Native input component source and replacement

This directory contains the exact source shipped in the official npm package
uiohook-napi 1.5.5: the MIT Node-API wrapper, its libuiohook C sources, JavaScript
loader, and binding.gyp. libuiohook is LGPL-3.0-or-later; full LGPLv3 and GPLv3
texts are in the application's licenses/libuiohook directory. Original copyright
headers are retained. No changes to these third-party sources were made.

The application loads uiohook_napi.node dynamically through node-gyp-build. You
may modify, rebuild, replace and debug this component. No application term
prohibits reverse engineering needed to debug modifications to these components.
The complete application source is supplied in this repository.

## Rebuild on the target OS

Use Node.js, Python 3 and the platform's C/C++ toolchain (Xcode command-line tools
on Apple Silicon macOS, or Visual Studio C++ build tools on Windows x64). From
this uiohook-napi directory, install its declared runtime dependency with
`npm install --ignore-scripts --omit=dev`, then run the standard node-gyp build:

    npx --yes node-gyp@11 rebuild --target=44.5.1 --dist-url=https://electronjs.org/headers

This creates build/Release/uiohook_napi.node. The source is supplied offline;
installing a compiler or missing build/header dependencies may need Internet.
For a different Electron version, use that version's headers. This source package
supports the two distributed targets, macOS arm64 and Windows x64.

## Load a rebuilt component

Quit the application, keep a backup, and replace the matching file under
resources/app.asar.unpacked/node_modules/uiohook-napi/prebuilds/<platform>-<arch>/
with the newly built addon, preserving the existing filename. On macOS,
resources means Whale Companion Inochi.app/Contents/Resources.

Changing a signed .app invalidates its old signature. For a locally modified
macOS build, rebuild the whole application from the supplied source and use its
native signing script to produce your own ad-hoc-signed bundle. Do not disable
Gatekeeper, delete quarantine metadata or change system security settings.

The package includes source and build instructions; the modified native rebuild
has not been exercised on every target OS in this release's application smoke
checks. Upstream: https://github.com/SnosMe/uiohook-napi
