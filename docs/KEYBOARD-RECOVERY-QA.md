# Keyboard reconnection investigation

This change fixes two confirmed application-level recovery gaps. It does **not** establish the cause of the reported intermittent failure on the user's Mac, or claim that every macOS keyboard interruption is fixed.

## Confirmed findings

- After initial denial or later Accessibility trust loss, the app kept mouse fallback but stopped checking for a grant. Returning from System Settings could therefore leave the keyboard disconnected until a manual retry or full relaunch. The existing 90-second permission-request check only covered its own request window.
- The native addon retains its running flag when `stop()` fails. Its next `start()` then returns without starting a new listener. The app previously swallowed the stop failure and could report that no-op as a successful start.
- The installed uiohook-napi 1.5.5 JavaScript adapter does not emit runtime `error` or tap-disabled notifications. EventEmitter error tests exercise the app's optional adapter error handler; they are not evidence that it can detect a real stopped macOS tap.
- The included libuiohook macOS implementation already re-enables a timeout-disabled tap. It does not handle `kCGEventTapDisabledByUserInput`. That observation alone does not prove the user's failure, or justify automatically overriding an intentional system/user interruption.

## Minimal changes

- Recheck an absent permission when an app window regains focus. If the user has granted it, reconnect once. Repeated focus events do not restart a healthy hook or clear held keys. OFF, lock, suspend, exit and automated renderer smoke remain gated.
- If native stop fails, discard app-side held state and callbacks, retain mouse fallback, and clearly request a full safe quit/reopen. Do not retry a native start that may silently do nothing.
- Rename the explicit retry action to “重新连接键鼠”. Status text separates a started listener from keyboard events actually received during the current connection.
- Add plain-language protected-input and application-update permission guidance. No new timer, permission prompt, native code, dependency, signing change or permission reset is added.

## Verification

`npm run check` passed: TypeScript, 179 application tests (including the concurrent position-lock regressions), and production build.

Five new deterministic tests cover:

1. Initial missing permission followed by a foreground grant; concurrent focus callbacks reconnect only once.
2. Permission revocation, held-state clearing, and foreground reconnection after a new grant.
3. No foreground restart after the lifecycle stopped input for OFF, lock or suspend.
4. A thrown native stop never becoming a falsely successful no-op start, including repeated retry.
5. A failed foreground permission query does not throw from the focus callback or begin capture.

Existing input tests cover listener generation races, actual app-side physical states, pointer fallback, repeated starts, lock/suspend order, and bounded permission-request checks. These tests use injected hooks and mocked permissions. They do not grant macOS TCC or produce physical hardware input.

The Mac ARM release workflow's native launch and synthetic model screenshots also do not test real TCC acceptance, Secure Event Input, a macOS tap-disabled notification, or Developer ID identity continuity. Those remain unverified for this change.

## Real Linux native reconnection check

The final app was launched normally in the cloud Linux desktop, with its production uiohook dependency. The panel’s “重新连接键鼠” button was clicked, then an OS-level CUA key press was delivered to the observed app window. Production `keyboardObserved` changed from false to true, the native coarse count increased from 0 to 1, and the released state held zero keys. The app exited at its bounded 150-second QA deadline. [Coarse-state evidence](inochi/keyboard-recovery-native/report.json) contains no text or native key history.

Linux bound-window CUA injection did not reach the hook; it was not counted as a successful native test. The successful check used OS-level input. It proves this Linux native reconnection chain, not human hardware input, macOS permission changes, native disabled-tap recovery, or the reported intermittent Mac failure.

## macOS boundaries and guidance

Apple's [Secure Event Input note](https://developer.apple.com/library/archive/technotes/tn2150/_index.html) explains that protected input can prevent other processes from receiving keyboard events. The app must respect that protection. The help text therefore says protected input *may* temporarily suppress reactions; it does not claim to detect the current password field or identify another app.

The app is currently ad-hoc signed, not Developer ID signed/notarized. We cannot promise permission continuity across replacement builds. If an update loses its authorization, use System Settings → Privacy & Security → Accessibility to remove the old entry and add the current Whale Companion Inochi application; follow macOS's relaunch instruction if shown. The app never runs `tccutil reset` or changes TCC on the user's behalf.

## Source review

- [uiohook-napi source](https://github.com/SnosMe/uiohook-napi): `dist/index.js`, `src/lib/addon.c`, and `src/lib/uiohook_worker.c`. The official package remains 1.5.5 at review time; no newer published dependency fix was selected.
- Installed corresponding source: `third-party-source/uiohook-napi/libuiohook/src/darwin/input_hook.c`. This change leaves the distributed native source and binaries unchanged.
- [BongoCat macOS implementation](https://github.com/ayangweb/BongoCat/blob/master/crates/bongocat-platform/src/macos.rs) reviewed read-only. It signals a reset for disabled taps, checks permission before replacing a tap, and checks whether replacement succeeded. Its native Rust architecture and permission model are different; none of its code, watchdogs, binaries, assets or permission reset behavior was copied or executed.
