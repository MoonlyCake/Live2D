# Experimental Mac input attribution

This directory is an experimental, separately built module. It is not the production input backend.

BongoCat — Copyright 2025-present ayangweb, Apache License 2.0.
Reference revision: 85ecd8275d99c088ca042f1c6a6f4910fdf9ce33 (v2.1.1).
https://github.com/ayangweb/BongoCat/tree/85ecd8275d99c088ca042f1c6a6f4910fdf9ce33

The reference's listen-only CGEventTap, current-held-state reconciliation and physical key mapping informed this implementation. The original implementation here adapts those ideas to a Node-API module, explicit 83-key Whale layout, scroll wheel, bounded callback delivery and asynchronous owner lifecycle. It uses no upstream application binary, renderer, gamepad, Swift permission panel, automatic TCC reset, or Cubism code/assets. The root BongoCat LICENSE text and copyright notice are preserved in LICENSE; that revision contains no root NOTICE file.

macOS Insert uses native virtual key 114 (Help), matching the existing libuiohook mapping and the Whale layout's existing behavior. The mapping table is data; no native libuiohook implementation is linked by this module.

BUNDLED-RUST.txt is generated from the exact Cargo.lock dependency closure, with complete available license/notice files for runtime and build-time Rust packages. The surrounding Electron runtime continues to carry its original notices through the existing app packaging process.
