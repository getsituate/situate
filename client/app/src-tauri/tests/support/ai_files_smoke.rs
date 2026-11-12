use super::*;

pub fn hold_turn(app: &tauri::AppHandle, scope: &str) {
    app.state::<Ai>().active.lock().unwrap().insert(
        RunKey::new(scope, "legacy"),
        Active::new("synthetic-file-closure".into()),
    );
}

pub fn release_turn(app: &tauri::AppHandle, scope: &str) {
    let state = app.state::<Ai>();
    state
        .active
        .lock()
        .unwrap()
        .remove(&RunKey::new(scope, "legacy"));
}

pub fn closing(app: &tauri::AppHandle, scope: &str) -> bool {
    app.state::<Ai>().closing.lock().unwrap().contains(scope)
}
