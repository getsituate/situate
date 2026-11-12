use super::*;
use crate::content::{
    self, ContentError, ContentStore, OperationOutcome, SaveOutcome, TextVersion,
};
use std::{io::Write, path::PathBuf};

pub(super) const MAX_BYTES: u64 = 64 * 1024 * 1024;
const METADATA: &str = "plugin-draft.json";

#[derive(Debug)]
pub enum DraftError {
    Plugin(PluginError),
    Content(ContentError),
}

impl fmt::Display for DraftError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Plugin(error) => error.fmt(f),
            Self::Content(error) => error.fmt(f),
        }
    }
}
impl std::error::Error for DraftError {}
impl From<PluginError> for DraftError {
    fn from(error: PluginError) -> Self {
        Self::Plugin(error)
    }
}
impl From<ContentError> for DraftError {
    fn from(error: ContentError) -> Self {
        Self::Content(error)
    }
}
impl From<io::Error> for DraftError {
    fn from(error: io::Error) -> Self {
        Self::Content(error.into())
    }
}
type Result<T> = std::result::Result<T, DraftError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftInfo {
    pub version: u32,
    pub id: String,
    pub plugin_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub id: String,
    pub info: Option<DraftInfo>,
    pub error: Option<String>,
}

fn check_id(id: &str) -> Result<()> {
    if uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id) {
        Ok(())
    } else {
        Err(PluginError::InvalidPath.into())
    }
}

pub(super) fn workspace(root: &Path) -> Result<Dir> {
    let parent = Dir::open_ambient_dir(
        root.parent().ok_or(PluginError::InvalidPath)?,
        ambient_authority(),
    )?;
    Ok(child(
        &parent,
        root.file_name()
            .and_then(|s| s.to_str())
            .ok_or(PluginError::InvalidPath)?,
    )?)
}

fn inventories(root: &Path) -> Result<Vec<Dir>> {
    migrate(root)?;
    let Some(plugins) = super::inventory(root)? else {
        return Ok(vec![]);
    };
    let mut result = vec![];
    for (index, entry) in plugins.entries()?.enumerate() {
        if index >= MAX_PACKAGES {
            return Err(PluginError::TooLarge.into());
        }
        let name = entry?.file_name();
        if name == ".git" {
            continue;
        }
        let plugin = child(&plugins, name.to_str().ok_or(PluginError::InvalidPath)?)?;
        if let Some(drafts) = optional_child(&plugin, "drafts")? {
            result.push(drafts);
        }
    }
    Ok(result)
}

fn migrate(root: &Path) -> Result<()> {
    let Some(marker) = optional_child(&workspace(root)?, ".situate")? else {
        return Ok(());
    };
    let Some(legacy) = optional_child(&marker, "plugin-drafts")? else {
        return Ok(());
    };
    let store = runtime::storage(root)
        .map_err(|_| PluginError::Unavailable)?
        .ok_or(PluginError::Unavailable)?;
    runtime::read_state(root, &store).map_err(|_| PluginError::Unavailable)?;
    let _lock = store
        .lock_named("plugin-migration.lock")
        .map_err(|_| PluginError::Unavailable)?;
    let plugins = super::inventory(root)?;
    for entry in legacy.entries()? {
        let id = entry?
            .file_name()
            .into_string()
            .map_err(|_| PluginError::InvalidPath)?;
        check_id(&id)?;
        let dir = child(&legacy, &id)?;
        let text = read_text(&child(&dir, ".situate")?, METADATA, MAX_MANIFEST)?;
        let info: DraftInfo =
            serde_json::from_str(&text).map_err(|_| PluginError::InvalidManifest)?;
        if info.version != 1 || info.id != id || !valid_id(&info.plugin_id) {
            return Err(PluginError::InvalidManifest.into());
        }
        if let Some(plugins) = &plugins
            && let Some(plugin) = optional_child(plugins, &info.plugin_id)?
        {
            let Some(marker) = optional_child(&plugin, ".runtime")? else {
                continue;
            };
            if folder::read(&marker, "credential-migration")
                .map_err(|_| PluginError::Unavailable)?
                .is_none()
            {
                continue;
            }
            let target = ensure_child(&plugin, "drafts")?;
            crate::durable_storage::rename_noreplace(&legacy, &id, &target, &id)?;
            sync(&target)?;
            sync(&legacy)?;
        }
    }
    if let Some(plugins) = &plugins {
        for entry in plugins.entries()? {
            let id = entry?
                .file_name()
                .into_string()
                .map_err(|_| PluginError::InvalidPath)?;
            if id == ".git" {
                continue;
            }
            let plugin = child(plugins, &id)?;
            if let Some(drafts) = optional_child(&plugin, "drafts")? {
                sync(&drafts)?;
                sync(&plugin)?;
            }
        }
        sync(plugins)?;
    }
    sync(&legacy)?;
    // Orphans cannot be attributed to an installed incarnation and are never adopted.
    crate::durable_storage::rename_noreplace(
        &marker,
        "plugin-drafts",
        &marker,
        "plugin-drafts-legacy",
    )?;
    sync(&marker)?;
    Ok(())
}

pub(super) fn ensure_child(parent: &Dir, name: &str) -> Result<Dir> {
    match parent.create_dir(name) {
        Ok(()) => sync(parent)?,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error.into()),
    }
    Ok(child(parent, name)?)
}

fn sync(dir: &Dir) -> Result<()> {
    dir.try_clone()?.into_std_file().sync_all()?;
    Ok(())
}

fn location(root: &Path, id: &str) -> Result<PathBuf> {
    for (plugin, _) in folder::records(root).map_err(|_| PluginError::Unavailable)? {
        let path = root
            .join(".situate/plugins")
            .join(&plugin)
            .join("drafts")
            .join(id);
        let plugin_dir = folder::plugin(root, &plugin).map_err(|_| PluginError::Unavailable)?;
        if let Some(drafts) = optional_child(&plugin_dir, "drafts")?
            && optional_child(&drafts, id)?.is_some()
        {
            return Ok(path);
        }
    }
    Err(PluginError::Unavailable.into())
}

pub(super) fn existing(root: &Path, id: &str) -> Result<(Dir, DraftInfo)> {
    check_id(id)?;
    let mut found = None;
    for inventory in inventories(root)? {
        if let Some(dir) = optional_child(&inventory, id)? {
            if found.is_some() {
                return Err(PluginError::InvalidPath.into());
            }
            found = Some(dir);
        }
    }
    let dir = found.ok_or(PluginError::Unavailable)?;
    let marker = child(&dir, ".situate")?;
    let text = read_text(&marker, METADATA, MAX_MANIFEST)?;
    let info: DraftInfo = serde_json::from_str(&text).map_err(|_| PluginError::InvalidManifest)?;
    if info.version != 1 || info.id != id || !valid_id(&info.plugin_id) {
        return Err(PluginError::InvalidManifest.into());
    }
    child(&dir, "code")?;
    // Missing history on an existing draft is damage, never an initialization request.
    child(&marker, "history.git")?;
    Ok((dir, info))
}

pub(super) fn entries(code: &Dir) -> Result<Vec<PluginFile>> {
    let mut files = Vec::new();
    walk(code, "", &mut files, true)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

pub(super) fn bounded_size(code: &Dir, files: &[PluginFile]) -> Result<u64> {
    let mut bytes = 0;
    for file in files.iter().filter(|file| !file.is_directory) {
        let size = source_file(code, &file.path)?.metadata()?.len();
        if size > MAX_TEXT {
            return Err(PluginError::TooLarge.into());
        }
        bytes += size;
        if bytes > MAX_BYTES {
            return Err(PluginError::TooLarge.into());
        }
    }
    Ok(bytes)
}

pub(super) fn parent_dir(code: &Dir, path: &str) -> Result<(Dir, String)> {
    source_path(path)?;
    content::validate_portable_path(path)?;
    let mut parent = code.try_clone()?;
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            return Ok((parent, part.into()));
        }
        parent = child(&parent, part)?;
    }
    Err(PluginError::InvalidPath.into())
}

/// Seeds code from sequential source observations, not an atomic snapshot.
/// Errors may leave a partial draft under `id`; callers must not retry that identity.
/// Metadata is published only after the initial code history has been persisted.
pub fn create(root: &Path, id: &str, plugin_id: &str) -> Result<DraftInfo> {
    check_id(id)?;
    if !valid_id(plugin_id) {
        return Err(PluginError::InvalidPath.into());
    }
    migrate(root)?;
    let source = (|| -> Result<Option<Dir>> {
        Ok(match super::inventory(root)? {
            Some(active) => match optional_child(&active, plugin_id)? {
                Some(plugin) => match optional_child(&plugin, "code")? {
                    Some(code) => Some(code),
                    None if optional_child(&plugin, "drafts")?.is_some() => None,
                    None => return Err(PluginError::Unavailable.into()),
                },
                None => None,
            },
            None => None,
        })
    })();
    let marker = ensure_child(&workspace(root)?, ".situate")?;
    let plugins = ensure_child(&marker, "plugins")?;
    let fresh = optional_child(&plugins, plugin_id)?.is_none();
    let plugin = ensure_child(&plugins, plugin_id)?;
    if fresh {
        folder::new_installation(root, plugin_id).map_err(|_| PluginError::Unavailable)?;
    }
    folder::incarnation(root, plugin_id).map_err(|_| PluginError::Unavailable)?;
    let inventory = ensure_child(&plugin, "drafts")?;
    for (index, entry) in inventory.entries()?.enumerate() {
        entry?;
        if index + 1 == MAX_PACKAGES {
            return Err(PluginError::TooLarge.into());
        }
    }
    inventory.create_dir(id)?;
    sync(&inventory)?;
    let dir = child(&inventory, id)?;
    dir.create_dir(".situate")?;
    dir.create_dir("code")?;
    let code = child(&dir, "code")?;
    if let Some(source) = source? {
        let files = entries(&source)?;
        bounded_size(&source, &files)?;
        let mut remaining = MAX_BYTES;
        for file in files {
            let (parent, name) = parent_dir(&code, &file.path)?;
            if file.is_directory {
                parent.create_dir(&name)?;
            } else {
                let mut bytes = Vec::new();
                source_file(&source, &file.path)?
                    .take(MAX_TEXT.min(remaining) + 1)
                    .read_to_end(&mut bytes)?;
                if bytes.len() as u64 > MAX_TEXT.min(remaining) {
                    return Err(PluginError::TooLarge.into());
                }
                remaining -= bytes.len() as u64;
                let mut options = OpenOptions::new();
                options
                    .write(true)
                    .create_new(true)
                    .follow(FollowSymlinks::No);
                let mut output = parent.open_with(&name, &options)?;
                output.write_all(&bytes)?;
                output.sync_all()?;
            }
            sync(&parent)?;
        }
    }
    sync(&code)?;
    sync(&dir)?;
    drop(ContentStore::open(&location(root, id)?)?);
    let info = DraftInfo {
        version: 1,
        id: id.into(),
        plugin_id: plugin_id.into(),
    };
    let marker = child(&dir, ".situate")?;
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    let mut metadata = marker.open_with(METADATA, &options)?;
    let bytes = serde_json::to_vec(&info).map_err(|_| PluginError::InvalidManifest)?;
    metadata.write_all(&bytes)?;
    metadata.sync_all()?;
    sync(&marker)?;
    Ok(info)
}

pub fn list(root: &Path) -> Result<Vec<DraftSummary>> {
    let mut summaries = Vec::new();
    for inventory in inventories(root)? {
        for entry in inventory.entries()? {
            let id = entry?
                .file_name()
                .into_string()
                .map_err(|_| PluginError::InvalidPath)?;
            if summaries.len() == MAX_PACKAGES {
                return Err(PluginError::TooLarge.into());
            }
            let (info, error) = match existing(root, &id) {
                Ok((_, info)) => (Some(info), None),
                Err(error) => (None, Some(error.to_string())),
            };
            summaries.push(DraftSummary { id, info, error });
        }
    }
    summaries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(summaries)
}

/// Rejects unsafe or unbounded trial trees before disposal.
pub fn validate_trial_tree(dir: &Dir) -> Result<()> {
    fn visit(dir: &Dir, depth: usize, count: &mut usize, bytes: &mut u64) -> Result<()> {
        if depth > 64 {
            return Err(PluginError::TooLarge.into());
        }
        for entry in dir.entries()? {
            let name = entry?.file_name();
            *count += 1;
            if *count > 100_000 {
                return Err(PluginError::TooLarge.into());
            }
            let metadata = dir.symlink_metadata(&name)?;
            if metadata.file_type().is_symlink() {
                return Err(PluginError::InvalidPath.into());
            }
            if metadata.is_dir() {
                visit(
                    &child(dir, name.to_str().ok_or(PluginError::InvalidPath)?)?,
                    depth + 1,
                    count,
                    bytes,
                )?;
            } else if metadata.is_file() {
                *bytes = bytes
                    .checked_add(metadata.len())
                    .ok_or(PluginError::TooLarge)?;
                if *bytes > 4 * 1024 * 1024 * 1024 {
                    return Err(PluginError::TooLarge.into());
                }
            } else {
                return Err(PluginError::InvalidPath.into());
            }
        }
        Ok(())
    }
    let mut bytes = 0;
    visit(dir, 0, &mut 0, &mut bytes)
}

pub fn inspect(root: &Path, id: &str) -> Result<DraftInfo> {
    let (dir, info) = existing(root, id)?;
    let history = child(&child(&dir, ".situate")?, "history.git")?;
    content::reject_links(&history)?;
    let repo = git2::Repository::open_bare(location(root, id)?.join(".situate/history.git"))
        .map_err(ContentError::from)?;
    repo.head()
        .and_then(|head| head.peel_to_commit())
        .and_then(|commit| commit.tree())
        .map_err(ContentError::from)?;
    Ok(info)
}

pub fn files(root: &Path, id: &str) -> Result<Vec<PluginFile>> {
    entries(&child(&existing(root, id)?.0, "code")?)
}

pub fn read(root: &Path, id: &str, path: &str) -> Result<TextVersion> {
    content::validate_portable_path(path)?;
    let text = read_text(&child(&existing(root, id)?.0, "code")?, path, MAX_TEXT)?;
    let revision = content::revision_for_text(&text)?;
    Ok(TextVersion { text, revision })
}

/// `None` creates only; editing requires the revision returned by `read`.
/// Partial saves and recovery conflicts retain ContentStore's original outcomes.
pub fn write(
    root: &Path,
    id: &str,
    path: &str,
    text: &str,
    expected_revision: Option<&str>,
) -> Result<SaveOutcome> {
    let code = child(&existing(root, id)?.0, "code")?;
    let (parent, name) = parent_dir(&code, path)?;
    let files = entries(&code)?;
    let bytes = bounded_size(&code, &files)?;
    let previous = match parent.symlink_metadata(&name) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            Some(metadata.len())
        }
        Ok(_) => return Err(PluginError::InvalidPath.into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if text.len() as u64 > MAX_TEXT
        || bytes
            .checked_sub(previous.unwrap_or(0))
            .ok_or(PluginError::TooLarge)?
            + text.len() as u64
            > MAX_BYTES
        || (previous.is_none() && files.len() == MAX_FILES)
    {
        return Err(PluginError::TooLarge.into());
    }
    Ok(ContentStore::open(&location(root, id)?)?.agent_write(
        &format!("code/{path}"),
        expected_revision,
        text,
    )?)
}

pub fn mkdir(root: &Path, id: &str, path: &str) -> Result<OperationOutcome> {
    let code = child(&existing(root, id)?.0, "code")?;
    parent_dir(&code, path)?;
    let files = entries(&code)?;
    bounded_size(&code, &files)?;
    if files.len() == MAX_FILES {
        return Err(PluginError::TooLarge.into());
    }
    Ok(ContentStore::open(&location(root, id)?)?.create_folder(&format!("code/{path}"))?)
}

pub fn validate(root: &Path, id: &str) -> Result<PluginManifest> {
    let (dir, info) = existing(root, id)?;
    Ok(validate_code(&child(&dir, "code")?, &info.plugin_id)?)
}

#[cfg(test)]
#[path = "drafts_tests.rs"]
mod tests;
