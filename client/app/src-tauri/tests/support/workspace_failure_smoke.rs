use super::*;

#[tauri::command]
pub fn smoke_close_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let state = app.state::<Workspaces>();
        let inner = state.inner.lock().unwrap();
        let session = inner
            .sessions
            .iter()
            .find(|s| s.location.id == id)
            .ok_or("No open fixture")?;
        let window = app
            .get_webview_window(&session.window)
            .ok_or("No workspace window")?;
        drop(inner);
        window.close().map_err(|e| e.to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, id);
        Err("Mobile sessions have no individual native windows".into())
    }
}

#[tauri::command]
pub async fn smoke_failed_creation(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    parent: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspaces>();
        let mut inner = state.inner.lock().unwrap();
        if !is_entry_window(&inner, window.label()) {
            return Err("Creation failure needs an unoccupied entry window".into());
        }
        let parent_location = inner
            .parents
            .get(&parent)
            .ok_or("No fixture parent")?
            .clone();
        let original = inner.registry.clone();
        let path = inner.path.clone();
        let windows = app.webview_windows().len();
        let sessions = inner.sessions.len();
        inner.path = path.parent().unwrap().to_path_buf();
        let result = act(
            &mut inner,
            &app,
            window.label(),
            "create",
            Some(&parent),
            Some("Retained garden"),
            Some(situate_core::appearance::Accent::Tangerine),
        );
        inner.path = path;
        if result.is_ok()
            || inner.registry != original
            || inner.sessions.len() != sessions
            || app.webview_windows().len() != windows
            || !is_entry_window(&inner, window.label())
        {
            return Err("Failed activation changed window ownership or remembered state".into());
        }
        if Registry::load(&inner.path)? != original {
            return Err("Failed activation changed the durable registry".into());
        }
        let created = situate_core::workspaces::inspect(
            &Path::new(&parent_location.handle).join("Retained garden"),
        )?;
        let appearance =
            situate_core::appearance::Storage::open(Path::new(&created.handle))?.snapshot()?;
        if appearance.accent != situate_core::appearance::Accent::Tangerine
            || appearance.revision.is_none()
        {
            return Err("Failed activation lost the created workspace appearance".into());
        }
        let progress = situate_core::onboarding::OnboardingStorage::open(
            Path::new(&created.handle),
            &created.id,
        )?
        .load()?;
        if !progress.record.is_some_and(|record| {
            record.step == situate_core::onboarding::Step::Access && !record.entered
        }) {
            return Err("Failed activation lost initial onboarding progress".into());
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn verify_combined_closure(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Workspaces>();
    let (id, window, files) = {
        let mut inner = state.inner.lock().unwrap();
        // Mobile command admission follows the most recently selected session.
        let session = inner.sessions.last_mut().ok_or("No open fixture")?;
        let id = session.location.id.clone();
        let window = session.window.clone();
        let files = session.files.clone();
        session.window = "synthetic-unopened-window".into();
        (id, window, files)
    };
    files.close_ready.store(true, Ordering::Release);
    crate::ai::file_smoke::hold_turn(app, &id);
    let deferred = close_session(app, "synthetic-unopened-window", &id);
    state
        .inner
        .lock()
        .unwrap()
        .sessions
        .iter_mut()
        .find(|s| s.location.id == id)
        .ok_or("AI deferral removed the session")?
        .window = window.clone();
    if deferred?
        || files.detached.load(Ordering::Acquire)
        || files.close_ready.load(Ordering::Acquire)
        || !crate::ai::file_smoke::closing(app, &id)
    {
        return Err("AI deferral lost the editor or its confirmation gate".into());
    }
    super::super::files::request_quit(app);
    let blocked = !super::super::files::quit_pending(app);
    crate::ai::file_smoke::release_turn(app, &id);
    if !blocked {
        return Err("Quit started while an AI turn was active".into());
    }
    super::super::files::smoke::verify_quit_gate(app, || {
        if with_current(app, &window, &id, |_| Ok(())).is_ok() {
            return Err("The quit barrier admitted an AI operation".into());
        }
        files.close_ready.store(true, Ordering::Release);
        if close_session(app, &window, &id).is_ok()
            || !state
                .inner
                .lock()
                .unwrap()
                .sessions
                .iter()
                .any(|s| s.location.id == id)
        {
            return Err("Individual closure changed a pending quit participant".into());
        }
        Ok(())
    })?;
    with_current(app, &window, &id, |_| Ok(()))?;
    let (_, session) = file_session(app, &window, &id)?;
    if session.close_ready.load(Ordering::Acquire) || crate::ai::file_smoke::closing(app, &id) {
        return Err("Quit cancellation left an abandoned individual-close gate".into());
    }
    super::super::files::smoke::verify_resumed(&session)?;
    Ok(())
}

#[tauri::command]
pub async fn smoke_failure_cases(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        verify_combined_closure(&app)?;
        let state = app.state::<Workspaces>();
        let mut inner = state.inner.lock().unwrap();
        let original = inner.registry.clone();
        let original_path = inner.path.clone();
        let id = inner
            .sessions
            .first()
            .ok_or("No open fixture")?
            .location
            .id
            .clone();
        // An existing directory makes atomic file replacement fail without touching the real registry.
        inner.path = original_path.parent().unwrap().to_path_buf();
        let participant = inner.sessions.iter().find(|s| s.location.id == id).unwrap();
        let window = participant.window.clone();
        let session = participant.files.clone();
        session.close_ready.store(true, Ordering::Release);
        drop(inner);
        let failed_close = close_session(&app, &window, &id);
        let mut inner = state.inner.lock().unwrap();
        inner.path = original_path;
        if session.detached.load(Ordering::Acquire)
            || session.close_ready.load(Ordering::Acquire)
            || crate::ai::file_smoke::closing(&app, &id)
        {
            return Err("Persistence failure left the editor or AI access closed or paused".into());
        }
        super::super::files::smoke::verify_resumed(&session)?;
        if failed_close.is_ok()
            || inner.registry != original
            || !inner.sessions.iter().any(|s| s.location.id == id)
        {
            return Err("Persistence failure closed a session or changed remembered state".into());
        }
        #[cfg(desktop)]
        {
            let count = inner.sessions.len();
            let saved_counter = inner.next;
            let mut unavailable_window = inner.sessions[0].location.clone();
            unavailable_window.id.push_str("-window-test");
            inner.next = 0;
            let result = open(&mut inner, &app, unavailable_window, true, None);
            inner.next = saved_counter;
            if result.is_ok() || inner.sessions.len() != count || inner.registry != original {
                return Err(
                    "Window creation failure left a phantom session or remembered entry".into(),
                );
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn smoke_unavailable_restore(app: tauri::AppHandle) -> Result<Entry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspaces>();
        let mut inner = state.inner.lock().unwrap();
        let mut unavailable = inner
            .sessions
            .first()
            .ok_or("No open fixture")?
            .location
            .clone();
        if unavailable.kind == "android-tree" || unavailable.kind == "ios-bookmark" {
            return Err("Missing-folder restoration uses application Documents fixtures".into());
        }
        unavailable.id.push_str("-missing");
        unavailable.handle.push_str("-missing");
        unavailable.display.push_str("-missing");
        unavailable.name = "Unavailable test folder".into();
        let result = Entry::from(&unavailable);
        let mut next = inner.registry.clone();
        next.restore.push(unavailable);
        persist(&mut inner, next)?;
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
