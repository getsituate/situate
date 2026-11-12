use super::*;
use crate::content::{ContentStore, HistoryEntry, OperationOutcome, SaveOutcome, TextVersion};

const ERROR: &str = "native.plugins.hostFailed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageRevision {
    pub plugin_id: String,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incarnation: Option<String>,
}

pub(super) fn valid_revision(revision: &str) -> bool {
    revision.len() == 40
        && revision
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn plugin_dir(root: &Path, id: &str) -> Result<Dir, String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let workspace = drafts::workspace(root).map_err(|e| e.to_string())?;
    let marker = child(&workspace, ".situate").map_err(|e| e.to_string())?;
    let inventory = child(&marker, "plugins").map_err(|e| e.to_string())?;
    child(&inventory, id).map_err(|e| e.to_string())
}
fn source_code(root: &Path, id: &str) -> Result<Dir, String> {
    child(&plugin_dir(root, id)?, "code").map_err(|e| e.to_string())
}
pub(super) fn open(root: &Path, id: &str) -> Result<ContentStore, String> {
    let plugin = plugin_dir(root, id)?;
    let code = child(&plugin, "code").map_err(|e| e.to_string())?;
    let files = drafts::entries(&code).map_err(|e| e.to_string())?;
    drafts::bounded_size(&code, &files).map_err(|e| e.to_string())?;
    if let Some(marker) = optional_child(&plugin, ".situate").map_err(|e| e.to_string())? {
        child(&marker, "history.git").map_err(|e| e.to_string())?;
    } else {
        drafts::ensure_child(&plugin, ".situate").map_err(|e| e.to_string())?;
    }
    let plugin_path = root.join(".situate/plugins").join(id);
    ContentStore::open_with_history(&plugin_path.join("code"), &plugin_path.join(".situate"))
        .map_err(|e| e.to_string())
}

pub fn create(root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let marker = child(
        &drafts::workspace(root).map_err(|e| e.to_string())?,
        ".situate",
    )
    .map_err(|e| e.to_string())?;
    let inventory = drafts::ensure_child(&marker, "plugins").map_err(|e| e.to_string())?;
    if optional_child(&inventory, id)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("native.plugins.stateConflict".into());
    }
    if inventory.entries().map_err(|_| ERROR)?.count() >= MAX_PACKAGES {
        return Err(PluginError::TooLarge.to_string());
    }
    let plugin = drafts::ensure_child(&inventory, id).map_err(|e| e.to_string())?;
    folder::new_installation(root, id)?;
    drafts::ensure_child(&plugin, "code").map_err(|e| e.to_string())?;
    drop(open(root, id)?);
    folder::incarnation(root, id)?;
    Ok(())
}

/// Records a bounded source observation in the existing Git history, without executing it.
/// An unchanged tree retains its commit; a snapshot does not establish successful host checks.
pub fn snapshot(root: &Path, id: &str) -> Result<PackageRevision, String> {
    let incarnation = folder::incarnation(root, id)?;
    let mut store = open(root, id)?;
    let revision = store.record_external_changes().map_err(|e| e.to_string())?;
    if folder::incarnation(root, id)? != incarnation {
        return Err("native.plugins.stateConflict".into());
    }
    Ok(PackageRevision {
        plugin_id: id.into(),
        revision,
        incarnation: Some(incarnation),
    })
}
pub fn capture(root: &Path, id: &str) -> Result<PackageRevision, String> {
    snapshot(root, id)
}
pub fn head(root: &Path, id: &str) -> Result<PackageRevision, String> {
    let revision = history(root, id)?.first().ok_or(ERROR)?.revision.clone();
    Ok(PackageRevision {
        plugin_id: id.into(),
        revision,
        incarnation: Some(folder::incarnation(root, id)?),
    })
}

fn open_history(root: &Path, id: &str) -> Result<ContentStore, String> {
    let plugin = plugin_dir(root, id)?;
    child(&plugin, "code").map_err(|e| e.to_string())?;
    let marker = child(&plugin, ".situate").map_err(|e| e.to_string())?;
    child(&marker, "history.git").map_err(|e| e.to_string())?;
    let plugin_path = root.join(".situate/plugins").join(id);
    ContentStore::open_existing_history(&plugin_path.join("code"), &plugin_path.join(".situate"))
        .map_err(|e| e.to_string())
}

pub fn files(root: &Path, id: &str) -> Result<Vec<PluginFile>, String> {
    drafts::entries(&source_code(root, id)?).map_err(|e| e.to_string())
}
pub fn files_at_revision(root: &Path, id: &str, revision: &str) -> Result<Vec<PluginFile>, String> {
    if !valid_revision(revision) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let entries = open_history(root, id)?
        .list_revision(revision)
        .map_err(|e| e.to_string())?;
    if entries.len() > MAX_FILES {
        return Err(PluginError::TooLarge.to_string());
    }
    let mut files = Vec::with_capacity(entries.len());
    for entry in entries {
        source_path(&entry.path).map_err(|e| e.to_string())?;
        files.push(PluginFile {
            path: entry.path,
            is_directory: entry.is_directory,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

pub fn changes_between(
    root: &Path,
    id: &str,
    before: &str,
    after: &str,
) -> Result<Vec<crate::content::RevisionChange>, String> {
    if !valid_revision(before) || !valid_revision(after) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let changes = open_history(root, id)?
        .changes_between_revisions(before, after)
        .map_err(|e| e.to_string())?;
    if changes.len() > MAX_FILES {
        return Err(PluginError::TooLarge.to_string());
    }
    for change in &changes {
        source_path(&change.path).map_err(|e| e.to_string())?;
    }
    Ok(changes)
}

pub fn read(root: &Path, id: &str, path: &str) -> Result<TextVersion, String> {
    source_path(path).map_err(|e| e.to_string())?;
    let text = read_text(&source_code(root, id)?, path, MAX_TEXT).map_err(|e| e.to_string())?;
    let revision = crate::content::revision_for_text(&text).map_err(|e| e.to_string())?;
    Ok(TextVersion { text, revision })
}
pub fn write(
    root: &Path,
    id: &str,
    path: &str,
    text: &str,
    expected: Option<&str>,
) -> Result<SaveOutcome, String> {
    source_path(path).map_err(|e| e.to_string())?;
    runtime::with_pinned_source(root, id, || {
        let code = source_code(root, id)?;
        let (parent, name) = drafts::parent_dir(&code, path).map_err(|e| e.to_string())?;
        let files = drafts::entries(&code).map_err(|e| e.to_string())?;
        let bytes = drafts::bounded_size(&code, &files).map_err(|e| e.to_string())?;
        let previous = match parent.symlink_metadata(&name) {
            Ok(m) if m.is_file() && !m.file_type().is_symlink() => Some(m.len()),
            Ok(_) => return Err(PluginError::InvalidPath.to_string()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(_) => return Err(ERROR.into()),
        };
        if text.len() as u64 > MAX_TEXT
            || bytes
                .checked_sub(previous.unwrap_or(0))
                .ok_or_else(|| PluginError::TooLarge.to_string())?
                + text.len() as u64
                > drafts::MAX_BYTES
            || (previous.is_none() && files.len() == MAX_FILES)
        {
            return Err(PluginError::TooLarge.to_string());
        }
        open(root, id)?
            .agent_write(path, expected, text)
            .map_err(|e| e.to_string())
    })
}
pub fn mkdir(root: &Path, id: &str, path: &str) -> Result<OperationOutcome, String> {
    source_path(path).map_err(|e| e.to_string())?;
    runtime::with_pinned_source(root, id, || {
        let code = source_code(root, id)?;
        drafts::parent_dir(&code, path).map_err(|e| e.to_string())?;
        let files = drafts::entries(&code).map_err(|e| e.to_string())?;
        drafts::bounded_size(&code, &files).map_err(|e| e.to_string())?;
        if files.len() == MAX_FILES {
            return Err(PluginError::TooLarge.to_string());
        }
        open(root, id)?
            .create_folder(path)
            .map_err(|e| e.to_string())
    })
}
pub fn remove(root: &Path, id: &str, path: &str) -> Result<OperationOutcome, String> {
    source_path(path).map_err(|e| e.to_string())?;
    runtime::with_pinned_source(root, id, || {
        open(root, id)?
            .delete_entry(path)
            .map_err(|e| e.to_string())
    })
}
pub fn rename(
    root: &Path,
    id: &str,
    path: &str,
    destination: &str,
) -> Result<OperationOutcome, String> {
    source_path(path).map_err(|e| e.to_string())?;
    source_path(destination).map_err(|e| e.to_string())?;
    runtime::with_pinned_source(root, id, || {
        open(root, id)?
            .move_entry(path, destination)
            .map_err(|e| e.to_string())
    })
}
pub fn file_history(root: &Path, id: &str, path: &str) -> Result<Vec<HistoryEntry>, String> {
    source_path(path).map_err(|e| e.to_string())?;
    open_history(root, id)?
        .file_history(path)
        .map_err(|e| e.to_string())
}

pub fn history(root: &Path, id: &str) -> Result<Vec<HistoryEntry>, String> {
    open_history(root, id)?.history().map_err(|e| e.to_string())
}
pub fn revision(root: &Path, id: &str, path: &str, revision: &str) -> Result<Vec<u8>, String> {
    source_path(path).map_err(|e| e.to_string())?;
    if !valid_revision(revision) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let bytes = open_history(root, id)?
        .read_revision_bounded(path, revision, MAX_TEXT)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_TEXT {
        return Err(PluginError::TooLarge.to_string());
    }
    Ok(bytes)
}

pub fn at_revision(root: &Path, package: &PackageRevision) -> Result<runtime::Sources, String> {
    if let Some(expected) = &package.incarnation
        && folder::incarnation(root, &package.plugin_id)? != *expected
    {
        return Err("native.plugins.stateConflict".into());
    }
    if !valid_revision(&package.revision) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let store = open_history(root, &package.plugin_id)?;
    let entries = store
        .list_revision(&package.revision)
        .map_err(|e| e.to_string())?;
    if entries.len() > MAX_FILES {
        return Err(PluginError::TooLarge.to_string());
    }
    let mut remaining = drafts::MAX_BYTES;
    for entry in &entries {
        source_path(&entry.path).map_err(|e| e.to_string())?;
        if !entry.is_directory {
            let bytes = store
                .read_revision_bounded(&entry.path, &package.revision, MAX_TEXT.min(remaining))
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > MAX_TEXT.min(remaining) {
                return Err(PluginError::TooLarge.to_string());
            }
            remaining -= bytes.len() as u64;
        }
    }
    let read = |path: &str, limit: u64| {
        let bytes = store
            .read_revision_bounded(path, &package.revision, limit)
            .map_err(|_| PluginError::ReadFailed)?;
        if bytes.len() as u64 > limit {
            return Err(PluginError::TooLarge);
        }
        String::from_utf8(bytes).map_err(|_| PluginError::ReadFailed)
    };
    let manifest = validate_sources(&package.plugin_id, read).map_err(|e| e.to_string())?;
    runtime::collect_sources(
        manifest,
        entries
            .iter()
            .filter(|entry| !entry.is_directory)
            .map(|entry| entry.path.as_str()),
        read,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "sources_tests.rs"]
mod tests;
