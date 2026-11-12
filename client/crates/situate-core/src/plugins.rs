//! Bounded source inspection and publication, independent of plugin execution.
//! Limits are 128 packages, 1024 entries per package, 16 path components, 512 path
//! bytes, 64 KiB manifests, 1 MiB text files and 8 MiB of declared source per validation.
//! Exceeding a limit fails, never truncates. Source paths use ASCII letters, digits,
//! dots, underscores and hyphens; IDs use lowercase letters, digits and interior hyphens.
//! Source inspection observes editable code; runtime loading uses pinned Git revisions when present.
//! Capturing or publishing a revision does not establish that JavaScript checks passed.

pub mod action_store;
pub mod activation;
pub mod credentials;
pub mod drafts;
pub mod folder;
pub mod publication;
pub mod runtime;
pub mod sources;
pub mod storage;

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fmt,
    io::{self, Read},
    path::Path,
};

const MAX_PACKAGES: usize = 128;
const MAX_FILES: usize = 1024;
const MAX_DEPTH: usize = 16;
const MAX_PATH: usize = 512;
const MAX_MANIFEST: u64 = 64 * 1024;
const MAX_TEXT: u64 = 1024 * 1024;
const MAX_DECLARED_TEXT: u64 = 8 * MAX_TEXT;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_value"
    )]
    pub service_entry: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_value"
    )]
    pub ui_entry: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_value"
    )]
    pub kind: Option<PluginKind>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_value"
    )]
    pub dependencies: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_value"
    )]
    pub exports: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_value"
    )]
    pub components: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_value"
    )]
    pub platforms: Option<Vec<PluginPlatform>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginKind {
    Connection,
    Tool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginPlatform {
    Macos,
    Ios,
}

fn optional_value<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub manifest: Option<PluginManifest>,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginFile {
    pub path: String,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginError {
    InvalidManifest,
    InvalidPath,
    Unavailable,
    ReadFailed,
    TooLarge,
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidManifest => "native.plugins.invalidManifest",
            Self::InvalidPath => "native.plugins.invalidPath",
            Self::Unavailable => "native.plugins.unavailable",
            Self::ReadFailed => "native.plugins.readFailed",
            Self::TooLarge => "native.plugins.tooLarge",
        })
    }
}
impl std::error::Error for PluginError {}

fn reserved(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !reserved(id)
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id.as_bytes()[id.len() - 1].is_ascii_alphanumeric()
}

fn source_path(path: &str) -> Result<(), PluginError> {
    if path.len() > MAX_PATH || path.split('/').count() > MAX_DEPTH {
        return Err(PluginError::TooLarge);
    }
    if path.split('/').any(|part| {
        part.is_empty()
            || part == "."
            || part == ".."
            || part.eq_ignore_ascii_case(".git")
            || part.ends_with('.')
            || reserved(part)
            || !part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    }) {
        return Err(PluginError::InvalidPath);
    }
    Ok(())
}

fn child(dir: &Dir, name: &str) -> Result<Dir, PluginError> {
    let metadata = dir
        .symlink_metadata(name)
        .map_err(|_| PluginError::Unavailable)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(PluginError::InvalidPath);
    }
    cap_primitives::fs::open_dir_nofollow(
        &dir.try_clone()
            .map_err(|_| PluginError::Unavailable)?
            .into_std_file(),
        Path::new(name),
    )
    .map(Dir::from_std_file)
    .map_err(|_| PluginError::Unavailable)
}

fn optional_child(dir: &Dir, name: &str) -> Result<Option<Dir>, PluginError> {
    match dir.symlink_metadata(name) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(PluginError::Unavailable),
        Ok(_) => child(dir, name).map(Some),
    }
}

fn inventory(root: &Path) -> Result<Option<Dir>, PluginError> {
    let parent = Dir::open_ambient_dir(
        root.parent().ok_or(PluginError::InvalidPath)?,
        ambient_authority(),
    )
    .map_err(|_| PluginError::Unavailable)?;
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(PluginError::InvalidPath)?;
    let root = child(&parent, name)?;
    let Some(marker) = optional_child(&root, ".situate")? else {
        return Ok(None);
    };
    optional_child(&marker, "plugins")
}

fn code_from(inventory: &Dir, id: &str) -> Result<Dir, PluginError> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath);
    }
    child(&child(inventory, id)?, "code")
}

fn code(root: &Path, id: &str) -> Result<Dir, PluginError> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath);
    }
    code_from(&inventory(root)?.ok_or(PluginError::Unavailable)?, id)
}

fn package_ids(inventory: &Dir) -> Result<Vec<String>, PluginError> {
    let mut ids = Vec::new();
    for entry in inventory.entries().map_err(|_| PluginError::Unavailable)? {
        let entry = entry.map_err(|_| PluginError::Unavailable)?;
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Ok(plugin) = child(inventory, &id) else {
            continue;
        };
        let Ok(code) = child(&plugin, "code") else {
            continue;
        };
        if code.symlink_metadata("plugin.json").is_err() {
            continue;
        }
        if ids.len() == MAX_PACKAGES {
            return Err(PluginError::TooLarge);
        }
        ids.push(id);
    }
    ids.sort();
    Ok(ids)
}

/// Lists directories containing code/plugin.json, including invalid packages.
/// An unreadable inventory or an exceeded inventory limit fails the entire operation.
pub fn list(root: &Path) -> Result<Vec<PluginSummary>, PluginError> {
    let Some(inventory) = inventory(root)? else {
        return Ok(Vec::new());
    };
    let mut summaries = Vec::new();
    for id in package_ids(&inventory)? {
        let result = code_from(&inventory, &id).and_then(|code| validate_code(&code, &id));
        let (manifest, error) = match result {
            Ok(manifest) => (Some(manifest), None),
            Err(error) => (None, Some(error.to_string())),
        };
        summaries.push(PluginSummary {
            id,
            manifest,
            error,
            revision: None,
        });
    }
    summaries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(summaries)
}

/// Recursively lists code-relative paths, even when the manifest is invalid.
/// Ordinary dotfiles are retained; Git internals are omitted at every depth.
pub fn files(root: &Path, id: &str) -> Result<Vec<PluginFile>, PluginError> {
    browse(&code(root, id)?)
}

fn browse(code: &Dir) -> Result<Vec<PluginFile>, PluginError> {
    let mut files = Vec::new();
    walk(code, "", &mut files, false)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn walk(
    dir: &Dir,
    prefix: &str,
    files: &mut Vec<PluginFile>,
    exclude_technical: bool,
) -> Result<(), PluginError> {
    for entry in dir.entries().map_err(|_| PluginError::ReadFailed)? {
        let entry = entry.map_err(|_| PluginError::ReadFailed)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| PluginError::InvalidPath)?;
        if crate::ignored_files::is_ignored(&name)
            || name.eq_ignore_ascii_case(".git")
            || (exclude_technical && crate::ignored_files::is_internal(&name))
        {
            continue;
        }
        if files.len() == MAX_FILES {
            return Err(PluginError::TooLarge);
        }
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        source_path(&path)?;
        let metadata = dir
            .symlink_metadata(&name)
            .map_err(|_| PluginError::ReadFailed)?;
        if metadata.file_type().is_symlink() || !(metadata.is_file() || metadata.is_dir()) {
            return Err(PluginError::InvalidPath);
        }
        let is_directory = metadata.is_dir();
        files.push(PluginFile {
            path: path.clone(),
            is_directory,
        });
        if is_directory {
            walk(&child(dir, &name)?, &path, files, exclude_technical)?;
        }
    }
    Ok(())
}

/// Reads bounded UTF-8 source without requiring a valid manifest or enabling the plugin.
pub fn read(root: &Path, id: &str, path: &str) -> Result<String, PluginError> {
    source_path(path)?;
    read_text(&code(root, id)?, path, MAX_TEXT)
}

/// Reads bounded code bytes with the same no-symlink and code-only restrictions as source inspection.
pub fn read_bytes(root: &Path, id: &str, path: &str) -> Result<Vec<u8>, PluginError> {
    read_source_bytes(&code(root, id)?, path, MAX_TEXT)
}

fn source_file(code: &Dir, path: &str) -> Result<cap_std::fs::File, PluginError> {
    source_path(path)?;
    let mut dir = code.try_clone().map_err(|_| PluginError::ReadFailed)?;
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        if parts.peek().is_some() {
            dir = child(&dir, part)?;
            continue;
        }
        let metadata = dir
            .symlink_metadata(part)
            .map_err(|_| PluginError::ReadFailed)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(PluginError::InvalidPath);
        }
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = dir
            .open_with(part, &options)
            .map_err(|_| PluginError::ReadFailed)?;
        if !file
            .metadata()
            .map_err(|_| PluginError::ReadFailed)?
            .is_file()
        {
            return Err(PluginError::InvalidPath);
        }
        return Ok(file);
    }
    Err(PluginError::InvalidPath)
}

fn read_text(code: &Dir, path: &str, limit: u64) -> Result<String, PluginError> {
    String::from_utf8(read_source_bytes(code, path, limit)?).map_err(|_| PluginError::ReadFailed)
}

fn read_source_bytes(code: &Dir, path: &str, limit: u64) -> Result<Vec<u8>, PluginError> {
    let file = source_file(code, path)?;
    if file.metadata().map_err(|_| PluginError::ReadFailed)?.len() > limit {
        return Err(PluginError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PluginError::ReadFailed)?;
    if bytes.len() as u64 > limit {
        return Err(PluginError::TooLarge);
    }
    Ok(bytes)
}

/// Validates structure and declared source files only, never JavaScript or plugin behavior.
pub fn validate(root: &Path, id: &str) -> Result<PluginManifest, PluginError> {
    validate_code(&code(root, id)?, id)
}

fn validate_code(code: &Dir, id: &str) -> Result<PluginManifest, PluginError> {
    browse(code)?;
    validate_sources(id, |path, limit| read_text(code, path, limit))
}

fn validate_sources(
    id: &str,
    mut read: impl FnMut(&str, u64) -> Result<String, PluginError>,
) -> Result<PluginManifest, PluginError> {
    let text = read("plugin.json", MAX_MANIFEST)?;
    let manifest: PluginManifest =
        serde_json::from_str(&text).map_err(|_| PluginError::InvalidManifest)?;
    if manifest.schema_version != 2
        || manifest.id != id
        || !valid_id(&manifest.id)
        || manifest.name.trim().is_empty()
        || manifest.description.trim().is_empty()
        || (manifest.skills.is_empty()
            && manifest.service_entry.is_none()
            && manifest.ui_entry.is_none())
    {
        return Err(PluginError::InvalidManifest);
    }
    let mut dependencies = HashSet::new();
    for dependency in manifest.dependencies.iter().flatten() {
        if !valid_id(dependency) || dependency == id || !dependencies.insert(dependency) {
            return Err(PluginError::InvalidManifest);
        }
    }
    for names in [&manifest.exports, &manifest.components] {
        let mut declared = HashSet::new();
        for name in names.iter().flatten() {
            if name.is_empty()
                || name.len() > 128
                || !name.bytes().enumerate().all(|(i, b)| {
                    b.is_ascii_alphabetic()
                        || matches!(b, b'_' | b'$')
                        || (i > 0 && b.is_ascii_digit())
                })
                || !declared.insert(name)
            {
                return Err(PluginError::InvalidManifest);
            }
        }
    }
    let mut platforms = HashSet::new();
    if manifest
        .platforms
        .iter()
        .flatten()
        .any(|p| !platforms.insert(p))
    {
        return Err(PluginError::InvalidManifest);
    }
    let mut remaining = MAX_DECLARED_TEXT;
    let mut paths = HashSet::new();
    for (path, skill) in manifest
        .skills
        .iter()
        .map(|p| (p, true))
        .chain(manifest.service_entry.iter().map(|p| (p, false)))
        .chain(manifest.ui_entry.iter().map(|p| (p, false)))
    {
        source_path(path)?;
        let lower = path.to_ascii_lowercase();
        if !paths.insert(lower.clone())
            || if skill {
                !(lower.ends_with(".md") || lower.ends_with(".markdown"))
            } else {
                !lower.ends_with(".js")
            }
        {
            return Err(PluginError::InvalidManifest);
        }
        let source = read(path, MAX_TEXT.min(remaining))?;
        remaining -= source.len() as u64;
    }
    Ok(manifest)
}

#[cfg(test)]
mod folder_tests;
#[cfg(test)]
mod tests;
