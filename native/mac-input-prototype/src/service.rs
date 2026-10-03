//! One process-wide listener. Blocking joins run only on Node's async worker pool.
use crate::Sink;
#[cfg(target_os = "macos")]
use std::sync::mpsc;
use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering},
    mpsc::Receiver,
};
use std::thread::JoinHandle;
use std::time::Duration;

static STOP: AtomicBool = AtomicBool::new(false);
static EPOCH: AtomicU64 = AtomicU64::new(0);
static STATUS: AtomicU8 = AtomicU8::new(0);
static OWNER: Mutex<Option<Worker>> = Mutex::new(None);
static RUN_LOOP: OnceLock<Mutex<usize>> = OnceLock::new();
struct Worker {
    join: JoinHandle<()>,
    done: Receiver<()>,
    ticket: u64,
}

pub fn status() -> &'static str {
    match STATUS.load(Ordering::Acquire) {
        0 => "stopped",
        1 => "starting",
        2 => "running",
        3 => "permission_denied",
        4 => "backend_unavailable",
        5 => "tap_create_failed",
        6 => "tap_disabled",
        7 => "queue_overflow",
        8 => "shutdown_timeout",
        9 => "callback_failed",
        10 => "startup_timeout",
        11 => "secure_input",
        _ => "failed",
    }
}
pub(crate) fn set_status(code: u8) {
    STATUS.store(code, Ordering::Release);
}
pub(crate) fn stopping() -> bool {
    STOP.load(Ordering::Acquire)
}

pub fn permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::macos::permission_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
pub fn request_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::macos::request_permission()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub(crate) fn with_run_loop<T>(f: impl FnOnce(&mut usize) -> T) -> T {
    let mut ptr = RUN_LOOP
        .get_or_init(|| Mutex::new(0))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    f(&mut ptr)
}
pub fn reserve_start() -> u64 {
    EPOCH.fetch_add(1, Ordering::AcqRel) + 1
}
pub fn request_stop() -> u64 {
    let ticket = EPOCH.fetch_add(1, Ordering::AcqRel) + 1;
    STOP.store(true, Ordering::Release);
    #[cfg(target_os = "macos")]
    with_run_loop(|ptr| {
        if *ptr != 0 {
            crate::macos::stop_run_loop(*ptr);
        }
    });
    ticket
}
pub fn start(sink: Sink, ticket: u64) -> &'static str {
    let mut owner = OWNER.lock().unwrap_or_else(|e| e.into_inner());
    if owner.as_ref().is_some_and(|w| w.join.is_finished()) {
        if let Some(w) = owner.take() {
            let _ = w.join.join();
        }
    }
    if EPOCH.load(Ordering::Acquire) != ticket {
        return "cancelled";
    }
    if owner.is_some() {
        return "already_started";
    }
    STOP.store(false, Ordering::Release);
    if EPOCH.load(Ordering::Acquire) != ticket {
        STOP.store(true, Ordering::Release);
        return "cancelled";
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = sink;
        set_status(4);
        return status();
    }
    #[cfg(target_os = "macos")]
    {
        if !permission_granted() {
            set_status(3);
            return status();
        }
        set_status(1);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (done_tx, done_rx) = mpsc::sync_channel(1);
        let join = match std::thread::Builder::new()
            .name("whale-mac-input".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::macos::run(sink, ready_tx)
                }));
                if result.is_err() {
                    set_status(9);
                }
                let _ = done_tx.send(());
            }) {
            Ok(join) => join,
            Err(_) => {
                set_status(9);
                return status();
            }
        };
        *owner = Some(Worker {
            join,
            done: done_rx,
            ticket,
        });
        if ready_rx.recv_timeout(Duration::from_secs(5)).is_err() {
            set_status(10);
            request_stop();
        }
        status()
    }
}
pub fn stop(ticket: u64) -> &'static str {
    let mut owner = OWNER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(worker) = owner.as_ref() {
        if worker.ticket > ticket {
            return "stopped";
        }
        if worker.done.recv_timeout(Duration::from_secs(2)).is_err() && !worker.join.is_finished() {
            set_status(8);
            return status();
        }
    }
    if let Some(worker) = owner.take() {
        let _ = worker.join.join();
    }
    if EPOCH.load(Ordering::Acquire) == ticket {
        set_status(0);
    }
    "stopped"
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: Mutex<()> = Mutex::new(());
    #[test]
    fn status_vocabulary_has_no_user_data() {
        let _guard = TEST_LOCK.lock().unwrap();
        for c in 0..12 {
            set_status(c);
            assert!(!status().contains('/'));
        }
        set_status(0);
    }
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_backend_never_claims_permission_or_running() {
        let _guard = TEST_LOCK.lock().unwrap();
        assert!(!permission_granted());
        assert_eq!(
            start(Arc::new(|_, _| true), reserve_start()),
            "backend_unavailable"
        );
        assert_eq!(stop(request_stop()), "stopped");
    }
    use std::sync::Arc;
    #[test]
    fn old_stop_completion_cannot_cancel_a_new_start_ticket() {
        let _guard = TEST_LOCK.lock().unwrap();
        let older_stop = request_stop();
        let newer_start = reserve_start();
        assert_eq!(stop(older_stop), "stopped");
        assert_eq!(EPOCH.load(Ordering::Acquire), newer_start);
        let newer_stop = request_stop();
        assert_eq!(start(Arc::new(|_, _| true), newer_start), "cancelled");
        assert_eq!(stop(newer_stop), "stopped");
    }
    #[test]
    fn timed_out_worker_cannot_be_reenabled_by_another_start() {
        let _guard = TEST_LOCK.lock().unwrap();
        let old_ticket = reserve_start();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let join = std::thread::spawn(move || {
            let _ = release_rx.recv();
            let _ = done_tx.send(());
        });
        *OWNER.lock().unwrap() = Some(Worker {
            join,
            done: done_rx,
            ticket: old_ticket,
        });
        let stop_ticket = request_stop();
        assert_eq!(stop(stop_ticket), "shutdown_timeout");
        assert_eq!(
            start(Arc::new(|_, _| true), reserve_start()),
            "already_started"
        );
        assert!(stopping());
        let _ = release_tx.send(());
        assert_eq!(stop(request_stop()), "stopped");
    }
}
