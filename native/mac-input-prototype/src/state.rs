//! Bounded, current physical-input state, independent of the OS and Node runtime.
//!
//! The only key ordering retained is the order of *currently held* keys. It is
//! used to choose each hand's latest target; published keys use the fixed layout
//! order instead. There is no typed text, released-key history, or event payload.

use crate::keys::{Hand, KEYS, KeyBinding, by_mac_code};
use serde::Serialize;

const MAX_PRESSED_KEYS: usize = 32;
const MOUSE_RECENT_MS: u64 = 700;
const WHEEL_PULSE_MS: u64 = 180;
const MISSES_TO_RELEASE: u8 = 2;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Snapshot {
    pub pressed: Vec<&'static str>,
    pub mouse: Mouse,
    pub targets: Targets,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Mouse {
    pub x: f64,
    pub y: f64,
    pub buttons: Buttons,
    pub wheel: Wheel,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Buttons {
    pub left: bool,
    pub right: bool,
    pub middle: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Wheel {
    pub x: i8,
    pub y: i8,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Targets {
    pub left: Option<&'static str>,
    pub right: Option<&'static str>,
    pub keyboard: Option<&'static str>,
}

#[derive(Debug)]
struct HeldKey {
    binding: &'static KeyBinding,
    missing: u8,
}

#[derive(Debug, Default)]
pub struct State {
    held: Vec<HeldKey>,
    x: f64,
    y: f64,
    has_position: bool,
    mouse_until: u64,
    // CoreGraphics numbering: left = 0, right = 1, middle = 2.
    buttons: [bool; 3],
    button_missing: [u8; 3],
    wheel: Wheel,
    wheel_until: u64,
}

impl State {
    pub fn new() -> Self {
        Self::default()
    }

    /// Native repeat-down confirms physical presence, but never reorders keys
    /// or changes mouse arbitration. Only an actual new down changes a target.
    pub fn key_down(&mut self, native_code: u16) -> bool {
        let Some(binding) = by_mac_code(native_code) else {
            return false;
        };
        if let Some(held) = self
            .held
            .iter_mut()
            .find(|key| key.binding.mac_code == native_code)
        {
            held.missing = 0;
            return false;
        }
        if self.held.len() >= MAX_PRESSED_KEYS {
            return false;
        }
        self.held.push(HeldKey {
            binding,
            missing: 0,
        });
        if binding.hand == Hand::Right {
            self.mouse_until = 0;
        }
        true
    }

    pub fn key_up(&mut self, native_code: u16) -> bool {
        let Some(index) = self
            .held
            .iter()
            .position(|key| key.binding.mac_code == native_code)
        else {
            return false;
        };
        // Remove rather than swap_remove: still-held insertion order matters.
        self.held.remove(index);
        true
    }

    pub fn mouse_move(&mut self, x: f64, y: f64, now_ms: u64) -> bool {
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        let x = x.clamp(-1.0, 1.0);
        let y = y.clamp(-1.0, 1.0);
        if self.has_position && self.x == x && self.y == y {
            return false;
        }
        self.x = x;
        self.y = y;
        self.has_position = true;
        self.mouse_until = now_ms.saturating_add(MOUSE_RECENT_MS);
        true
    }

    /// Only the three supported CoreGraphics buttons can enter state. Native
    /// duplicates clear reconciliation misses without creating a state change.
    pub fn button(&mut self, button: u8, down: bool) -> bool {
        let index = usize::from(button);
        let Some(held) = self.buttons.get_mut(index) else {
            return false;
        };
        self.button_missing[index] = 0;
        let changed = *held != down;
        *held = down;
        changed
    }

    pub fn wheel(&mut self, dx: f64, dy: f64, now_ms: u64) -> bool {
        if !dx.is_finite() || !dy.is_finite() || (dx == 0.0 && dy == 0.0) {
            return false;
        }
        fn sign(value: f64) -> i8 {
            if value < 0.0 {
                -1
            } else if value > 0.0 {
                1
            } else {
                0
            }
        }
        self.wheel = Wheel {
            x: sign(dx),
            y: sign(dy),
        };
        self.wheel_until = now_ms.saturating_add(WHEEL_PULSE_MS);
        // Preserve the legacy wheel arbitration window, including shortening
        // an existing mouse-move window to the duration of this wheel pulse.
        self.mouse_until = self.wheel_until;
        true
    }

    pub fn snapshot(&mut self, now_ms: u64) -> Snapshot {
        if now_ms >= self.wheel_until {
            self.wheel = Wheel::default();
            self.wheel_until = 0;
        }
        if now_ms >= self.mouse_until {
            self.mouse_until = 0;
        }
        let mut targets = Targets::default();
        for key in &self.held {
            targets.keyboard = Some(key.binding.id);
            match key.binding.hand {
                Hand::Left => targets.left = Some(key.binding.id),
                Hand::Right => targets.right = Some(key.binding.id),
            }
        }
        if self.buttons.iter().any(|down| *down) || self.mouse_until > now_ms {
            targets.right = Some("mouse");
        }
        Snapshot {
            pressed: KEYS
                .iter()
                .filter(|binding| {
                    self.held
                        .iter()
                        .any(|key| key.binding.mac_code == binding.mac_code)
                })
                .map(|binding| binding.id)
                .collect(),
            mouse: Mouse {
                x: self.x,
                y: self.y,
                buttons: Buttons {
                    left: self.buttons[0],
                    right: self.buttons[1],
                    middle: self.buttons[2],
                },
                wheel: self.wheel,
            },
            targets,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    pub fn held_native_codes(&self) -> Vec<u16> {
        self.held.iter().map(|key| key.binding.mac_code).collect()
    }

    pub fn held_buttons(&self) -> Vec<u8> {
        (0..3)
            .filter(|button| self.buttons[usize::from(*button)])
            .collect()
    }

    /// Ask only about current candidates, never scan the keyboard or synthesize
    /// missed downs. Two consecutive negative reads repair a lost native up.
    pub fn reconcile_held(&mut self, mut is_down: impl FnMut(u16) -> bool) -> bool {
        let count = self.held.len();
        self.held.retain_mut(|key| {
            key.missing = if is_down(key.binding.mac_code) {
                0
            } else {
                key.missing + 1
            };
            key.missing < MISSES_TO_RELEASE
        });
        self.held.len() != count
    }

    pub fn reconcile_buttons(&mut self, mut is_down: impl FnMut(u8) -> bool) -> bool {
        let mut changed = false;
        for button in 0..3 {
            let index = usize::from(button);
            if !self.buttons[index] {
                continue;
            }
            self.button_missing[index] = if is_down(button) {
                0
            } else {
                self.button_missing[index] + 1
            };
            if self.button_missing[index] >= MISSES_TO_RELEASE {
                self.buttons[index] = false;
                self.button_missing[index] = 0;
                changed = true;
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(id: &str) -> u16 {
        KEYS.iter().find(|key| key.id == id).unwrap().mac_code
    }

    fn down(state: &mut State, id: &str) {
        assert!(state.key_down(key(id)), "expected a new down for {id}");
    }

    #[test]
    fn empty_snapshot_matches_the_exact_public_contract() {
        let snapshot = State::new().snapshot(0);
        assert_eq!(snapshot.pressed, Vec::<&str>::new());
        assert_eq!(snapshot.targets, Targets::default());
        assert_eq!(snapshot.mouse.x, 0.0);
        assert_eq!(snapshot.mouse.y, 0.0);
        assert_eq!(snapshot.mouse.buttons, Buttons::default());
        assert_eq!(snapshot.mouse.wheel, Wheel::default());
        // Serialization exposes no deadlines, timestamps, native codes, text,
        // sequence counters, reconciliation evidence, or released-key history.
        assert_eq!(
            serde_json::to_string(&snapshot).unwrap(),
            r#"{"pressed":[],"mouse":{"x":0.0,"y":0.0,"buttons":{"left":false,"right":false,"middle":false},"wheel":{"x":0,"y":0}},"targets":{"left":null,"right":null,"keyboard":null}}"#
        );
        assert_eq!(State::default().snapshot(123), snapshot);
    }

    #[test]
    fn every_native_key_has_the_expected_canonical_identity_and_hand() {
        assert_eq!(KEYS.len(), 83);
        let mut state = State::new();
        for binding in &KEYS {
            assert!(state.key_down(binding.mac_code));
            let snapshot = state.snapshot(1_000);
            assert_eq!(snapshot.pressed, vec![binding.id]);
            assert_eq!(snapshot.targets.keyboard, Some(binding.id));
            assert_eq!(
                snapshot.targets.left,
                (binding.hand == Hand::Left).then_some(binding.id)
            );
            assert_eq!(
                snapshot.targets.right,
                (binding.hand == Hand::Right).then_some(binding.id)
            );
            assert_eq!(state.held_native_codes(), vec![binding.mac_code]);
            assert!(state.key_up(binding.mac_code));
            assert_eq!(state.snapshot(1_000).targets, Targets::default());
            assert!(state.held_native_codes().is_empty());
        }
    }

    #[test]
    fn snapshots_use_layout_order_not_down_order_for_all_83_keys() {
        for group in KEYS.chunks(MAX_PRESSED_KEYS) {
            let mut state = State::new();
            for binding in group.iter().rev() {
                assert!(state.key_down(binding.mac_code));
            }
            assert_eq!(
                state.snapshot(0).pressed,
                group.iter().map(|binding| binding.id).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn unsupported_keys_and_spurious_ups_do_not_change_state() {
        let mut state = State::new();
        down(&mut state, "KeyA");
        let before = state.snapshot(0);
        for native in [10, 63, 64, 65, 76, 82, 95, 127, 128, 3675, u16::MAX] {
            assert!(!state.key_down(native));
            assert!(!state.key_up(native));
        }
        assert!(!state.key_up(key("KeyB")));
        assert_eq!(state.snapshot(0), before);
    }

    #[test]
    fn cap_32_rejects_new_keys_without_evicting_or_reordering_held_keys() {
        let mut state = State::new();
        for binding in &KEYS[..MAX_PRESSED_KEYS] {
            assert!(state.key_down(binding.mac_code));
        }
        let before = state.snapshot(0);
        for binding in &KEYS[MAX_PRESSED_KEYS..] {
            assert!(!state.key_down(binding.mac_code));
        }
        assert!(!state.key_down(KEYS[0].mac_code));
        assert_eq!(state.snapshot(0), before);
        assert!(state.key_up(KEYS[0].mac_code));
        assert!(state.key_down(KEYS[MAX_PRESSED_KEYS].mac_code));
        assert_eq!(state.snapshot(0).pressed.len(), MAX_PRESSED_KEYS);
        assert_eq!(
            state.snapshot(0).targets.keyboard,
            Some(KEYS[MAX_PRESSED_KEYS].id)
        );
    }

    #[test]
    fn chords_and_modifier_sides_have_independent_latest_targets() {
        let mut state = State::new();
        for id in ["MetaLeft", "KeyA", "MetaRight", "KeyJ"] {
            down(&mut state, id);
        }
        let snapshot = state.snapshot(0);
        assert_eq!(
            snapshot.pressed,
            vec!["KeyA", "KeyJ", "MetaLeft", "MetaRight"]
        );
        assert_eq!(
            snapshot.targets,
            Targets {
                left: Some("KeyA"),
                right: Some("KeyJ"),
                keyboard: Some("KeyJ")
            }
        );
        assert!(state.key_up(key("KeyJ")));
        assert_eq!(
            state.snapshot(0).targets,
            Targets {
                left: Some("KeyA"),
                right: Some("MetaRight"),
                keyboard: Some("MetaRight")
            }
        );
        assert!(state.key_up(key("MetaRight")));
        assert_eq!(state.snapshot(0).targets.keyboard, Some("KeyA"));
        assert!(state.key_up(key("KeyA")));
        assert_eq!(state.snapshot(0).targets.left, Some("MetaLeft"));
    }

    #[test]
    fn repeat_does_not_reorder_or_override_mouse_but_repress_does() {
        let mut state = State::new();
        down(&mut state, "KeyJ");
        down(&mut state, "KeyK");
        assert!(state.mouse_move(0.5, 0.2, 100));
        assert!(!state.key_down(key("KeyJ")));
        let snapshot = state.snapshot(100);
        assert_eq!(snapshot.targets.right, Some("mouse"));
        assert_eq!(snapshot.targets.keyboard, Some("KeyK"));
        assert_eq!(state.held_native_codes(), vec![key("KeyJ"), key("KeyK")]);
        assert!(state.key_up(key("KeyJ")));
        down(&mut state, "KeyJ");
        assert_eq!(state.snapshot(100).targets.right, Some("KeyJ"));
        assert_eq!(state.snapshot(100).targets.keyboard, Some("KeyJ"));
        assert_eq!(state.held_native_codes(), vec![key("KeyK"), key("KeyJ")]);
    }

    #[test]
    fn releasing_an_older_key_preserves_the_latest_held_key() {
        let mut state = State::new();
        for id in ["KeyA", "KeyS", "KeyD"] {
            down(&mut state, id);
        }
        assert!(state.key_up(key("KeyA")));
        assert_eq!(state.snapshot(0).targets.keyboard, Some("KeyD"));
        assert_eq!(state.held_native_codes(), vec![key("KeyS"), key("KeyD")]);
    }

    #[test]
    fn held_keys_do_not_expire_from_elapsed_time() {
        let mut state = State::new();
        down(&mut state, "MetaLeft");
        down(&mut state, "KeyA");
        let snapshot = state.snapshot(0);
        assert_eq!(state.snapshot(u64::MAX), snapshot);
    }

    #[test]
    fn reconciliation_queries_only_held_keys_and_releases_after_two_misses() {
        let mut state = State::new();
        assert!(!state.reconcile_held(|_| panic!("empty state must not scan")));
        down(&mut state, "KeyA");
        down(&mut state, "KeyJ");
        let mut queried = Vec::new();
        assert!(!state.reconcile_held(|code| {
            queried.push(code);
            code == key("KeyA")
        }));
        assert_eq!(queried, vec![key("KeyA"), key("KeyJ")]);
        assert_eq!(state.snapshot(0).pressed, vec!["KeyA", "KeyJ"]);
        assert!(state.reconcile_held(|code| code == key("KeyA")));
        assert_eq!(state.snapshot(0).pressed, vec!["KeyA"]);
        assert_eq!(state.snapshot(0).targets.keyboard, Some("KeyA"));
        assert!(!state.reconcile_held(|code| {
            assert_eq!(code, key("KeyA"));
            true
        }));
    }

    #[test]
    fn reconciliation_requires_consecutive_misses_and_native_repeat_resets_them() {
        let mut state = State::new();
        down(&mut state, "KeyA");
        assert!(!state.reconcile_held(|_| false));
        assert!(!state.reconcile_held(|_| true));
        assert!(!state.reconcile_held(|_| false));
        assert!(!state.key_down(key("KeyA")));
        assert!(!state.reconcile_held(|_| false));
        assert!(state.reconcile_held(|_| false));
        assert!(state.held_native_codes().is_empty());
        down(&mut state, "KeyA");
        assert!(!state.reconcile_held(|_| false));
        assert!(state.key_up(key("KeyA")));
        down(&mut state, "KeyA");
        assert!(!state.reconcile_held(|_| false));
        assert!(state.reconcile_held(|_| false));
    }

    #[test]
    fn reconciliation_keeps_surviving_key_order_and_removes_all_missing_keys() {
        let mut state = State::new();
        for id in ["KeyA", "KeyS", "KeyD", "KeyJ"] {
            down(&mut state, id);
        }
        for expected in [false, true] {
            assert_eq!(
                state.reconcile_held(|code| code == key("KeyS") || code == key("KeyJ")),
                expected
            );
        }
        assert_eq!(state.held_native_codes(), vec![key("KeyS"), key("KeyJ")]);
        assert_eq!(
            state.snapshot(0).targets,
            Targets {
                left: Some("KeyS"),
                right: Some("KeyJ"),
                keyboard: Some("KeyJ")
            }
        );
        assert!(!state.reconcile_held(|_| false));
        assert!(state.reconcile_held(|_| false));
        assert_eq!(state.snapshot(0).targets, Targets::default());
    }

    #[test]
    fn initial_mouse_position_counts_but_duplicate_normalized_positions_do_not() {
        let mut state = State::new();
        assert!(state.mouse_move(0.0, 0.0, 100));
        assert_eq!(state.snapshot(100).targets.right, Some("mouse"));
        assert!(!state.mouse_move(0.0, 0.0, 799));
        assert_eq!(state.snapshot(799).targets.right, Some("mouse"));
        assert_eq!(state.snapshot(800).targets.right, None);
        assert!(state.mouse_move(5.0, -5.0, 1_000));
        assert!(!state.mouse_move(3.0, -3.0, 1_699));
        let snapshot = state.snapshot(1_700);
        assert_eq!((snapshot.mouse.x, snapshot.mouse.y), (1.0, -1.0));
        assert_eq!(snapshot.targets.right, None);
    }

    #[test]
    fn non_finite_mouse_and_wheel_input_is_rejected_without_mutation() {
        let mut state = State::new();
        assert!(state.mouse_move(0.5, -0.5, 10));
        assert!(state.wheel(1.0, -1.0, 10));
        let before = state.snapshot(10);
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(!state.mouse_move(bad, 0.0, 10));
            assert!(!state.mouse_move(0.0, bad, 10));
            assert!(!state.wheel(bad, 0.0, 10));
            assert!(!state.wheel(0.0, bad, 10));
        }
        assert!(!state.wheel(0.0, -0.0, 10));
        assert_eq!(state.snapshot(10), before);
    }

    #[test]
    fn mouse_deadline_is_700_ms_and_does_not_replace_keyboard_target() {
        let mut state = State::new();
        down(&mut state, "KeyJ");
        down(&mut state, "KeyA");
        assert!(state.mouse_move(0.1, 0.2, 1_000));
        let snapshot = state.snapshot(1_699);
        assert_eq!(
            snapshot.targets,
            Targets {
                left: Some("KeyA"),
                right: Some("mouse"),
                keyboard: Some("KeyA")
            }
        );
        assert_eq!(state.snapshot(1_700).targets.right, Some("KeyJ"));
        assert!(state.mouse_move(0.2, 0.2, 2_000));
        down(&mut state, "KeyS");
        assert_eq!(state.snapshot(2_000).targets.right, Some("mouse"));
        down(&mut state, "KeyK");
        assert_eq!(state.snapshot(2_000).targets.right, Some("KeyK"));
    }

    #[test]
    fn all_three_buttons_override_right_hand_until_released() {
        let mut state = State::new();
        down(&mut state, "KeyJ");
        for button in [2, 0, 1] {
            assert!(state.button(button, true));
            assert!(!state.button(button, true));
        }
        assert_eq!(state.held_buttons(), vec![0, 1, 2]);
        assert_eq!(
            state.snapshot(100_000).mouse.buttons,
            Buttons {
                left: true,
                right: true,
                middle: true
            }
        );
        assert_eq!(state.snapshot(100_000).targets.right, Some("mouse"));
        down(&mut state, "KeyK");
        assert_eq!(state.snapshot(100_000).targets.right, Some("mouse"));
        assert_eq!(state.snapshot(100_000).targets.keyboard, Some("KeyK"));
        for button in [0, 1] {
            assert!(state.button(button, false));
            assert!(!state.button(button, false));
            assert_eq!(state.snapshot(100_000).targets.right, Some("mouse"));
        }
        assert!(state.button(2, false));
        assert_eq!(state.snapshot(100_000).targets.right, Some("KeyK"));
        assert!(state.held_buttons().is_empty());
    }

    #[test]
    fn button_events_do_not_start_or_extend_a_movement_deadline() {
        let mut state = State::new();
        assert!(state.button(0, true));
        assert!(state.button(0, false));
        assert_eq!(state.snapshot(0).targets.right, None);
        assert!(state.mouse_move(0.0, 0.0, 100));
        assert!(state.button(1, true));
        assert!(state.button(1, false));
        assert_eq!(state.snapshot(799).targets.right, Some("mouse"));
        assert_eq!(state.snapshot(800).targets.right, None);
    }

    #[test]
    fn invalid_buttons_cannot_mutate_or_be_reconciled() {
        let mut state = State::new();
        let before = state.snapshot(0);
        for button in 3..=u8::MAX {
            assert!(!state.button(button, true));
            assert!(!state.button(button, false));
        }
        assert!(!state.reconcile_buttons(|_| panic!("empty state must not scan")));
        assert_eq!(state.snapshot(0), before);
    }

    #[test]
    fn button_reconciliation_is_held_only_and_requires_two_consecutive_misses() {
        let mut state = State::new();
        assert!(state.button(0, true));
        assert!(state.button(2, true));
        let mut queried = Vec::new();
        assert!(!state.reconcile_buttons(|button| {
            queried.push(button);
            button == 0
        }));
        assert_eq!(queried, vec![0, 2]);
        assert_eq!(state.held_buttons(), vec![0, 2]);
        assert!(state.reconcile_buttons(|button| button == 0));
        assert_eq!(state.held_buttons(), vec![0]);
        assert!(!state.reconcile_buttons(|_| false));
        assert!(!state.reconcile_buttons(|_| true));
        assert!(!state.reconcile_buttons(|_| false));
        assert!(!state.button(0, true));
        assert!(!state.reconcile_buttons(|_| false));
        assert!(state.reconcile_buttons(|_| false));
        assert!(state.held_buttons().is_empty());
        assert!(state.button(0, true));
        assert!(!state.reconcile_buttons(|_| false));
        assert!(state.button(0, false));
        assert!(state.button(0, true));
        assert!(!state.reconcile_buttons(|_| false));
        assert!(state.reconcile_buttons(|_| false));
    }

    #[test]
    fn wheel_sign_pulse_expires_at_180_ms_and_preserves_keyboard() {
        let mut state = State::new();
        down(&mut state, "KeyJ");
        assert!(state.wheel(4.5, -999.0, 1_000));
        let snapshot = state.snapshot(1_179);
        assert_eq!(snapshot.mouse.wheel, Wheel { x: 1, y: -1 });
        assert_eq!(snapshot.targets.right, Some("mouse"));
        assert_eq!(snapshot.targets.keyboard, Some("KeyJ"));
        let snapshot = state.snapshot(1_180);
        assert_eq!(snapshot.mouse.wheel, Wheel::default());
        assert_eq!(snapshot.targets.right, Some("KeyJ"));
    }

    #[test]
    fn new_wheel_events_replace_axes_and_refresh_but_do_not_accumulate() {
        let mut state = State::new();
        assert!(state.wheel(1.0, -1.0, 0));
        assert!(state.wheel(-0.01, 0.0, 100));
        assert_eq!(state.snapshot(180).mouse.wheel, Wheel { x: -1, y: 0 });
        assert!(!state.wheel(0.0, 0.0, 279));
        assert_eq!(state.snapshot(280).mouse.wheel, Wheel::default());
        assert!(state.wheel(0.0, 0.1, 300));
        assert_eq!(state.snapshot(300).mouse.wheel, Wheel { x: 0, y: 1 });
    }

    #[test]
    fn wheel_and_movement_preserve_legacy_right_hand_arbitration() {
        let mut state = State::new();
        down(&mut state, "KeyJ");
        assert!(state.mouse_move(0.0, 0.0, 1_000));
        assert!(state.wheel(0.0, 1.0, 1_100));
        assert_eq!(state.snapshot(1_279).targets.right, Some("mouse"));
        assert_eq!(state.snapshot(1_280).targets.right, Some("KeyJ"));
        assert!(state.wheel(0.0, 1.0, 2_000));
        assert!(state.mouse_move(0.1, 0.0, 2_100));
        let snapshot = state.snapshot(2_180);
        assert_eq!(snapshot.mouse.wheel, Wheel::default());
        assert_eq!(snapshot.targets.right, Some("mouse"));
        assert_eq!(state.snapshot(2_800).targets.right, Some("KeyJ"));
        assert!(state.wheel(0.0, 1.0, 3_000));
        down(&mut state, "KeyK");
        let snapshot = state.snapshot(3_000);
        assert_eq!(snapshot.mouse.wheel, Wheel { x: 0, y: 1 });
        assert_eq!(snapshot.targets.right, Some("KeyK"));
    }

    #[test]
    fn deadline_arithmetic_saturates_without_wrapping_or_panicking() {
        let mut state = State::new();
        assert!(state.mouse_move(0.0, 0.0, u64::MAX - 1));
        assert_eq!(state.snapshot(u64::MAX - 1).targets.right, Some("mouse"));
        assert_eq!(state.snapshot(u64::MAX).targets.right, None);
        assert!(state.wheel(1.0, 1.0, u64::MAX - 1));
        assert_eq!(
            state.snapshot(u64::MAX - 1).mouse.wheel,
            Wheel { x: 1, y: 1 }
        );
        assert_eq!(state.snapshot(u64::MAX).mouse.wheel, Wheel::default());
    }

    #[test]
    fn reset_clears_all_keys_buttons_mouse_pulses_and_reconciliation_evidence() {
        let mut state = State::new();
        down(&mut state, "KeyA");
        down(&mut state, "KeyJ");
        assert!(state.mouse_move(0.5, -0.5, 100));
        assert!(state.button(0, true));
        assert!(state.button(2, true));
        assert!(state.wheel(-1.0, 1.0, 100));
        assert!(!state.reconcile_held(|_| false));
        assert!(!state.reconcile_buttons(|_| false));
        state.reset();
        assert_eq!(state.snapshot(100), State::new().snapshot(100));
        assert!(state.held_native_codes().is_empty());
        assert!(state.held_buttons().is_empty());
        assert!(!state.reconcile_held(|_| panic!("reset keys")));
        assert!(!state.reconcile_buttons(|_| panic!("reset buttons")));
        down(&mut state, "KeyA");
        assert!(state.button(0, true));
        assert!(!state.reconcile_held(|_| false));
        assert!(!state.reconcile_buttons(|_| false));
        assert!(state.mouse_move(0.0, 0.0, 100));
        state.reset();
        state.reset();
        assert_eq!(state.snapshot(100), State::new().snapshot(100));
    }

    #[test]
    fn returned_snapshots_and_held_lists_do_not_alias_mutable_state() {
        let mut state = State::new();
        down(&mut state, "KeyA");
        assert!(state.button(0, true));
        let mut snapshot = state.snapshot(0);
        snapshot.pressed.clear();
        snapshot.mouse.buttons.left = false;
        let mut keys = state.held_native_codes();
        keys.clear();
        let mut buttons = state.held_buttons();
        buttons.clear();
        assert_eq!(state.snapshot(0).pressed, vec!["KeyA"]);
        assert!(state.snapshot(0).mouse.buttons.left);
    }
}
