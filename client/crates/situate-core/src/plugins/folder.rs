use super::*;
use crate::durable_storage::sync_directory;
use std::io::Write;

const INVALID: &str = "native.plugins.stateInvalid";
pub(super) const STATE: &str = "runtime-state.json";

pub(super) fn plugin(root: &Path, id: &str) -> Result<Dir, String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    child(
        &inventory(root).map_err(|e| e.to_string())?.ok_or(INVALID)?,
        id,
    )
    .map_err(|e| e.to_string())
}

pub(super) fn metadata(plugin: &Dir) -> Result<Dir, String> {
    drafts::ensure_child(plugin, ".runtime").map_err(|e| e.to_string())
}

pub(super) fn read(dir: &Dir, name: &str) -> Result<Option<Vec<u8>>, String> {
    match dir.symlink_metadata(name) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => (),
        _ => return Err(INVALID.into()),
    }
    let text = read_text(dir, name, MAX_TEXT).map_err(|e| e.to_string())?;
    Ok(Some(text.into_bytes()))
}

pub(super) fn replace(dir: &Dir, name: &str, bytes: &[u8]) -> Result<bool, String> {
    let temp = format!("state-{}.tmp", uuid::Uuid::new_v4());
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = dir.open_with(&temp, &options).map_err(|_| INVALID)?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| INVALID)?;
    dir.rename(&temp, dir, name).map_err(|_| INVALID)?;
    Ok(sync_directory(dir).is_ok())
}

pub fn incarnation(root: &Path, id: &str) -> Result<String, String> {
    let dir = plugin(root, id)?;
    let marker = metadata(&dir)?;
    if let Some(bytes) = read(&marker, "identity")? {
        let id = String::from_utf8(bytes).map_err(|_| INVALID)?;
        uuid::Uuid::parse_str(&id).map_err(|_| INVALID)?;
        return Ok(id);
    }
    if read(&marker, STATE)?.is_some() {
        return Err(INVALID.into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    match marker.open_with("identity", &options) {
        Ok(mut file) => {
            file.write_all(id.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|_| INVALID)?;
            sync_directory(&marker).map_err(|_| "native.plugins.stateOutcomeUnknown")?;
            Ok(id)
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            let bytes = read(&marker, "identity")?.ok_or(INVALID)?;
            let id = String::from_utf8(bytes).map_err(|_| INVALID)?;
            uuid::Uuid::parse_str(&id).map_err(|_| INVALID)?;
            Ok(id)
        }
        Err(_) => Err(INVALID.into()),
    }
}

pub(super) fn new_installation(root: &Path, id: &str) -> Result<(), String> {
    incarnation(root, id)?;
    let marker = metadata(&plugin(root, id)?)?;
    if !replace(&marker, "fresh-installation", b"new")? {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    Ok(())
}

pub(super) fn sync_metadata(marker: &Dir) -> Result<(), String> {
    drafts::validate_trial_tree(marker).map_err(|e| e.to_string())?;
    fn flush(dir: &Dir) -> Result<(), String> {
        for entry in dir.entries().map_err(|_| INVALID)? {
            let name = entry
                .map_err(|_| INVALID)?
                .file_name()
                .into_string()
                .map_err(|_| INVALID)?;
            let meta = dir.symlink_metadata(&name).map_err(|_| INVALID)?;
            if meta.file_type().is_symlink() {
                return Err(INVALID.into());
            }
            if meta.is_dir() {
                flush(&child(dir, &name).map_err(|e| e.to_string())?)?;
            } else if meta.is_file() {
                let mut options = OpenOptions::new();
                options.read(true).follow(FollowSymlinks::No).nonblock(true);
                let file = dir.open_with(&name, &options).map_err(|_| INVALID)?;
                if !file.metadata().map_err(|_| INVALID)?.is_file() {
                    return Err(INVALID.into());
                }
                file.sync_all()
                    .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
            } else {
                return Err(INVALID.into());
            }
        }
        sync_directory(dir).map_err(|_| "native.plugins.stateOutcomeUnknown".into())
    }
    #[cfg(test)]
    publication::fail_at("migration-sync").map_err(|_| "native.plugins.stateOutcomeUnknown")?;
    flush(marker)
}

pub(super) fn owners(root: &Path) -> Result<Vec<String>, String> {
    let Some(inventory) = inventory(root).map_err(|e| e.to_string())? else {
        return Ok(vec![]);
    };
    package_ids(&inventory).map_err(|error| error.to_string())
}

pub(super) fn records(root: &Path) -> Result<Vec<(String, Dir)>, String> {
    let Some(inventory) = inventory(root).map_err(|e| e.to_string())? else {
        return Ok(vec![]);
    };
    let mut records = vec![];
    for entry in inventory.entries().map_err(|_| INVALID)? {
        let id = entry
            .map_err(|_| INVALID)?
            .file_name()
            .into_string()
            .map_err(|_| INVALID)?;
        if !inventory
            .symlink_metadata(&id)
            .map_err(|_| INVALID)?
            .is_dir()
        {
            continue;
        }
        let plugin = child(&inventory, &id).map_err(|e| e.to_string())?;
        if let Some(marker) = optional_child(&plugin, ".runtime").map_err(|e| e.to_string())? {
            if records.len() == MAX_PACKAGES {
                return Err(PluginError::TooLarge.to_string());
            }
            records.push((id, marker));
        }
    }
    records.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(records)
}
