# Lock and click-through verification

Locking the pet now also enables whole-window click-through. The settings window
is unaffected. Unlocking through the panel/tray clears standalone click-through,
and the existing recovery command clears both flags before reapplying geometry.
The existing drag cancellation and IPC move guard remain in place. Locking does
not stop global keyboard/mouse animation.

Three tests execute the actual main-process functions: initial/resize policy,
unlock without global-input restart, and recovery ordering. Persisted lock state
uses the same initial window policy on restart.

## Actual operating-system routing test

Cloud Linux Electron, with normal security settings and two application-owned
windows. A test button window was placed behind the pet. Global input collection
was disabled for this probe. Two OS desktop clicks used the same visible point
inside the character; this was not `webContents.sendInputEvent` or a flag check.

- Locked: the lower test window received one click; the pet received zero.
- Unlocked: the pet received one click; the lower window remained at one.
- The probe recorded a pass and exited normally.

Evidence: `inochi/locked-passthrough/result.json` and two narrow application
captures. This confirms Linux routing only. Actual macOS and Windows routing
still need native-platform verification; their behavior is not inferred from a
unit test or this Linux result. The user's local machine was not accessed.
