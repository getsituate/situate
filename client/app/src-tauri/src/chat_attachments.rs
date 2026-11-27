use serde::{Deserialize, Serialize};
use situate_core::{attachment::AttachmentRef, conversation_runtime::ContentReference};
#[cfg(desktop)]
use std::path::{Path, PathBuf};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSelection {
    attachments: Vec<AttachmentRef>,
    references: Vec<ContentReference>,
    failed: bool,
}

#[cfg(desktop)]
fn selected_path(root: &Path, path: &Path) -> Result<(PathBuf, Option<String>), String> {
    let canonical = path.canonicalize().map_err(|_| "chat.attachmentFailed")?;
    if !canonical.is_file() {
        return Err("chat.attachmentFailed".into());
    }
    let relative = canonical
        .strip_prefix(root)
        .ok()
        .map(|relative| {
            relative
                .iter()
                .map(|part| part.to_str())
                .collect::<Option<Vec<_>>>()
                .filter(|parts| !parts.is_empty())
                .map(|parts| parts.join("/"))
                .ok_or("chat.attachmentFailed")
        })
        .transpose()?;
    Ok((canonical, relative))
}

#[tauri::command]
pub async fn ai_attachment_pick(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<FileSelection, String> {
    #[cfg(mobile)]
    {
        let _ = (app, window, scope);
        Err("chat.attachmentFailed".into())
    }
    #[cfg(desktop)]
    {
        let authorization = crate::workspaces::authorization_session(&app, window.label(), &scope)?;
        let Some(files) = rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .pick_files()
            .await
        else {
            return Ok(FileSelection::default());
        };
        tauri::async_runtime::spawn_blocking(move || {
            crate::workspaces::with_authorization_session(
                &app,
                window.label(),
                &authorization,
                |location| {
                    let root = crate::files::local_root(&app, location)?
                        .ok_or("native.files.workspace.folderUnavailable")?;
                    let root = root
                        .canonicalize()
                        .map_err(|_| "native.files.workspace.folderUnavailable")?;
                    let mut selection = FileSelection::default();
                    for file in files {
                        let result =
                            selected_path(&root, file.path()).and_then(|(path, relative)| {
                                if let Some(relative) = relative {
                                    let session = crate::workspaces::file_session(
                                        &app,
                                        window.label(),
                                        &scope,
                                    )?;
                                    let reference = crate::files::with_content_store(
                                        &app,
                                        &session,
                                        |store| {
                                            store
                                                .capture_reference(&scope, &relative, None)
                                                .map_err(|error| error.to_string())
                                        },
                                    )?;
                                    selection.references.push(reference);
                                } else {
                                    let storage = crate::ai::unrecovered_storage(&app, location)?;
                                    selection
                                        .attachments
                                        .push(storage.put_path_attachment(&path)?);
                                }
                                Ok(())
                            });
                        selection.failed |= result.is_err();
                    }
                    Ok(selection)
                },
            )
        })
        .await
        .map_err(|_| "chat.attachmentFailed".to_owned())?
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PreviewTarget {
    Attachment { id: String },
    Reference { reference: ContentReference },
}

#[tauri::command]
pub async fn ai_attachment_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    target: PreviewTarget,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            let bytes = match target {
                PreviewTarget::Attachment { id } => {
                    let storage = crate::ai::local_storage(&app, location)?;
                    let (reference, bytes) = storage.read_attachment(&id)?;
                    if situate_core::attachment::is_path_attachment(&reference, &bytes) {
                        crate::ai::unrecovered_storage(&app, location)?
                            .read_path_attachment_preview(&reference)?
                    } else {
                        bytes
                    }
                }
                PreviewTarget::Reference { reference } => {
                    if reference.workspace_id() != scope || !reference.validate() {
                        return Err("native.content.reference.invalid".into());
                    }
                    let session = crate::workspaces::file_session(&app, window.label(), &scope)?;
                    crate::files::with_content_store(&app, &session, |store| match &reference {
                        ContentReference::Live { .. } => {
                            let path = store
                                .resolve_reference_path(&reference)
                                .map_err(|error| error.to_string())?
                                .ok_or("references.unavailable")?;
                            let root = crate::files::local_root(&app, location)?
                                .ok_or("references.unavailable")?;
                            crate::files::read_local(&root, &path)
                        }
                        ContentReference::Historical { path, revision, .. } => store
                            .read_revision_bounded(
                                path,
                                revision,
                                situate_core::attachment::MAX_ATTACHMENT_BYTES as u64,
                            )
                            .map_err(|error| error.to_string()),
                    })?
                }
            };
            crate::files::image_bytes(&bytes)
        })
    })
    .await
    .map_err(|_| "chat.attachmentUnavailable".to_owned())?
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn separates_workspace_paths_and_unfiltered_external_files() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().canonicalize().unwrap().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let inside = root.join("report.xlsx");
        let outside = root.with_file_name("workspace-copy.dat");
        std::fs::write(&inside, [0, 255]).unwrap();
        std::fs::write(&outside, []).unwrap();
        assert_eq!(
            selected_path(&root, &inside).unwrap().1.as_deref(),
            Some("report.xlsx")
        );
        assert_eq!(selected_path(&root, &outside).unwrap(), (outside, None));
        assert!(selected_path(&root, &root).is_err());
    }
}
