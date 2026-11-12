use serde_json::{Value, json};
use situate_core::content::{RevisionChange, RevisionChangeStatus};

pub(crate) fn recorded_changes(
    changes: Vec<RevisionChange>,
    before: &str,
    after: &str,
    plugin: Option<&str>,
) -> Value {
    json!(changes.into_iter().map(|change| {
        let added=matches!(change.status,RevisionChangeStatus::Added);
        let deleted=matches!(change.status,RevisionChangeStatus::Deleted);
        let mut value=json!({"store":if plugin.is_some(){"plugin"}else{"workspace"},"operation":match change.status{RevisionChangeStatus::Added=>"added",RevisionChangeStatus::Modified=>"modified",RevisionChangeStatus::Deleted=>"deleted"},"before":if added{None}else{Some(json!({"path":change.path,"revision":before}))},"after":if deleted{None}else{Some(json!({"path":change.path,"revision":after}))},"attribution":"uncertain"});
        if let Some(id)=plugin{value["pluginId"]=json!(id);}
        value
    }).collect::<Vec<_>>())
}
#[tauri::command]
pub async fn change_revision(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    plugin_id: Option<String>,
    path: String,
    revision: String,
) -> Result<Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, window, scope, plugin_id, path, revision);
        Err("native.plugins.unavailable".into())
    }
    #[cfg(target_os = "macos")]
    {
        if revision.len() != 40
            || !revision
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("native.content.base.mismatch".into());
        }
        let label = window.label().to_owned();
        let auth = crate::workspaces::authorization_session(&app, &label, &scope)?;
        tauri::async_runtime::spawn_blocking(move || {
            crate::workspaces::with_authorized_read(
                &app,
                &label,
                &auth,
                |location| {
                    let root = crate::files::local_root(&app, location)?
                        .ok_or_else(|| "native.files.workspace.folderUnavailable".to_owned())?;
                    let session = if plugin_id.is_none() {
                        Some(crate::workspaces::file_session(&app, &label, &scope)?.1)
                    } else {
                        None
                    };
                    Ok((
                        root,
                        session,
                        crate::files::CoordinatedAccess::begin(&app, location)?,
                    ))
                },
                |(root, session, _coordination)| {
                    let bytes = match &plugin_id {
                        Some(id) => {
                            situate_core::plugins::sources::revision(root, id, &path, &revision)?
                        }
                        None => crate::files::recorded_revision(
                            root,
                            session
                                .as_ref()
                                .ok_or("native.workspace.session.inactive")?,
                            &path,
                            &revision,
                        )?,
                    };
                    Ok(match String::from_utf8(bytes) {
                        Ok(text) => json!({"status":"available","text":text}),
                        Err(_) => json!({"status":"unsupported"}),
                    })
                },
            )
        })
        .await
        .map_err(|_| "native.content.history.unavailable".to_owned())?
    }
}

#[tauri::command]
pub async fn change_list(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    before: String,
    after: String,
) -> Result<Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, window, scope, before, after);
        Err("native.plugins.unavailable".into())
    }
    #[cfg(target_os = "macos")]
    {
        let label = window.label().to_owned();
        let auth = crate::workspaces::authorization_session(&app, &label, &scope)?;
        tauri::async_runtime::spawn_blocking(move||crate::workspaces::with_authorized_read(&app,&label,&auth,
        |location|Ok((crate::files::local_root(&app,location)?.ok_or("native.files.workspace.folderUnavailable")?,crate::workspaces::file_session(&app,&label,&scope)?.1,crate::files::CoordinatedAccess::begin(&app,location)?)),
        |(root,session,_coordination)|{
            let changes=crate::files::recorded_changes_between(root,session,&before,&after)?;
            if changes.len()>4096 || changes.iter().map(|change|change.path.len()*2+512).sum::<usize>()>1_048_576{return Ok(json!({"status":"unavailable","changes":[]}));}
            Ok(json!({"status":"ready","changes":recorded_changes(changes,&before,&after,None)}))
        }
    )).await.map_err(|_|"native.content.history.unavailable".to_owned())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tree_observations_keep_actual_absence_and_uncertain_authorship() {
        let changes = recorded_changes(
            vec![RevisionChange {
                path: "notes.md".into(),
                status: RevisionChangeStatus::Deleted,
            }],
            "before",
            "after",
            None,
        );
        assert_eq!(
            changes,
            json!([{"store":"workspace","operation":"deleted","before":{"path":"notes.md","revision":"before"},"after":null,"attribution":"uncertain"}])
        );
        let source = recorded_changes(
            vec![RevisionChange {
                path: "index.js".into(),
                status: RevisionChangeStatus::Added,
            }],
            "before",
            "after",
            Some("mail"),
        );
        assert_eq!(source[0]["before"], Value::Null);
        assert_eq!(source[0]["pluginId"], "mail");
        assert_eq!(source[0]["after"]["revision"], "after");
    }
}
