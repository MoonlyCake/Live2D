//! CI-only OS event generator, not a listener or production dependency.
//! No request/prompt API exists here: every post requires existing post-event access.
use napi_derive::napi;
#[path = "../src/keys.rs"]
mod keys;
#[cfg(target_os = "macos")]
mod mac {
    use std::{ffi::c_void, ptr};
    type Ref = *mut c_void;
    #[repr(C)]
    pub struct Point {
        pub x: f64,
        pub y: f64,
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightPostEventAccess() -> bool;
        fn CGEventCreateKeyboardEvent(source: Ref, key: u16, down: bool) -> Ref;
        fn CGEventCreateMouseEvent(source: Ref, kind: u32, point: Point, button: u32) -> Ref;
        fn CGEventCreateScrollWheelEvent(
            source: Ref,
            units: u32,
            wheels: u32,
            wheel1: i32,
            ...
        ) -> Ref;
        fn CGEventSetType(event: Ref, kind: u32);
        fn CGEventSetFlags(event: Ref, flags: u64);
        fn CGEventPost(location: u32, event: Ref);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: Ref);
    }
    pub fn allowed() -> bool {
        unsafe { CGPreflightPostEventAccess() }
    }
    fn post(event: Ref) -> bool {
        if event.is_null() {
            return false;
        }
        unsafe {
            CGEventPost(0, event);
            CFRelease(event);
        }
        true
    }
    fn modifier_flags(code: u16) -> Option<u64> {
        Some(match code {
            59 => 1 | (1 << 18),
            62 => 8192 | (1 << 18),
            56 => 2 | (1 << 17),
            60 => 4 | (1 << 17),
            55 => 8 | (1 << 20),
            54 => 16 | (1 << 20),
            58 => 32 | (1 << 19),
            61 => 64 | (1 << 19),
            _ => return None,
        })
    }
    pub fn key(code: u16, down: bool) -> bool {
        if !allowed() {
            return false;
        }
        let e = unsafe { CGEventCreateKeyboardEvent(ptr::null_mut(), code, down) };
        if e.is_null() {
            return false;
        }
        unsafe {
            CGEventSetFlags(
                e,
                if down {
                    modifier_flags(code).unwrap_or(0)
                } else {
                    0
                },
            );
        }
        post(e)
    }
    pub fn flags(code: u16, down: bool) -> bool {
        let (side, family) = match code {
            59 => (1, 1 << 18),
            62 => (8192, 1 << 18),
            56 => (2, 1 << 17),
            60 => (4, 1 << 17),
            55 => (8, 1 << 20),
            54 => (16, 1 << 20),
            58 => (32, 1 << 19),
            61 => (64, 1 << 19),
            _ => return false,
        };
        if !allowed() {
            return false;
        }
        let e = unsafe { CGEventCreateKeyboardEvent(ptr::null_mut(), code, down) };
        if e.is_null() {
            return false;
        }
        unsafe {
            CGEventSetType(e, 12);
            CGEventSetFlags(e, if down { side | family } else { 0 });
        }
        post(e)
    }
    pub fn mouse(kind: u32, x: f64, y: f64, button: u32) -> bool {
        if !allowed() {
            return false;
        }
        post(unsafe { CGEventCreateMouseEvent(ptr::null_mut(), kind, Point { x, y }, button) })
    }
    pub fn wheel(dx: i32, dy: i32) -> bool {
        if !allowed() {
            return false;
        }
        post(unsafe { CGEventCreateScrollWheelEvent(ptr::null_mut(), 0, 2, dy, dx) })
    }
}
#[napi]
pub fn post_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::allowed()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
#[napi]
pub fn post_key(code: u32, down: bool) -> bool {
    if !keys::KEYS.iter().any(|k| u32::from(k.mac_code) == code) {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        mac::key(code as u16, down)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = down;
        false
    }
}
#[napi]
pub fn post_flags(code: u32, down: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        if code > u16::MAX as u32 {
            return false;
        }
        mac::flags(code as u16, down)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (code, down);
        false
    }
}
#[napi]
pub fn post_mouse(kind: u32, x: f64, y: f64, button: u32) -> bool {
    if !matches!(kind, 1 | 2 | 3 | 4 | 5 | 25 | 26)
        || !x.is_finite()
        || !y.is_finite()
        || button > 2
    {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        mac::mouse(kind, x, y, button)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
#[napi]
pub fn post_wheel(dx: i32, dy: i32) -> bool {
    if !(-10..=10).contains(&dx) || !(-10..=10).contains(&dy) {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        mac::wheel(dx, dy)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
