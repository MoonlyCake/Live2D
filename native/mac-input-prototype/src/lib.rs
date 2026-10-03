//! Experimental in-process Node-API backend. Not imported by the production app.
mod keys;
#[cfg(target_os = "macos")]
mod macos;
mod service;
mod state;

use napi::{
    Env, JsFunction, JsString, Result, Task,
    bindgen_prelude::AsyncTask,
    threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub type Sink = Arc<dyn Fn(String, bool) -> bool + Send + Sync>;

#[napi]
pub fn permission_granted() -> bool {
    service::permission_granted()
}

/// Only an explicit, user-initiated authorization control may call this function.
/// The prototype smoke and all automatic recovery paths deliberately never call it.
#[napi]
pub fn request_permission() -> bool {
    service::request_permission()
}

#[napi]
pub fn service_status() -> String {
    service::status().into()
}

pub struct StartTask {
    sink: Option<Sink>,
    ticket: u64,
}
impl Task for StartTask {
    type Output = String;
    type JsValue = JsString;
    fn compute(&mut self) -> Result<String> {
        Ok(service::start(self.sink.take().expect("one start task"), self.ticket).into())
    }
    fn resolve(&mut self, env: Env, result: String) -> Result<JsString> {
        env.create_string(&result)
    }
}

#[napi]
pub fn start(mut env: Env, callback: JsFunction) -> Result<AsyncTask<StartTask>> {
    let mut tsfn: ThreadsafeFunction<String> = callback
        .create_threadsafe_function(128, |ctx: ThreadSafeCallContext<String>| {
            Ok(vec![ctx.env.create_string(&ctx.value)?])
        })?;
    // A listener must never prevent app shutdown; the cleanup hook requests native teardown.
    tsfn.unref(&env)?;
    let live = Arc::new(AtomicBool::new(true));
    let cleanup_live = live.clone();
    env.add_env_cleanup_hook((), move |_| {
        cleanup_live.store(false, Ordering::Release);
        service::request_stop();
    })?;
    let sink: Sink = Arc::new(move |message, final_packet| {
        live.load(Ordering::Acquire)
            && tsfn.call(
                Ok(message),
                if final_packet {
                    ThreadsafeFunctionCallMode::Blocking
                } else {
                    ThreadsafeFunctionCallMode::NonBlocking
                },
            ) == napi::Status::Ok
    });
    Ok(AsyncTask::new(StartTask {
        sink: Some(sink),
        ticket: service::reserve_start(),
    }))
}

pub struct StopTask {
    ticket: u64,
}
impl Task for StopTask {
    type Output = String;
    type JsValue = JsString;
    fn compute(&mut self) -> Result<String> {
        Ok(service::stop(self.ticket).into())
    }
    fn resolve(&mut self, env: Env, result: String) -> Result<JsString> {
        env.create_string(&result)
    }
}
#[napi]
pub fn stop() -> AsyncTask<StopTask> {
    let ticket = service::request_stop();
    AsyncTask::new(StopTask { ticket })
}
