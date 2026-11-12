use serde::{Deserialize, Serialize};
use situate_core::ai_storage::Storage;
use situate_core::conversation_store::ConversationRecord;
use std::path::Path;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    development_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plugin_id: Option<String>,
    assignment: String,
    context: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    development_id: String,
    plugin_id: Option<String>,
    title: String,
}

fn create(root: &Path, scope: &str, request: CreateRequest) -> Result<Status, String> {
    if request.title.trim().is_empty() || request.title.len() > 512 {
        return Err("native.plugins.invalidPath".into());
    }
    let conversation = Storage::open(root, scope)?.create_assignment_conversation(
        &request.development_id,
        request.plugin_id.as_deref(),
        None,
        &request.title,
        "",
        "",
    )?;
    Ok(Status {
        conversation,
        ready: true,
        error: None,
    })
}

#[tauri::command]
pub async fn plugin_development_create(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: CreateRequest,
) -> Result<Status, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let label = window.label().to_owned();
        let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
        tauri::async_runtime::spawn_blocking(move || {
            crate::workspaces::with_retained_session(&app, &label, &authorization, |location| {
                let root = crate::files::local_root(&app, location)?
                    .ok_or("native.plugins.unavailable")?;
                create(&root, &scope, request)
            })
        })
        .await
        .map_err(|_| "native.plugins.developmentOutcomeUnknown".to_owned())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (app, window, scope, request);
        Err("native.plugins.unavailable".into())
    }
}

pub(crate) fn clear_trial_storage(path: &std::path::Path) -> Result<(), String> {
    use cap_std::{ambient_authority, fs::Dir};
    let error = || "native.plugins.retainedStorageFailed".to_owned();
    let parent = Dir::open_ambient_dir(path.parent().ok_or_else(error)?, ambient_authority())
        .map_err(|_| error())?;
    let name = path.file_name().ok_or_else(error)?;
    let metadata = match parent.symlink_metadata(name) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        result => result.map_err(|_| error())?,
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(error());
    }
    let dir = cap_primitives::fs::open_dir_nofollow(
        &parent.try_clone().map_err(|_| error())?.into_std_file(),
        std::path::Path::new(name),
    )
    .map(Dir::from_std_file)
    .map_err(|_| error())?;
    situate_core::plugins::drafts::validate_trial_tree(&dir).map_err(|_| error())?;
    // Reserve the trial identity until its TempDir drops; stale handles cannot reach a later trial.
    for entry in dir.entries().map_err(|_| error())? {
        let name = entry.map_err(|_| error())?.file_name();
        let metadata = dir.symlink_metadata(&name).map_err(|_| error())?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            dir.remove_dir_all(&name).map_err(|_| error())?;
        } else {
            dir.remove_file(&name).map_err(|_| error())?;
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct Status {
    pub(crate) conversation: ConversationRecord,
    pub(crate) ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

fn check_cancelled(token: &CancellationToken) -> Result<(), String> {
    if token.is_cancelled() {
        Err("native.ai.response.stopped".into())
    } else {
        Ok(())
    }
}

pub(crate) fn start(
    root: &Path,
    scope: &str,
    origin: &str,
    request: StartRequest,
    token: &CancellationToken,
) -> Result<Status, String> {
    check_cancelled(token)?;
    if request.assignment.trim().is_empty()
        || request.assignment.len() > 16_384
        || request.context.len() > 65_536
    {
        return Err("native.plugins.invalidPath".into());
    }
    let storage = Storage::open(root, scope)?;
    let title: String = request.assignment.chars().take(80).collect();
    let conversation = storage.create_assignment_conversation(
        &request.development_id,
        request.plugin_id.as_deref(),
        Some(origin),
        &title,
        &request.assignment,
        &request.context,
    )?;
    let error = check_cancelled(token).err();
    Ok(Status {
        conversation,
        ready: error.is_none(),
        error,
    })
}

fn status(root: &Path, scope: &str, conversation: &str) -> Result<Status, String> {
    let conversation = Storage::open(root, scope)?
        .read_conversation(conversation)?
        .ok_or("native.ai.conversation.conflict")?;
    if conversation.development.is_none() {
        return Err("native.plugins.developmentToolDenied".into());
    }
    Ok(Status {
        conversation,
        ready: true,
        error: None,
    })
}

#[tauri::command]
pub async fn plugin_development_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    conversation: String,
) -> Result<Status, String> {
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (app, window, scope, conversation);
        Err("native.plugins.unavailable".into())
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let label = window.label().to_owned();
        let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
        tauri::async_runtime::spawn_blocking(move || {
            #[cfg(target_os = "ios")]
            {
                crate::workspaces::with_retained_session(&app, &label, &authorization, |location| {
                    let root = crate::files::local_root(&app, location)?
                        .ok_or("native.plugins.unavailable")?;
                    status(&root, &scope, &conversation)
                })
            }
            #[cfg(target_os = "macos")]
            crate::workspaces::with_retained_read(
                &app,
                &label,
                &authorization,
                |location| {
                    crate::files::local_root(&app, location)?
                        .ok_or("native.plugins.unavailable".into())
                },
                |root| status(root, &scope, &conversation),
            )
        })
        .await
        .map_err(|_| "native.plugins.readFailed".to_owned())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const ID: &str = "e428b825-a91e-4c65-b39c-bdc940cf404d";
    const OTHER: &str = "b998aa23-d88e-4314-a4ba-d1d03a869c78";
    #[test]
    fn trial_disposal_removes_synthetic_data_without_following_links() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("credentials")).unwrap();
        std::fs::write(temp.path().join("credentials/test"), b"synthetic").unwrap();
        #[cfg(unix)]
        {
            let other = tempfile::tempdir().unwrap();
            std::fs::write(other.path().join("keep"), b"unrelated").unwrap();
            std::os::unix::fs::symlink(other.path(), temp.path().join("link")).unwrap();
            assert!(clear_trial_storage(temp.path()).is_err());
            assert!(temp.path().join("credentials/test").exists());
            assert!(other.path().join("keep").exists());
            std::fs::remove_file(temp.path().join("link")).unwrap();
        }
        clear_trial_storage(temp.path()).unwrap();
        assert!(temp.path().is_dir());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn trial_disposal_rejects_unbounded_trees_before_removing_files() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("keep"), b"synthetic").unwrap();
        let mut nested = temp.path().to_path_buf();
        for _ in 0..65 {
            nested.push("nested");
            std::fs::create_dir(&nested).unwrap();
        }
        assert!(clear_trial_storage(temp.path()).is_err());
        assert_eq!(
            std::fs::read(temp.path().join("keep")).unwrap(),
            b"synthetic"
        );
        assert!(nested.is_dir());
    }

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        Storage::open(root.path(), "scope")
            .unwrap()
            .create_conversation("origin", "Origin")
            .unwrap();
        root
    }
    fn request(id: &str) -> StartRequest {
        StartRequest {
            development_id: id.into(),
            plugin_id: Some("sample".into()),
            assignment: "Create a plugin".into(),
            context: "Use synthetic fixtures".into(),
        }
    }
    #[test]
    fn direct_creation_retains_independent_assignments_without_source_copies() {
        let root = fixture();
        let first = create(
            root.path(),
            "scope",
            CreateRequest {
                development_id: ID.into(),
                plugin_id: None,
                title: "New plugin".into(),
            },
        )
        .unwrap();
        assert!(first.ready);
        assert_eq!(first.conversation.title, "New plugin");
        assert_eq!(first.conversation.draft, "");
        assert_eq!(first.conversation.messages, json!([]));
        assert!(
            first
                .conversation
                .development
                .unwrap()
                .origin_conversation_id
                .is_none()
        );
        let second = create(
            root.path(),
            "scope",
            CreateRequest {
                development_id: OTHER.into(),
                plugin_id: Some("sample".into()),
                title: "Develop plugin".into(),
            },
        )
        .unwrap();
        assert_eq!(second.conversation.development.unwrap().plugin_id, "sample");
        assert!(!root.path().join(".situate/plugins/sample").exists());
        assert!(
            create(
                root.path(),
                "scope",
                CreateRequest {
                    development_id: ID.into(),
                    plugin_id: None,
                    title: "Replacement".into()
                }
            )
            .is_err()
        );
    }
    #[test]
    fn child_preparation_is_retained_without_claiming_owner_handoff() {
        let root = fixture();
        let outcome = start(
            root.path(),
            "scope",
            "origin",
            request(ID),
            &CancellationToken::new(),
        )
        .unwrap();
        assert!(outcome.ready);
        let metadata = outcome.conversation.development.as_ref().unwrap();
        assert_eq!(metadata.origin_conversation_id.as_deref(), Some("origin"));
        assert_eq!(metadata.plugin_id, "sample");
        assert!(outcome.conversation.messages.as_array().unwrap().is_empty());
        let retained = status(root.path(), "scope", ID).unwrap();
        assert_eq!(retained.conversation, outcome.conversation);
        assert!(
            start(
                root.path(),
                "scope",
                "origin",
                request(ID),
                &CancellationToken::new()
            )
            .is_err()
        );
    }
    #[test]
    fn stopped_or_invalid_preparation_never_publishes_a_child() {
        let root = fixture();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(start(root.path(), "scope", "origin", request(ID), &cancel).is_err());
        for assignment in [" ".to_owned(), "x".repeat(16_385)] {
            let mut invalid = request(ID);
            invalid.assignment = assignment;
            assert!(
                start(
                    root.path(),
                    "scope",
                    "origin",
                    invalid,
                    &CancellationToken::new()
                )
                .is_err()
            );
        }
        assert!(
            Storage::open(root.path(), "scope")
                .unwrap()
                .read_conversation(ID)
                .unwrap()
                .is_none()
        );
        assert!(status(root.path(), "scope", "origin").is_err());
    }
    #[test]
    fn creation_and_start_requests_cannot_override_native_origin_or_scope() {
        for extra in ["assignment", "context", "originConversationId", "execute"] {
            let mut value = json!({"developmentId":ID,"title":"New plugin"});
            value[extra] = json!("unexpected");
            assert!(serde_json::from_value::<CreateRequest>(value).is_err());
        }
        let mut value = json!({"developmentId":ID,"assignment":"Build a tool","context":""});
        value["originConversationId"] = json!("other");
        assert!(serde_json::from_value::<StartRequest>(value).is_err());
    }
}
