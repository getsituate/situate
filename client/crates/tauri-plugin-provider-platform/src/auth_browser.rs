use super::AuthBrowserExit;
#[cfg(mobile)]
use super::{Platform, localized_error};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tokio::sync::oneshot;

struct PendingAttempt {
    id: String,
    sender: oneshot::Sender<AuthBrowserExit>,
}

pub(super) struct Callbacks {
    // Tauri retains mobile channels, so reuse one channel rather than registering one per sign-in.
    events: Channel<serde_json::Value>,
    pending: Arc<Mutex<Option<PendingAttempt>>>,
}

impl Callbacks {
    pub(super) fn new() -> Self {
        let pending: Arc<Mutex<Option<PendingAttempt>>> = Arc::new(Mutex::new(None));
        let target = pending.clone();
        let events = Channel::new(move |body| {
            let Ok(value) = body.deserialize::<serde_json::Value>() else {
                return Ok(());
            };
            let Some(id) = value.get("attemptId").and_then(serde_json::Value::as_str) else {
                return Ok(());
            };
            let outcome = match value.get("kind").and_then(serde_json::Value::as_str) {
                Some("cancelled") => AuthBrowserExit::Cancelled,
                _ => AuthBrowserExit::Failed,
            };
            let sender = {
                let Ok(mut pending) = target.lock() else {
                    return Ok(());
                };
                if pending.as_ref().is_some_and(|p| p.id == id) {
                    pending.take().map(|p| p.sender)
                } else {
                    None
                }
            };
            if let Some(sender) = sender {
                let _ = sender.send(outcome);
            }
            Ok(())
        });
        Self { events, pending }
    }

    fn reserve(&self, id: &str) -> Result<oneshot::Receiver<AuthBrowserExit>, String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "native.ai.browser.openFailed".to_string())?;
        if pending.is_some() {
            return Err("native.ai.browser.busy".into());
        }
        let (sender, receiver) = oneshot::channel();
        *pending = Some(PendingAttempt {
            id: id.into(),
            sender,
        });
        Ok(receiver)
    }

    fn remove(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock()
            && pending.as_ref().is_some_and(|p| p.id == id)
        {
            pending.take();
        }
    }
}

#[cfg(mobile)]
impl Platform {
    pub async fn open_auth_browser(
        &self,
        url: &str,
        attempt_id: &str,
    ) -> Result<oneshot::Receiver<AuthBrowserExit>, String> {
        let receiver = self.1.reserve(attempt_id)?;
        let result = self
            .0
            .run_mobile_plugin_async::<serde_json::Value>(
                "openAuthBrowser",
                serde_json::json!({
                    "url": url, "attemptId": attempt_id, "events": &self.1.events,
                }),
            )
            .await
            .map_err(|e| localized_error(e, "native.ai.browser.openFailed"));
        if let Err(error) = result {
            self.1.remove(attempt_id);
            return Err(error);
        }
        Ok(receiver)
    }

    pub async fn finish_auth_browser(&self, attempt_id: &str) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        let result = self
            .0
            .run_mobile_plugin_async::<serde_json::Value>(
                "finishAuthBrowser",
                serde_json::json!({"attemptId":attempt_id}),
            )
            .await
            .map(|_| ())
            .map_err(|e| localized_error(e, "native.ai.browser.openFailed"));
        #[cfg(target_os = "android")]
        let result = {
            let id = attempt_id.to_owned();
            tauri::async_runtime::spawn_blocking(move || super::android_finish::finish(&id))
                .await
                .unwrap_or_else(|_| Err("native.ai.browser.openFailed".into()))
        };
        #[cfg(target_os = "ios")]
        if result.is_err() {
            return result;
        }
        self.1.remove(attempt_id);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_events_and_finish_cannot_cancel_the_current_owner() {
        let callbacks = Callbacks::new();
        let mut first = callbacks.reserve("first").unwrap();
        assert!(
            matches!(callbacks.reserve("second"), Err(error) if error == "native.ai.browser.busy")
        );
        callbacks.remove("stale");
        callbacks
            .events
            .send(serde_json::json!({"attemptId":"stale","kind":"cancelled"}))
            .unwrap();
        assert!(matches!(
            first.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        callbacks
            .events
            .send(serde_json::json!({"attemptId":"first","kind":"cancelled"}))
            .unwrap();
        assert_eq!(first.try_recv().unwrap(), AuthBrowserExit::Cancelled);
        let mut second = callbacks.reserve("second").unwrap();
        callbacks.remove("first");
        callbacks
            .events
            .send(serde_json::json!({"attemptId":"first","kind":"failed"}))
            .unwrap();
        assert!(matches!(
            second.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        callbacks.remove("second");
        assert!(matches!(
            second.try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
    }

    #[test]
    fn native_messages_cannot_report_provider_success() {
        let callbacks = Callbacks::new();
        let mut result = callbacks.reserve("synthetic").unwrap();
        callbacks
            .events
            .send(serde_json::json!({"attemptId":"synthetic","kind":"success"}))
            .unwrap();
        assert_eq!(result.try_recv().unwrap(), AuthBrowserExit::Failed);
    }
}
