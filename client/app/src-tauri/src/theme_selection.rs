use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
use tauri::Manager;

const ERROR: &str = "settings.appearance.themeStorageFailed";
const LIMIT: u64 = 1024;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub(crate) enum Request {
    Load,
    Save { selection: Option<String> },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    selection: Option<String>,
}

fn valid(selection: Option<&str>) -> bool {
    let Some(selection) = selection else {
        return true;
    };
    serde_json::from_str::<[String; 3]>(selection).is_ok_and(|parts| {
        parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 128
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        })
    })
}

fn access(directory: &Path, scope: &str, request: Request) -> Result<Option<String>, String> {
    let name = format!("{:x}.json", Sha256::digest(scope.as_bytes()));
    let path = directory.join(name);
    let prior = match File::open(&path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(LIMIT + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ERROR)?;
            if bytes.len() > LIMIT as usize {
                return Err(ERROR.into());
            }
            let record: Record = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
            if record.version != 1 || !valid(record.selection.as_deref()) {
                return Err(ERROR.into());
            }
            record.selection
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(ERROR.into()),
    };
    let Request::Save { selection } = request else {
        return Ok(prior);
    };
    if !valid(selection.as_deref()) {
        return Err(ERROR.into());
    }
    if prior == selection {
        return Ok(selection);
    }
    std::fs::create_dir_all(directory).map_err(|_| ERROR)?;
    let record = Record {
        version: 1,
        selection,
    };
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|_| ERROR)?;
    file.write_all(&serde_json::to_vec(&record).map_err(|_| ERROR)?)
        .map_err(|_| ERROR)?;
    file.as_file().sync_all().map_err(|_| ERROR)?;
    file.persist(path).map_err(|_| ERROR)?;
    #[cfg(unix)]
    File::open(directory)
        .and_then(|dir| dir.sync_all())
        .map_err(|_| ERROR)?;
    Ok(record.selection)
}

#[tauri::command]
pub(crate) async fn workspace_theme_selection(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: Request,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            let directory = app
                .path()
                .app_local_data_dir()
                .map_err(|_| ERROR)?
                .join("workspace-themes");
            access(&directory, &location.id, request)
        })
    })
    .await
    .map_err(|_| ERROR)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_reopens_locally_and_damage_is_not_overwritten() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("themes");
        let selection = Some(r#"["sample","installation-1","choice"]"#.to_owned());
        assert_eq!(access(&directory, "one", Request::Load), Ok(None));
        assert_eq!(
            access(
                &directory,
                "one",
                Request::Save {
                    selection: selection.clone()
                }
            ),
            Ok(selection.clone())
        );
        assert_eq!(access(&directory, "two", Request::Load), Ok(None));
        assert_eq!(access(&directory, "one", Request::Load), Ok(selection));
        let file = std::fs::read_dir(&directory)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let replacement = br#"{"version":2,"selection":null}"#;
        std::fs::write(&file, replacement).unwrap();
        assert_eq!(
            access(&directory, "one", Request::Save { selection: None }),
            Err(ERROR.into())
        );
        assert_eq!(std::fs::read(file).unwrap(), replacement);
    }
}
