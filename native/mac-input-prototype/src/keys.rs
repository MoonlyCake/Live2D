//! Fixed physical-key allowlist in assets/keyboard.layout.json order.
//!
//! mac_code is a CoreGraphics virtual keycode, NOT the asset's uiohook nativeCode.
//! These physical positions are independent of keyboard language or produced text.
//! Cross-checked read-only against BongoCat v2.1.1, commit
//! 85ecd8275d99c088ca042f1c6a6f4910fdf9ce33, macos.rs::map_key_code.
//! That reference omits Insert: macOS Help (114) is mapped to Insert by this
//! project's bundled libuiohook src/darwin/input_helper.c, and retained here.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hand {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyBinding {
    pub id: &'static str,
    pub mac_code: u16,
    // Documentation/parity check only; never pass this to CoreGraphics.
    pub uiohook_code: u16,
    pub hand: Hand,
}

const fn key(id: &'static str, mac_code: u16, uiohook_code: u16, hand: Hand) -> KeyBinding {
    KeyBinding {
        id,
        mac_code,
        uiohook_code,
        hand,
    }
}

pub const KEYS: [KeyBinding; 83] = [
    key("Backquote", 50, 41, Hand::Left),
    key("Digit1", 18, 2, Hand::Left),
    key("Digit2", 19, 3, Hand::Left),
    key("Digit3", 20, 4, Hand::Left),
    key("Digit4", 21, 5, Hand::Left),
    key("Digit5", 23, 6, Hand::Left),
    key("Digit6", 22, 7, Hand::Left),
    key("Digit7", 26, 8, Hand::Right),
    key("Digit8", 28, 9, Hand::Right),
    key("Digit9", 25, 10, Hand::Right),
    key("Digit0", 29, 11, Hand::Right),
    key("Minus", 27, 12, Hand::Right),
    key("Equal", 24, 13, Hand::Right),
    key("Backspace", 51, 14, Hand::Right),
    key("Tab", 48, 15, Hand::Left),
    key("KeyQ", 12, 16, Hand::Left),
    key("KeyW", 13, 17, Hand::Left),
    key("KeyE", 14, 18, Hand::Left),
    key("KeyR", 15, 19, Hand::Left),
    key("KeyT", 17, 20, Hand::Left),
    key("KeyY", 16, 21, Hand::Right),
    key("KeyU", 32, 22, Hand::Right),
    key("KeyI", 34, 23, Hand::Right),
    key("KeyO", 31, 24, Hand::Right),
    key("KeyP", 35, 25, Hand::Right),
    key("BracketLeft", 33, 26, Hand::Right),
    key("BracketRight", 30, 27, Hand::Right),
    key("Backslash", 42, 43, Hand::Right),
    key("CapsLock", 57, 58, Hand::Left),
    key("KeyA", 0, 30, Hand::Left),
    key("KeyS", 1, 31, Hand::Left),
    key("KeyD", 2, 32, Hand::Left),
    key("KeyF", 3, 33, Hand::Left),
    key("KeyG", 5, 34, Hand::Left),
    key("KeyH", 4, 35, Hand::Right),
    key("KeyJ", 38, 36, Hand::Right),
    key("KeyK", 40, 37, Hand::Right),
    key("KeyL", 37, 38, Hand::Right),
    key("Semicolon", 41, 39, Hand::Right),
    key("Quote", 39, 40, Hand::Right),
    key("Enter", 36, 28, Hand::Right),
    key("ShiftLeft", 56, 42, Hand::Left),
    key("KeyZ", 6, 44, Hand::Left),
    key("KeyX", 7, 45, Hand::Left),
    key("KeyC", 8, 46, Hand::Left),
    key("KeyV", 9, 47, Hand::Left),
    key("KeyB", 11, 48, Hand::Right),
    key("KeyN", 45, 49, Hand::Right),
    key("KeyM", 46, 50, Hand::Right),
    key("Comma", 43, 51, Hand::Right),
    key("Period", 47, 52, Hand::Right),
    key("Slash", 44, 53, Hand::Right),
    key("ShiftRight", 60, 54, Hand::Right),
    key("ControlLeft", 59, 29, Hand::Left),
    key("AltLeft", 58, 56, Hand::Left),
    key("MetaLeft", 55, 3675, Hand::Left),
    key("Space", 49, 57, Hand::Left),
    key("MetaRight", 54, 3676, Hand::Right),
    key("AltRight", 61, 3640, Hand::Right),
    key("ControlRight", 62, 3613, Hand::Right),
    key("Escape", 53, 1, Hand::Left),
    key("F1", 122, 59, Hand::Left),
    key("F2", 120, 60, Hand::Left),
    key("F3", 99, 61, Hand::Left),
    key("F4", 118, 62, Hand::Left),
    key("F5", 96, 63, Hand::Left),
    key("F6", 97, 64, Hand::Right),
    key("F7", 98, 65, Hand::Right),
    key("F8", 100, 66, Hand::Right),
    key("F9", 101, 67, Hand::Right),
    key("F10", 109, 68, Hand::Right),
    key("F11", 103, 87, Hand::Right),
    key("F12", 111, 88, Hand::Right),
    key("Insert", 114, 3666, Hand::Right),
    key("Home", 115, 3655, Hand::Right),
    key("PageUp", 116, 3657, Hand::Right),
    key("Delete", 117, 3667, Hand::Right),
    key("End", 119, 3663, Hand::Right),
    key("PageDown", 121, 3665, Hand::Right),
    key("ArrowUp", 126, 57416, Hand::Right),
    key("ArrowLeft", 123, 57419, Hand::Right),
    key("ArrowDown", 125, 57424, Hand::Right),
    key("ArrowRight", 124, 57421, Hand::Right),
];

pub fn by_mac_code(mac_code: u16) -> Option<&'static KeyBinding> {
    KEYS.iter().find(|key| key.mac_code == mac_code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn exactly_83_unique_ids_mac_codes_and_uiohook_codes() {
        assert_eq!(KEYS.len(), 83);
        assert_eq!(
            KEYS.iter().map(|key| key.id).collect::<HashSet<_>>().len(),
            83
        );
        assert_eq!(
            KEYS.iter()
                .map(|key| key.mac_code)
                .collect::<HashSet<_>>()
                .len(),
            83
        );
        assert_eq!(
            KEYS.iter()
                .map(|key| key.uiohook_code)
                .collect::<HashSet<_>>()
                .len(),
            83
        );
        for key in &KEYS {
            assert_eq!(by_mac_code(key.mac_code), Some(key));
        }
    }

    #[test]
    fn canonical_ids_hands_and_uiohook_codes_match_the_layout_asset() {
        // This is a fixture check of the repository's fixed, pretty-printed asset,
        // not a runtime JSON parser. It needs no additional serialization crate.
        let layout = include_str!("../../../assets/keyboard.layout.json");
        let values = |field: &str| -> Vec<String> {
            let prefix = format!("\"{field}\":");
            layout
                .lines()
                .filter_map(|line| {
                    line.trim().strip_prefix(&prefix).map(|value| {
                        value
                            .trim()
                            .trim_end_matches(',')
                            .trim_matches('"')
                            .to_owned()
                    })
                })
                .collect()
        };
        let ids = values("id");
        let codes = values("nativeCode");
        let hands = values("hand");
        assert_eq!(ids.len(), KEYS.len());
        assert_eq!(codes.len(), KEYS.len());
        assert_eq!(hands.len(), KEYS.len());
        for (index, key) in KEYS.iter().enumerate() {
            assert_eq!(ids[index], key.id);
            assert_eq!(codes[index].parse::<u16>().unwrap(), key.uiohook_code);
            assert_eq!(
                hands[index],
                match key.hand {
                    Hand::Left => "left",
                    Hand::Right => "right",
                }
            );
        }
    }

    #[test]
    fn mac_codes_are_not_interpreted_as_uiohook_codes() {
        assert_eq!(by_mac_code(0).unwrap().id, "KeyA");
        assert_eq!(by_mac_code(30).unwrap().id, "BracketRight");
        assert_eq!(by_mac_code(41).unwrap().id, "Semicolon");
        assert_eq!(by_mac_code(50).unwrap().id, "Backquote");
        assert_eq!(by_mac_code(57).unwrap().id, "CapsLock");
        assert_eq!(by_mac_code(114).unwrap().id, "Insert");
        assert_eq!(by_mac_code(51).unwrap().id, "Backspace");
        assert_eq!(by_mac_code(117).unwrap().id, "Delete");
    }

    #[test]
    fn modifier_sides_are_distinct() {
        for (code, id) in [
            (55, "MetaLeft"),
            (54, "MetaRight"),
            (56, "ShiftLeft"),
            (60, "ShiftRight"),
            (59, "ControlLeft"),
            (62, "ControlRight"),
            (58, "AltLeft"),
            (61, "AltRight"),
        ] {
            assert_eq!(by_mac_code(code).unwrap().id, id);
        }
    }

    #[test]
    fn unsupported_and_unknown_native_codes_are_rejected() {
        // ISO, Fn/Globe, keypad, media, JIS, context menu, and extra F-keys.
        for code in [
            10,
            63,
            64,
            65,
            67,
            69,
            71,
            72,
            73,
            74,
            75,
            76,
            78,
            79,
            80,
            81,
            82,
            83,
            84,
            85,
            86,
            87,
            88,
            89,
            90,
            91,
            92,
            93,
            94,
            95,
            102,
            104,
            105,
            106,
            107,
            108,
            110,
            112,
            113,
            127,
            128,
            3675,
            u16::MAX,
        ] {
            assert!(by_mac_code(code).is_none(), "unexpectedly allowed {code}");
        }
        assert_eq!(
            (0..=u16::MAX)
                .filter(|code| by_mac_code(*code).is_some())
                .count(),
            83
        );
    }
}
