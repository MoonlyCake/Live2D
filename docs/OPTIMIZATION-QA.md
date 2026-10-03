# Input and idle rendering optimization

Compared with published v0.2.1, commit `96747b38552d2f6385e9ea6d0007b5dfb78832f0`.

## Scope

- Native mouse events publish their first/latest position immediately, then coalesce movement to at most one update per 16 ms. Keys, buttons and releases stay synchronous. An earlier queued move is applied before a newer discrete input, so it cannot take the right hand back from a newly pressed key.
- The mouse hand and visible mouse share a finite 24 ms visual transition. Clicking, changing modes or recovering after a long frame gap snaps to the exact point. Keyboard targets remain exact, without interpolation.
- A healthy native hook needs one permission check per second while idle. Movement and wheel expiry use their deadlines. Without the hook, the existing OS-pointer fallback remains available.
- One small frame loop is shared by the pet and panel. A hidden panel has no RAF callbacks. An idle pet sleeps between frames and an input event wakes it immediately. Sleep, blink, meal interruption and reduced-motion priorities remain intact.
- No dependency, account, cloud service, renderer framework, model or artwork change.

## Measurements

Callback benchmark used synthetic events at the production hook adapter in cloud Node. It measures only event callback to state publication, excluding native OS, IPC, compositor and display latency. Mouse events in this benchmark are spaced 47 ms apart; the separate deterministic tests cover sustained bursts and 16 ms coalescing.

- Mouse callback median: 19.271 ms before, 0.094 ms after.
- Mouse callback P95: 32.266 ms before, 0.130 ms after.
- Keyboard callback median: 0.031 ms before, 0.040 ms after; still synchronous.
- Idle OS pointer reads in 1.1 seconds: 33 before, 1 startup read after.

Actual cloud Linux Electron comparison, with the old frozen build and optimized build, over approximately 2 seconds each:

- Hidden panel RAF callbacks: 121 before, 0 after. Both had 0 draws while hidden.
- Visible idle pet RAF callbacks: 121 before, 22 after. CPU triangle draws: 10 before, 8 after.
- Restoring the hidden panel resumed rendering: 15 RAF callbacks and 2 draws during the following 250 ms.

These are callback/draw counts, not measured battery savings. This cloud Linux environment uses the CPU triangle backend; new Mac/Windows GPU performance requires native CI and is not inferred from Linux.

## Verification

- Typecheck, production build and 171 application tests passed.
- 31 renderer/parser tests and 80 meal-interruption states passed.
- Absolute transformed-mesh gate: all 83 keys and 9 mouse positions passed; maximum fingertip error 0.00001812 source pixels.
- Actual cloud Electron final model passed all 19 existing action checks and captures, including exact keyboard contacts, mouse extremes/buttons/wheel, sleep, five moods and finite rice interruption.
- Added tests cover first/trailing mouse updates, discrete edge ordering, pending shutdown, permission loss, fallback, wheel expiry, hidden/show races, canceled callbacks, finite shared mouse interpolation and unchanged exact key/button states.

The performance work does not establish actual macOS permission acceptance or end-to-end physical input latency on a user's device.

## Design references

Ideas were independently implemented; no upstream code, model, binary or assets were copied or executed.

- MerZlin/dsh-pet-indesktop at `beaa8f5c342af11de117d3afa90e2f4dba6c9dfe`: activity-sensitive scheduling and input wake-up. Its code license is MIT; its character assets have separate restrictions and were not reused.
- ayangweb/BongoCat at `bf0907948a278189e01cda5c7209533c34e7e2d0`: latest-point mouse coalescing, direct key/button edges and visibility-aware work. Its permissions and model stack were not adopted.
