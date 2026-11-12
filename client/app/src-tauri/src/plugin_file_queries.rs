use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::Path};
use tokio_util::sync::CancellationToken;

const INVALID: &str = "native.plugins.invalidPath";
const ERROR: &str = "native.plugins.hostFailed";
const TOO_LARGE: &str = "native.plugins.tooLarge";
const TEXT_LIMIT: usize = 1024 * 1024;
const TOTAL_LIMIT: usize = 16 * TEXT_LIMIT;
const ENTRY_LIMIT: usize = 10_000;
const DEPTH_LIMIT: usize = 64;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub roots: Option<Vec<String>>,
    pub extensions: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    pub roots: Option<Vec<String>>,
    pub extensions: Option<Vec<String>>,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    path: String,
    change_token: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TextEntry {
    path: String,
    text: String,
    revision: String,
}

fn cancelled(token: &CancellationToken) -> Result<(), String> {
    if token.is_cancelled() {
        Err("native.plugins.hostCancelled".into())
    } else {
        Ok(())
    }
}

fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 1024
        || path.split('/').any(|part| {
            part.is_empty()
                || part.starts_with('.')
                || part.contains(['\\', ':'])
                || part.chars().any(char::is_control)
        })
    {
        return Err(INVALID.into());
    }
    Ok(())
}

fn root_dir(root: &Path) -> Result<Dir, String> {
    Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|_| ERROR.into())
}

fn directory(root: &Dir, path: &str) -> Result<Dir, String> {
    let mut dir = root.try_clone().map_err(|_| ERROR)?;
    for part in path.split('/').filter(|part| !part.is_empty()) {
        dir = dir.open_dir_nofollow(part).map_err(|_| INVALID)?;
    }
    Ok(dir)
}

fn regular_file(dir: &Dir, name: &str) -> Result<std::fs::File, String> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = dir.open_with(name, &options).map_err(|_| ERROR)?.into_std();
    if !file.metadata().map_err(|_| ERROR)?.is_file() {
        return Err(INVALID.into());
    }
    Ok(file)
}

fn fingerprint(metadata: &std::fs::Metadata) -> String {
    let mut hash = Sha256::new();
    hash.update(metadata.len().to_le_bytes());
    hash.update(format!("{:?}{:?}", metadata.modified(), metadata.created()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        for value in [
            metadata.dev(),
            metadata.ino(),
            metadata.mtime() as u64,
            metadata.mtime_nsec() as u64,
            metadata.ctime() as u64,
            metadata.ctime_nsec() as u64,
        ] {
            hash.update(value.to_le_bytes());
        }
    }
    format!("{:x}", hash.finalize())
}

fn read_bytes(
    mut file: std::fs::File,
    limit: usize,
    token: &CancellationToken,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 32 * 1024];
    loop {
        cancelled(token)?;
        // One extra byte detects growth and exhausted aggregate budgets without partial success.
        let available = buffer.len().min(limit.saturating_sub(bytes.len()) + 1);
        let count = file.read(&mut buffer[..available]).map_err(|_| ERROR)?;
        if count == 0 {
            return Ok(bytes);
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() > limit {
            return Err(TOO_LARGE.into());
        }
    }
}

struct Traversal<'a> {
    extensions: &'a Option<Vec<String>>,
    text: Option<&'a str>,
    token: &'a CancellationToken,
    scanned: usize,
    bytes: usize,
    entries: BTreeMap<String, Entry>,
}

impl Traversal<'_> {
    fn walk(&mut self, dir: &Dir, prefix: &str, depth: usize) -> Result<(), String> {
        cancelled(self.token)?;
        if depth > DEPTH_LIMIT {
            return Err(TOO_LARGE.into());
        }
        for child in dir.entries().map_err(|_| ERROR)? {
            cancelled(self.token)?;
            self.scanned += 1;
            if self.scanned > ENTRY_LIMIT {
                return Err(TOO_LARGE.into());
            }
            let child = child.map_err(|_| ERROR)?;
            let name = child.file_name();
            let Some(name) = name.to_str() else { continue };
            if validate_path(name).is_err() {
                continue;
            }
            let path = if prefix.is_empty() {
                name.into()
            } else {
                format!("{prefix}/{name}")
            };
            validate_path(&path)?;
            let kind = child.file_type().map_err(|_| ERROR)?;
            if kind.is_dir() {
                let nested = dir.open_dir_nofollow(name).map_err(|_| ERROR)?;
                self.walk(&nested, &path, depth + 1)?;
            } else if kind.is_file() {
                if self.entries.contains_key(&path)
                    || self.extensions.as_ref().is_some_and(|extensions| {
                        !extensions.iter().any(|extension| {
                            Path::new(name)
                                .extension()
                                .and_then(|value| value.to_str())
                                .is_some_and(|value| value.eq_ignore_ascii_case(&extension[1..]))
                        })
                    })
                {
                    continue;
                }
                let file = regular_file(dir, name)?;
                let change_token = fingerprint(&file.metadata().map_err(|_| ERROR)?);
                if let Some(text) = self.text {
                    let bytes = read_bytes(file, TOTAL_LIMIT - self.bytes, self.token)?;
                    self.bytes += bytes.len();
                    if bytes.contains(&0)
                        || !std::str::from_utf8(&bytes).is_ok_and(|value| value.contains(text))
                    {
                        continue;
                    }
                }
                self.entries
                    .insert(path.clone(), Entry { path, change_token });
            }
        }
        Ok(())
    }
}

pub(crate) fn list(
    root: &Path,
    query: Query,
    text: Option<&str>,
    token: &CancellationToken,
) -> Result<Vec<Entry>, String> {
    cancelled(token)?;
    if text.is_some_and(|text| text.is_empty() || text.len() > 4096) {
        return Err(INVALID.into());
    }
    if let Some(roots) = &query.roots {
        if roots.is_empty() || roots.len() > 32 {
            return Err(INVALID.into());
        }
        for path in roots {
            validate_path(path)?;
        }
    }
    if let Some(extensions) = &query.extensions
        && (extensions.is_empty()
            || extensions.len() > 16
            || extensions.iter().any(|extension| {
                !extension.starts_with('.')
                    || extension.len() < 2
                    || extension.len() > 32
                    || !extension[1..]
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            }))
    {
        return Err(INVALID.into());
    }
    let root = root_dir(root)?;
    let roots = query.roots.unwrap_or_else(|| vec![String::new()]);
    let mut traversal = Traversal {
        extensions: &query.extensions,
        text,
        token,
        scanned: 0,
        bytes: 0,
        entries: BTreeMap::new(),
    };
    for path in roots {
        cancelled(token)?;
        let dir = directory(&root, &path)?;
        traversal.walk(
            &dir,
            &path,
            path.split('/').filter(|part| !part.is_empty()).count(),
        )?;
    }
    cancelled(token)?;
    Ok(traversal.entries.into_values().collect())
}

pub(crate) fn read_many(
    root: &Path,
    paths: Vec<String>,
    token: &CancellationToken,
) -> Result<Vec<TextEntry>, String> {
    cancelled(token)?;
    if paths.len() > 256 {
        return Err(TOO_LARGE.into());
    }
    for path in &paths {
        validate_path(path)?;
    }
    let root = root_dir(root)?;
    let mut total = 0;
    let mut entries = Vec::new();
    for path in paths {
        cancelled(token)?;
        let (parent, name) = path.rsplit_once('/').unwrap_or(("", &path));
        let dir = directory(&root, parent)?;
        let bytes = read_bytes(
            regular_file(&dir, name)?,
            TEXT_LIMIT.min(TOTAL_LIMIT - total),
            token,
        )?;
        total += bytes.len();
        if bytes.contains(&0) {
            return Err(ERROR.into());
        }
        let text = String::from_utf8(bytes).map_err(|_| ERROR)?;
        let revision = situate_core::content::revision_for_text(&text).map_err(|_| ERROR)?;
        entries.push(TextEntry {
            path,
            text,
            revision,
        });
    }
    cancelled(token)?;
    Ok(entries)
}

#[cfg(test)]
#[path = "plugin_file_queries_tests.rs"]
mod tests;
