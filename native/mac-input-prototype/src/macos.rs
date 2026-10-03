//! Narrow CoreGraphics backend. Original implementation informed by BongoCat's
//! listen-only tap / held-only reconciliation design; see THIRD_PARTY_NOTICES.md.
//! All CoreFoundation objects and event callbacks belong to one run-loop thread.
use crate::{Sink, service, state::State};
use std::{
    ffi::c_void,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr,
    sync::mpsc::SyncSender,
    time::Instant,
};
type Ref = *mut c_void;
#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    origin: Point,
    size: Size,
}
type Callback = unsafe extern "C" fn(Ref, u32, Ref, Ref) -> Ref;
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
    fn CGEventTapCreate(
        location: u32,
        placement: u32,
        options: u32,
        mask: u64,
        callback: Callback,
        user: Ref,
    ) -> Ref;
    fn CGEventTapEnable(tap: Ref, enabled: bool);
    fn CGEventTapIsEnabled(tap: Ref) -> bool;
    fn CGEventGetIntegerValueField(event: Ref, field: u32) -> i64;
    fn CGEventGetDoubleValueField(event: Ref, field: u32) -> f64;
    fn CGEventGetLocation(event: Ref) -> Point;
    fn CGEventGetFlags(event: Ref) -> u64;
    fn CGEventSourceFlagsState(source: i32) -> u64;
    fn CGEventSourceKeyState(source: i32, key: u16) -> bool;
    fn CGEventSourceButtonState(source: i32, button: u32) -> bool;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> Rect;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopDefaultMode: Ref;
    fn CFRunLoopGetCurrent() -> Ref;
    fn CFRetain(value: Ref) -> Ref;
    fn CFRelease(value: Ref);
    fn CFMachPortCreateRunLoopSource(allocator: Ref, port: Ref, order: isize) -> Ref;
    fn CFMachPortInvalidate(port: Ref);
    fn CFRunLoopAddSource(run_loop: Ref, source: Ref, mode: Ref);
    fn CFRunLoopRemoveSource(run_loop: Ref, source: Ref, mode: Ref);
    fn CFRunLoopRunInMode(mode: Ref, seconds: f64, return_after_source: bool) -> i32;
    fn CFRunLoopStop(run_loop: Ref);
    fn CFRunLoopWakeUp(run_loop: Ref);
}
#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}

pub fn permission_granted() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}
pub fn request_permission() -> bool {
    unsafe { CGRequestListenEventAccess() }
}
pub fn stop_run_loop(pointer: usize) {
    unsafe {
        CFRunLoopStop(pointer as Ref);
        CFRunLoopWakeUp(pointer as Ref);
    }
}
fn secure_input() -> bool {
    unsafe { IsSecureEventInputEnabled() != 0 }
}
// CGEventType: includes wheel (22), unlike the BongoCat reference mask.
const TYPES: [u32; 13] = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 22, 25, 26];
fn event_mask() -> u64 {
    TYPES
        .into_iter()
        .chain([27])
        .fold(0, |mask, t| mask | (1u64 << t))
}

struct Tap {
    port: Ref,
    source: Ref,
    run_loop: Ref,
}
impl Tap {
    fn create(context: &mut Context, run_loop: Ref) -> Option<Self> {
        // HID head + listen-only. The callback never changes or consumes an event.
        let port = unsafe {
            CGEventTapCreate(
                0,
                0,
                1,
                event_mask(),
                event_callback,
                context as *mut _ as Ref,
            )
        };
        if port.is_null() {
            return None;
        }
        let source = unsafe { CFMachPortCreateRunLoopSource(ptr::null_mut(), port, 0) };
        if source.is_null() {
            unsafe {
                CFMachPortInvalidate(port);
                CFRelease(port);
            }
            return None;
        }
        let tap = Self {
            port,
            source,
            run_loop,
        };
        unsafe {
            CFRunLoopAddSource(run_loop, source, kCFRunLoopDefaultMode);
            CGEventTapEnable(port, true);
        }
        if unsafe { CGEventTapIsEnabled(port) } {
            Some(tap)
        } else {
            None
        }
    }
}
impl Drop for Tap {
    fn drop(&mut self) {
        unsafe {
            CGEventTapEnable(self.port, false);
            CFRunLoopRemoveSource(self.run_loop, self.source, kCFRunLoopDefaultMode);
            CFMachPortInvalidate(self.port);
            CFRelease(self.source);
            CFRelease(self.port);
        }
    }
}
struct LoopLease(Ref);
impl LoopLease {
    fn new() -> Self {
        let raw = unsafe { CFRetain(CFRunLoopGetCurrent()) };
        service::with_run_loop(|p| *p = raw as usize);
        Self(raw)
    }
}
impl Drop for LoopLease {
    fn drop(&mut self) {
        service::with_run_loop(|p| {
            *p = 0;
            unsafe { CFRelease(self.0) }
        });
    }
}

struct Context {
    state: State,
    sink: Sink,
    started: Instant,
    run_loop: Ref,
    viewport: Option<(f64, f64, f64, f64)>,
    terminal: Option<u8>,
    disabled: Option<bool>,
    last_state: String,
    next_permission: u64,
    next_reconcile: u64,
    move_at: u64,
    pending_move: bool,
    mouse_due: u64,
    wheel_due: u64,
    caps_due: u64,
    protected: bool,
}
impl Context {
    fn now(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
    fn send(&mut self, value: serde_json::Value) {
        if !(self.sink)(value.to_string(), false) {
            self.terminal = Some(7);
            unsafe {
                CFRunLoopStop(self.run_loop);
            }
        }
    }
    fn publish(&mut self) {
        let now = self.now();
        let value = serde_json::json!({"v":1,"type":"state","state":self.state.snapshot(now)});
        let json = value.to_string();
        if json != self.last_state {
            self.last_state = json.clone();
            if !(self.sink)(json, false) {
                self.terminal = Some(7);
                unsafe {
                    CFRunLoopStop(self.run_loop);
                }
            }
        }
    }
    fn status(&mut self, code: u8) {
        service::set_status(code);
        self.send(serde_json::json!({"v":1,"type":"status","status":service::status()}));
    }
    fn clear(&mut self) {
        self.state.reset();
        self.pending_move = false;
        self.mouse_due = 0;
        self.wheel_due = 0;
        self.caps_due = 0;
        self.publish();
    }
    fn security(&mut self) -> bool {
        if !permission_granted() {
            self.clear();
            self.terminal = Some(3);
            return false;
        }
        let secure = secure_input();
        if secure != self.protected {
            self.protected = secure;
            self.clear();
            self.status(if secure { 11 } else { 2 });
        }
        true
    }
    fn tick(&mut self) {
        let now = self.now();
        if now >= self.next_permission {
            self.next_permission = now + 1000;
            if !self.security() {
                return;
            }
        }
        if self.caps_due > 0 && now >= self.caps_due {
            self.caps_due = 0;
            self.state.key_up(57);
            self.publish();
        }
        if now >= self.next_reconcile {
            self.next_reconcile = now + 250;
            // These queries only check keys/buttons already known to be held. Never
            // reconstruct a secret input stream or infer new presses from polling.
            if !self.protected && !secure_input() {
                let keys = self
                    .state
                    .reconcile_held(|key| key == 57 || system_key_pressed(key));
                let buttons = self.state.reconcile_buttons(|button| unsafe {
                    CGEventSourceButtonState(1, button as u32)
                });
                if keys || buttons {
                    self.publish();
                }
            } else if !self.state.held_native_codes().is_empty() {
                self.clear();
            }
        }
        if self.pending_move && now >= self.move_at {
            self.pending_move = false;
            self.move_at = now + 16;
            self.publish();
        }
        if (self.mouse_due > 0 && now >= self.mouse_due)
            || (self.wheel_due > 0 && now >= self.wheel_due)
        {
            if now >= self.mouse_due {
                self.mouse_due = 0;
            }
            if now >= self.wheel_due {
                self.wheel_due = 0;
            }
            self.publish();
        }
    }
    fn wait_seconds(&self) -> f64 {
        let now = self.now();
        let mut due = self.next_permission;
        if !self.state.held_native_codes().is_empty() || !self.state.held_buttons().is_empty() {
            due = due.min(self.next_reconcile);
        }
        for d in [self.mouse_due, self.wheel_due, self.caps_due] {
            if d > 0 {
                due = due.min(d);
            }
        }
        if self.pending_move {
            due = due.min(self.move_at);
        }
        (due.saturating_sub(now).max(1) as f64) / 1000.0
    }
    fn event(&mut self, kind: u32, event: Ref) {
        if service::stopping() || self.terminal.is_some() {
            return;
        }
        // Disabled notifications may have no event payload: inspect type first.
        if kind == u32::MAX || kind == u32::MAX - 1 {
            self.disabled = Some(kind == u32::MAX - 1);
            self.clear();
            unsafe {
                CFRunLoopStop(self.run_loop);
            }
            return;
        }
        if event.is_null() {
            return;
        }
        let now = self.now();
        // Secure Input is a system-owned boundary. Do not poll pressed state to work around it.
        let protected = if matches!(kind, 10 | 11 | 12) {
            secure_input()
        } else {
            self.protected
        };
        if protected != self.protected {
            self.protected = protected;
            self.clear();
            self.status(if protected { 11 } else { 2 });
        }
        if matches!(kind, 10 | 11 | 12) && protected {
            return;
        }
        if kind != 5 && kind != 6 && kind != 7 && kind != 27 && self.pending_move {
            self.pending_move = false;
            self.publish();
        }
        match kind {
            10 | 11 => {
                let raw = unsafe { CGEventGetIntegerValueField(event, 9) };
                if let Ok(code) = u16::try_from(raw) {
                    let changed = if kind == 10 {
                        self.state.key_down(code)
                    } else {
                        self.state.key_up(code)
                    };
                    if changed {
                        self.publish();
                    }
                }
            }
            12 => {
                let raw = unsafe { CGEventGetIntegerValueField(event, 9) };
                if let Ok(code) = u16::try_from(raw) {
                    if code == 57 {
                        self.state.key_down(code);
                        self.caps_due = now + 100;
                        self.publish();
                    } else if matches!(code, 54 | 55 | 56 | 58 | 59 | 60 | 61 | 62) {
                        if unsafe { CGEventGetFlags(event) } & modifier_bit(code) != 0 {
                            self.state.key_down(code);
                        } else {
                            self.state.key_up(code);
                        }
                        self.publish();
                    }
                }
            }
            1 | 2 | 3 | 4 | 25 | 26 => {
                let raw = unsafe { CGEventGetIntegerValueField(event, 3) };
                if let Ok(button) = u8::try_from(raw) {
                    if self.state.button(button, matches!(kind, 1 | 3 | 25)) {
                        self.publish();
                    }
                }
            }
            5 | 6 | 7 | 27 => {
                let p = unsafe { CGEventGetLocation(event) };
                if let Some((x, y, w, h)) = self.viewport {
                    if self.state.mouse_move(
                        (p.x - x) / w * 2.0 - 1.0,
                        (p.y - y) / h * 2.0 - 1.0,
                        now,
                    ) {
                        self.mouse_due = now + 700;
                        self.pending_move = true;
                        if now >= self.move_at {
                            self.pending_move = false;
                            self.move_at = now + 16;
                            self.publish();
                        }
                    }
                }
            }
            22 => {
                let y = unsafe { CGEventGetDoubleValueField(event, 96) };
                let x = unsafe { CGEventGetDoubleValueField(event, 97) };
                if self.state.wheel(x, y, now) {
                    self.mouse_due = now + 180;
                    self.wheel_due = now + 180;
                    self.publish();
                }
            }
            _ => {}
        }
    }
}
unsafe extern "C" fn event_callback(_proxy: Ref, kind: u32, event: Ref, user: Ref) -> Ref {
    // Context is boxed and owned by run(); all taps are invalidated before it drops.
    let context = unsafe { &mut *(user as *mut Context) };
    if catch_unwind(AssertUnwindSafe(|| context.event(kind, event))).is_err() {
        context.terminal = Some(9);
        unsafe {
            CFRunLoopStop(context.run_loop);
        }
    }
    event
}
fn modifier_bit(key: u16) -> u64 {
    match key {
        59 => 1,
        56 => 2,
        60 => 4,
        55 => 8,
        54 => 16,
        58 => 32,
        61 => 64,
        62 => 8192,
        _ => 0,
    }
}
fn modifier_family(key: u16) -> u64 {
    match key {
        54 | 55 => 1 << 20,
        56 | 60 => 1 << 17,
        58 | 61 => 1 << 19,
        59 | 62 => 1 << 18,
        _ => 0,
    }
}
fn system_key_pressed(key: u16) -> bool {
    if unsafe { CGEventSourceKeyState(1, key) } {
        return true;
    }
    // Some macOS versions expose only family state for right modifiers. A held
    // sibling must not cause a false release; a lost edge clears when its family clears.
    let family = modifier_family(key);
    if family == 0 {
        return false;
    }
    let flags = unsafe { CGEventSourceFlagsState(1) };
    let pair = match key {
        54 | 55 => 24,
        56 | 60 => 6,
        58 | 61 => 96,
        59 | 62 => 8193,
        _ => 0,
    };
    if flags & pair != 0 {
        flags & modifier_bit(key) != 0
    } else {
        flags & family != 0
    }
}
fn desktop_bounds() -> Option<(f64, f64, f64, f64)> {
    let mut displays = [0u32; 32];
    let mut count = 0;
    if unsafe { CGGetActiveDisplayList(32, displays.as_mut_ptr(), &mut count) } != 0
        || count == 0
        || count > 32
    {
        return None;
    }
    let (mut x, mut y, mut right, mut bottom) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for display in &displays[..count as usize] {
        let b = unsafe { CGDisplayBounds(*display) };
        x = x.min(b.origin.x);
        y = y.min(b.origin.y);
        right = right.max(b.origin.x + b.size.width);
        bottom = bottom.max(b.origin.y + b.size.height);
    }
    let w = right - x;
    let h = bottom - y;
    if [x, y, w, h].into_iter().all(f64::is_finite) && w > 0.0 && h > 0.0 {
        Some((x, y, w, h))
    } else {
        None
    }
}
pub fn run(sink: Sink, ready: SyncSender<()>) {
    if service::stopping() {
        service::set_status(0);
        let _ = ready.send(());
        return;
    }
    if !permission_granted() {
        service::set_status(3);
        let _ = ready.send(());
        return;
    }
    let lease = LoopLease::new();
    let mut context = Box::new(Context {
        state: State::new(),
        sink,
        started: Instant::now(),
        run_loop: lease.0,
        viewport: desktop_bounds(),
        terminal: None,
        disabled: None,
        last_state: String::new(),
        next_permission: 1000,
        next_reconcile: 250,
        move_at: 0,
        pending_move: false,
        mouse_due: 0,
        wheel_due: 0,
        caps_due: 0,
        protected: false,
    });
    let mut recovered = false;
    let mut tap = match Tap::create(&mut context, lease.0) {
        Some(t) => Some(t),
        None => {
            context.status(5);
            let _ = ready.send(());
            return;
        }
    };
    context.status(2);
    context.publish();
    let _ = ready.send(());
    loop {
        if service::stopping() {
            context.terminal = Some(0);
            break;
        }
        if context.terminal.is_some() {
            break;
        }
        context.tick();
        if context.terminal.is_some() {
            break;
        }
        if let Some(timeout) = context.disabled.take() {
            // One event-triggered timeout recovery, never a blind restart watchdog.
            // User/system-disabled taps await an explicit owner restart.
            if !timeout || recovered {
                context.terminal = Some(6);
                break;
            }
            if !context.security() || context.protected {
                context.terminal = Some(if context.protected { 11 } else { 3 });
                break;
            }
            drop(tap.take());
            match Tap::create(&mut context, lease.0) {
                Some(t) => tap = Some(t),
                None => {
                    context.terminal = Some(5);
                    break;
                }
            }
            recovered = true;
            context.status(2);
        }
        let wait = context.wait_seconds();
        unsafe {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, wait, true);
        }
    }
    drop(tap);
    let code = context.terminal.unwrap_or(0);
    context.state.reset();
    // Only after detaching the tap may the worker wait for JS queue capacity.
    // This guarantees that overload cannot leave the last delivered key held.
    let reset =
        serde_json::json!({"v":1,"type":"state","state":context.state.snapshot(context.now())})
            .to_string();
    let _ = (context.sink)(reset, true);
    service::set_status(code);
    let _ = (context.sink)(
        serde_json::json!({"v":1,"type":"status","status":service::status()}).to_string(),
        true,
    );
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn listen_mask_includes_wheel_and_all_key_button_edges() {
        for k in [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 22, 25, 26, 27] {
            assert_ne!(event_mask() & (1 << k), 0);
        }
    }
}
