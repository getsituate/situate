use super::*;

pub fn verify_resumed(session: &Session) -> Result<(), String> {
    let mut content = session.inner.lock().map_err(err)?;
    require_active(session, &content)?;
    let store = content
        .store
        .as_mut()
        .ok_or("Registry failure dropped the live content store")?;
    let version = store.read_text("native-editor.md").map_err(err)?;
    if !matches!(
        store
            .save("native-editor.md", &version, &version.text)
            .map_err(err)?,
        SaveOutcome::Saved { .. }
    ) {
        return Err("The editor could not save after registry persistence failed".into());
    }
    Ok(())
}

pub fn verify_quit_gate(
    app: &tauri::AppHandle,
    check: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let token = "synthetic-quit-admission";
    let quit = app.state::<Quit>();
    let window = super::super::workspaces::with_file_participants(app, |participants| {
        let window = participants.keys().next().cloned().unwrap();
        *quit.pending.lock().unwrap() = Some(QuitAttempt {
            token: token.into(),
            participants,
            ready: HashSet::new(),
        });
        window
    });
    request_quit(app);
    let result = check();
    cancel_quit(app, &window, token)?;
    result?;
    quit.approved.store(true, Ordering::Release);
    request_quit(app);
    let blocked = quit_pending(app) && quit.pending.lock().unwrap().is_none();
    quit.approved.store(false, Ordering::Release);
    if !blocked {
        return Err("Approved quit admitted another attempt".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn smoke_recovery_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    workspace_id: String,
    action: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if app.config().identifier != "dev.situate.client.smoke" {
            return Err("Recovery smoke access requires the isolated test application.".into());
        }
        let (_, session) =
            super::super::workspaces::file_session(&app, window.label(), &workspace_id)?;
        let content = session.inner.lock().map_err(err)?;
        let root = content
            .root
            .as_ref()
            .ok_or("The recovery workspace is not local storage.")?;
        let data = app.path().app_data_dir().map_err(err)?;
        if !root
            .canonicalize()
            .map_err(err)?
            .starts_with(data.canonicalize().map_err(err)?)
        {
            return Err("Recovery smoke access requires an owned workspace.".into());
        }
        let path = root.join("native-editor.md");
        let manifest_path = root.join(".situate/smoke-recovery.json");
        if action == "inspect" && !manifest_path.exists() {
            return Ok(serde_json::Value::Null);
        }
        if action == "protect" {
            let original = std::fs::read_to_string(&path).map_err(err)?;
            let text = format!("{original}\n  Unsaved recovery: café 👋\nSecond line\t  \n");
            let manifest = serde_json::json!({ "original": original, "text": text });
            std::fs::write(&manifest_path, manifest.to_string()).map_err(err)?;
            let mut permissions = std::fs::metadata(&path).map_err(err)?.permissions();
            permissions.set_readonly(true);
            std::fs::set_permissions(&path, permissions).map_err(err)?;
            return Ok(manifest);
        }
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(manifest_path).map_err(err)?).map_err(err)?;
        if std::fs::read(&path).map_err(err)?
            != manifest["original"]
                .as_str()
                .ok_or("Missing original text")?
                .as_bytes()
        {
            return Err("Recovery changed the original disk bytes.".into());
        }
        let drafts = situate_core::content::read_recovery_drafts(root).map_err(err)?;
        if !drafts.iter().any(|draft| {
            draft.path == "native-editor.md"
                && Some(draft.text.as_str()) == manifest["text"].as_str()
        }) {
            return Err("The exact recovery text was not durably staged.".into());
        }
        match action.as_str() {
            "inspect" => Ok(manifest),
            "acknowledge" => {
                use std::io::Write;
                println!(
                    "SITUATE_NATIVE_SMOKE {}",
                    serde_json::json!({ "passed": true, "recoveryStaged": true })
                );
                std::io::stdout().flush().map_err(err)?;
                Ok(manifest)
            }
            _ => Err("Unknown recovery smoke action".into()),
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn smoke_reference_fixture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    workspace_id: String,
    action: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        if app.config().identifier != "dev.situate.client.smoke" {
            return Err("Reference fixtures require the isolated test application.".into());
        }
        let (location, session) =
            super::super::workspaces::file_session(&app, window.label(), &workspace_id)?;
        if !location.name.starts_with("Garden-") && !location.name.starts_with("Reading-") {
            return Err("Reference fixtures require a disposable test workspace.".into());
        }
        let content = session.inner.lock().map_err(err)?;
        let root = content
            .root
            .as_ref()
            .ok_or("The reference workspace is not local.")?;
        let directory = root.join(".situate/conversations/native-references");
        for entry in std::fs::read_dir(root.join(".situate")).map_err(err)? {
            let name = entry.map_err(err)?.file_name();
            let name = name.to_string_lossy();
            if matches!(
                name.as_ref(),
                "reference-moves.json" | "reference-moves-head.json"
            ) || name.starts_with("reference-witness-")
            {
                return Err(
                    "Reference resolution created an independent move journal or witness.".into(),
                );
            }
        }
        match action.as_str() {
            "prepare" => {
                let text = "Original reference text\n";
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(root.join("native-reference.txt"))
                    .map_err(err)?;
                file.write_all(text.as_bytes()).map_err(err)?;
                file.sync_all().map_err(err)?;
                Ok(json!(
                    situate_core::content::revision_for_text(text).map_err(err)?
                ))
            }
            "inspect" => {
                let read = |name: &str| -> Result<Vec<u8>, String> {
                    let mut bytes = Vec::new();
                    std::fs::File::open(directory.join(name))
                        .map_err(err)?
                        .take(65_537)
                        .read_to_end(&mut bytes)
                        .map_err(err)?;
                    if bytes.len() > 65_536 {
                        return Err("Reference fixtures exceed the size limit.".into());
                    }
                    Ok(bytes)
                };
                let metadata_bytes = read("metadata.json")?;
                let history_bytes = read("history.jsonl")?;
                let metadata: serde_json::Value =
                    serde_json::from_slice(&metadata_bytes).map_err(err)?;
                let mut pending = Vec::new();
                let mut runs = Vec::new();
                for line in history_bytes
                    .split(|byte| *byte == b'\n')
                    .filter(|line| !line.is_empty())
                {
                    let entry: serde_json::Value = serde_json::from_slice(line).map_err(err)?;
                    match entry["type"].as_str() {
                        Some("message") if entry["data"]["input"].is_object() => {
                            let mut input = entry["data"]["input"].clone();
                            input["text"] = entry["data"]["message"]["content"].clone();
                            input["state"] = json!("pending");
                            pending.push(input);
                        }
                        Some("run") => runs.push(entry["data"].clone()),
                        _ => {}
                    }
                }
                let record = json!({"runtime":{
                    "draftReferences":metadata["legacyDraft"]["references"],
                    "pending":pending,"runs":runs
                }});
                use sha2::Digest;
                let mut hash = sha2::Sha256::new();
                hash.update((metadata_bytes.len() as u64).to_le_bytes());
                hash.update(&metadata_bytes);
                hash.update(&history_bytes);
                let digest: String = hash
                    .finalize()
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect();
                Ok(json!({ "record": record, "digest": digest }))
            }
            _ => Err("Unknown reference fixture action.".into()),
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn smoke_editor_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    workspace_id: String,
    text: String,
    verify: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if app.config().identifier != "dev.situate.client.smoke" {
            return Err("Editor smoke access requires the isolated test application.".into());
        }
        let (location, session) =
            super::super::workspaces::file_session(&app, window.label(), &workspace_id)?;
        if !location.name.starts_with("Garden-") && !location.name.starts_with("Reading-") {
            return Err("Editor smoke access requires a disposable test workspace.".into());
        }
        let content = session.inner.lock().map_err(err)?;
        let root = content
            .root
            .as_ref()
            .ok_or("The test workspace is not local storage.")?;
        let path = root.join("native-editor.md");
        if verify {
            if std::fs::read(path).map_err(err)? != text.as_bytes() {
                return Err("The native editor's persisted bytes differ from its reply.".into());
            }
        } else {
            std::fs::write(path, text).map_err(err)?;
        }
        Ok(())
    })
    .await
    .map_err(err)?
}
