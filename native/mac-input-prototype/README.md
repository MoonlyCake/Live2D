# Experimental Rust macOS input module

**Not the production backend.** The app's existing source, input selection, UI,
renderer and Windows backend are unchanged. This directory can be placed on
`prototype/mac-rust-input` on top of production commit
`a9d3ea1` without unpublished scene/layout changes.

## What is implemented

- One in-process Node-API listener with async start/stop; no helper process or daemon.
- Read-only Input Monitoring preflight. Permission requests exist as a separate API
  for a future explicit user button. Start, retry, tests and CI never request or reset TCC.
- HID-head listen-only event tap. Original events are always returned unchanged.
- Explicit 83-key mapping to existing physical IDs, current canonical pressed set,
  current mouse/buttons/wheel and left/right/keyboard targets. No text conversion,
  window inspection, event history, telemetry or typed-content logging.
- Real down/up edges; bounded callback queue. On overload, capture stops and final
  empty state + terminal status wait for delivery only after the tap is detached.
- Held-only 250ms state reconciliation with two missing checks; held keys have no
  timeout. CapsLock alone is a 100ms latch-trigger pulse, not a measured physical release.
- Initial/latest mouse positions at up to 16ms publication cadence; signed wheel
  pulses; no perpetual high-frequency watchdog. Idle waits until the 1s permission
  check; held-state/mouse/wheel work uses its own deadlines.
- One automatic timeout-disabled tap recreation per connection, only after checking
  permission and Secure Input. User/system-disabled taps await explicit owner restart.
- Permission loss, stop, queue failure and protected-input transitions clear state.
  Secure Input is respected, never reconstructed through polling.

The modifier reconciliation fallback prefers side-specific device flags. If the OS
supplies only family flags, a missed release is conservatively retained until that
family clears rather than falsely releasing a still-held opposite-side modifier.
Display bounds are captured per connection; a future production owner must reconnect
on display-geometry changes.

## API

`adapter.cjs` exports `MacInputPrototype` around the native module:

- `permissionGranted(): boolean`
- `requestPermission(): boolean` — explicit user action only
- `start(onPacket): Promise<string>` — serializes replacement, returns actual service status
- `stop(): Promise<string>` — clears app state immediately, asynchronously stops native work
- `status(): string`

Packets contain version 1 and either a closed current-state snapshot or an anonymous
service status. The adapter rejects invalid IDs/values, strips unknown payload fields,
and rejects callbacks from older connections. The raw `.node` also guards lifecycle
ownership; a shutdown timeout cannot reactivate a previous worker.

A future production integration must choose this module *instead of* uiohook on Mac,
never run both. Keep the existing lock/suspend/desired-ON owner and distinguish
permission state from observed keyboard events. None of that selection is enabled here.

## Build and tests

Official Rust 1.97.1 is pinned; Cargo.lock fixes all crates.

```
node --test native/mac-input-prototype/adapter.test.cjs
node scripts/build-mac-input-prototype.mjs
node scripts/collect-mac-input-licenses.mjs
node --test native/mac-input-prototype/native-load.test.cjs
```

Linux builds only the explicitly unavailable native stub and runs the pure state,
protocol and native ABI/lifecycle tests. A Linux success is never macOS input evidence.

On Apple Silicon, the isolated `.github/workflows/mac-input-prototype.yml` builds and
links the native module, embeds it in a separate `Whale Input Prototype.app`, signs it
inside-out, verifies the signature, then launches that app and tests actual loading,
preflight and repeated start/stop. Its identity is
`local.whale.companion.input-prototype`, not the production app or its profile.
The workflow runs only on the prototype branch or manual dispatch; it does not alter
production releases. No permission prompt is called. A denied runner is expected to
report `permission_denied`; it must not be edited or reset to force an artificial pass.

## Production replacement gate

The following require an authorized interactive Mac cloud session and remain required
before production replacement:

1. Real keys and modifier chords, releases, repeats, long holds, and all supported key mapping.
2. Mouse movement/buttons/drag/wheel, multi-display geometry, and simultaneous keyboard input.
3. Denial, actual user grant, revocation/regrant, and permission attribution from the final production .app.
4. Lock, sleep/wake and unlock ordering; OFF must never restart capture.
5. Secure Input pause/resume, native tap interruption and overload; no stuck held state.
6. Exit and reconnect stress without duplicate tap, leaked thread or blocked UI; idle/active CPU comparison.

Compilation, callbacks injected in tests, a Linux stub, a signed app, or a denied
permission smoke do **not** satisfy those real-input cases. Until those checks pass,
retain the current production backend. Secure Input remains an operating-system
restriction; Rust cannot promise to bypass or eliminate it.

## Attribution

See LICENSE, NOTICE, THIRD_PARTY_NOTICES.md and generated BUNDLED-RUST.txt. The fixed
BongoCat v2.1.1 and previously reviewed bf090794… refs have identical macOS input files.
Only the relevant native design was adapted. No whole upstream project was executed.
