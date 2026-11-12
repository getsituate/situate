use super::history_records::Operation;
use super::operations::{
    Image, MAX_OPERATION_BYTES, OperationOutcome, read_operation_file, regenerate, rename_noreplace,
};
use super::*;
use std::collections::HashSet;

const MAX_FILES: usize = 256;
const MAX_IDENTITIES: usize = 4096;
const MAX_MANIFEST_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum PreparedFile {
    Text {
        path: String,
        text: String,
    },
    Source {
        path: String,
        #[serde(rename = "sourcePath")]
        source_path: String,
    },
}

struct StagedSource {
    path: String,
    revision: Oid,
    identity: same_file::Handle,
}

impl StagedSource {
    fn recheck(&self, store: &ContentStore, direct_sources: bool) -> Result<()> {
        let (bytes, identity) = if direct_sources {
            read_direct_source(&self.path, MAX_OPERATION_BYTES)?
        } else {
            store.read_import_source(&self.path, MAX_OPERATION_BYTES)?
        };
        if identity != self.identity
            || Oid::hash_object(git2::ObjectType::Blob, &bytes)? != self.revision
        {
            return Err(ContentError::InvalidBase);
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedFile {
    pub path: String,
    pub revision: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBatchOutcome {
    pub outcome: OperationOutcome,
    pub files: Vec<CreatedFile>,
    pub identity_map: HashMap<String, String>,
}

pub fn is_batch_manifest_path(path: &str) -> bool {
    path.strip_prefix(".situate/batch-")
        .and_then(|name| name.strip_suffix(".jsonl"))
        .is_some_and(|name| {
            !name.is_empty()
                && name.len() <= 128
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
}

impl ContentStore {
    fn read_import_source(&self, path: &str, limit: u64) -> Result<(Vec<u8>, same_file::Handle)> {
        let relative = path
            .strip_prefix(".situate/")
            .ok_or(ContentError::InvalidPath)?;
        let parts = validate_portable_path(relative)?;
        let valid_root = parts[0].strip_prefix("import-").is_some_and(|name| {
            !name.is_empty()
                && name.len() <= 128
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        });
        if !valid_root || parts.len() < 2 || parts.len() > 64 || path.len() > 4096 {
            return Err(ContentError::InvalidPath);
        }
        let mut dir = self.marker.try_clone()?;
        for part in &parts[..parts.len() - 1] {
            dir = child_dir(&dir, part)?;
        }
        read_operation_file(&dir, parts.last().unwrap(), limit)
    }

    pub fn read_batch_manifest(&self, path: &str) -> Result<TextVersion> {
        if !is_batch_manifest_path(path) {
            return Err(ContentError::InvalidPath);
        }
        let name = path
            .strip_prefix(".situate/")
            .ok_or(ContentError::InvalidPath)?;
        text_version(read_operation_file(&self.marker, name, MAX_MANIFEST_BYTES)?.0)
    }

    /// Stages temporary input outside content history. A publication error may
    /// follow replacement; reread the manifest before an explicit retry.
    pub fn write_batch_manifest(
        &self,
        path: &str,
        expected: Option<&str>,
        text: &str,
    ) -> Result<TextVersion> {
        if !is_batch_manifest_path(path) || text.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(ContentError::InvalidPath);
        }
        let name = path
            .strip_prefix(".situate/")
            .ok_or(ContentError::InvalidPath)?;
        let previous = match read_operation_file(&self.marker, name, MAX_MANIFEST_BYTES) {
            Ok((bytes, identity)) => Some((bytes, identity)),
            Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        let revision = previous
            .as_ref()
            .map(|(bytes, _)| {
                Oid::hash_object(git2::ObjectType::Blob, bytes).map(|id| id.to_string())
            })
            .transpose()?;
        if revision.as_deref() != expected {
            return Err(ContentError::InvalidBase);
        }
        let stage = temporary_file(&self.marker, text.as_bytes())?;
        let publication = (|| -> Result<()> {
            if let Some((bytes, identity)) = previous {
                let current = read_operation_file(&self.marker, name, MAX_MANIFEST_BYTES)?;
                if current.0 != bytes || current.1 != identity {
                    return Err(ContentError::InvalidBase);
                }
                self.marker.rename(&stage, &self.marker, name)?;
            } else {
                publish_new_file(&self.marker, &stage, name)?;
            }
            sync_dir(&self.marker)?;
            Ok(())
        })();
        let _ = self.marker.remove_file(&stage);
        publication?;
        version(text)
    }

    /// Reads internal JSON Lines with {path, text} or {path, sourcePath} entries.
    /// Sources must be regular files below .situate/import-<name>/; sources and
    /// manifest are unchanged. Parents must exist; every destination must be new.
    /// Content is bounded to 64 MiB per batch, with 1 MiB per inline text entry.
    /// Publication is create-only, not atomic across files. On partial failure,
    /// files lists verified publications, not a promise of completed history.
    pub fn create_batch(
        &mut self,
        manifest_path: &str,
        prepare_copy: bool,
        mut check_cancelled: impl FnMut() -> Result<()>,
    ) -> Result<CreateBatchOutcome> {
        check_cancelled()?;
        if !is_batch_manifest_path(manifest_path) {
            return Err(ContentError::InvalidPath);
        }
        let name = manifest_path
            .strip_prefix(".situate/")
            .ok_or(ContentError::InvalidPath)?;
        let (bytes, _) =
            read_operation_file(&self.marker, name, MAX_MANIFEST_BYTES).map_err(|error| {
                if error.to_string() == "native.content.operation.tooLarge" {
                    batch_too_large()
                } else {
                    error
                }
            })?;
        self.create_prepared_batch(
            serde_json::Deserializer::from_slice(&bytes)
                .into_iter::<PreparedFile>()
                .map(|entry| entry.map_err(|_| ContentError::InvalidBase)),
            false,
            prepare_copy,
            check_cancelled,
        )
    }

    /// Publishes bounded in-memory entries. Absolute sources are read with the
    /// application's existing OS access, without following symlinks or modifying
    /// originals. The caller must authorize the import scope. Partial results
    /// have the same semantics as manifest-based creation; no inputs are retained.
    pub fn create_batch_entries(
        &mut self,
        entries: Vec<PreparedFile>,
        prepare_copy: bool,
        check_cancelled: impl FnMut() -> Result<()>,
    ) -> Result<CreateBatchOutcome> {
        if entries.len() > MAX_FILES
            || serde_json::to_vec(&entries)
                .map_err(|_| ContentError::InvalidBase)?
                .len() as u64
                > MAX_MANIFEST_BYTES
        {
            return Err(batch_too_large());
        }
        self.create_prepared_batch(
            entries.into_iter().map(Ok),
            true,
            prepare_copy,
            check_cancelled,
        )
    }

    fn create_prepared_batch(
        &mut self,
        entries: impl IntoIterator<Item = Result<PreparedFile>>,
        direct_sources: bool,
        prepare_copy: bool,
        mut check_cancelled: impl FnMut() -> Result<()>,
    ) -> Result<CreateBatchOutcome> {
        check_cancelled()?;
        let mut image = Image {
            entries: Vec::new(),
        };
        let mut destinations = Vec::new();
        let mut sources = Vec::new();
        let mut total_bytes = 0_u64;
        let mut unique = HashSet::new();
        let drafts = self.drafts()?;
        for entry in entries {
            check_cancelled()?;
            let entry = entry?;
            if destinations.len() >= MAX_FILES {
                return Err(batch_too_large());
            }
            let (path, bytes, source) = match entry {
                PreparedFile::Text { path, text } => {
                    if text.len() > MAX_FILE_BYTES {
                        return Err(batch_too_large());
                    }
                    (path, text.into_bytes(), None)
                }
                PreparedFile::Source { path, source_path } => {
                    let (bytes, identity) = if direct_sources {
                        read_direct_source(&source_path, MAX_OPERATION_BYTES - total_bytes)?
                    } else {
                        self.read_import_source(&source_path, MAX_OPERATION_BYTES - total_bytes)?
                    };
                    let revision = Oid::hash_object(git2::ObjectType::Blob, &bytes)?;
                    (
                        path,
                        bytes,
                        Some(StagedSource {
                            path: source_path,
                            revision,
                            identity,
                        }),
                    )
                }
            };
            total_bytes += bytes.len() as u64;
            if total_bytes > MAX_OPERATION_BYTES {
                return Err(batch_too_large());
            }
            validate_portable_path(&path)?;
            if path.len() > 4096 || path.split('/').count() > 64 || !unique.insert(path.clone()) {
                return Err(ContentError::InvalidPath);
            }
            if drafts.iter().any(|draft| draft.path == path) {
                return Err(ContentError::Busy);
            }
            let (dir, name) = self.parent(&path)?;
            require_absent(&dir, &name, "native.content.destination.occupied")?;
            destinations.push(path.clone());
            image.entries.push((path, Some(bytes)));
            sources.push(source);
        }
        if destinations.is_empty() {
            return Err(ContentError::InvalidBase);
        }
        if serde_json::to_vec(&destinations)
            .map_err(|_| ContentError::InvalidBase)?
            .len()
            > super::history_records::MAX_BATCH_PATH_BYTES
        {
            return Err(batch_too_large());
        }
        // One mapping covers identity links between all copies in this batch.
        let identity_map = if prepare_copy {
            regenerate(&mut image, "", &HashSet::new())?
        } else {
            HashMap::new()
        };
        if identity_map.len() > MAX_IDENTITIES {
            return Err(batch_too_large());
        }
        let mut copies = Vec::new();
        let mut task_count = 0;
        total_bytes = 0;
        for ((path, bytes), source) in image.entries.iter().zip(&sources) {
            let bytes = bytes.as_ref().ok_or(ContentError::InvalidBase)?;
            total_bytes += bytes.len() as u64;
            if total_bytes > MAX_OPERATION_BYTES || source.is_none() && bytes.len() > MAX_FILE_BYTES
            {
                return Err(batch_too_large());
            }
            if prepare_copy
                && is_markdown(path)
                && let FileContent::Text(text) = classify_file(bytes)?
            {
                task_count += crate::metadata::inspect(text).tasks.len();
                if task_count > MAX_IDENTITIES {
                    return Err(batch_too_large());
                }
            }
            copies.push(CreatedFile {
                path: path.clone(),
                revision: Oid::hash_object(git2::ObjectType::Blob, bytes)?.to_string(),
            });
        }
        let recovery = self.record_external_changes()?;
        let mut stages = Vec::new();
        for (path, bytes) in &image.entries {
            check_cancelled()?;
            let (dir, name) = self.parent(path)?;
            require_absent(&dir, &name, "native.content.destination.occupied")?;
            let stage = temporary_file(&dir, bytes.as_ref().ok_or(ContentError::InvalidBase)?)?;
            stages.push(stage);
        }
        check_cancelled()?;
        for source in sources.iter().flatten() {
            source.recheck(self, direct_sources)?;
        }
        let boundary = self.begin_operation(
            Operation::CreateBatch { destinations },
            None,
            &[],
            Some((&image, "")),
        )?;
        let mut changed = Vec::new();
        let mut verified = 0;
        let publication = (|| -> Result<()> {
            for ((stage, copy), source) in stages.iter().zip(&copies).zip(&sources) {
                check_cancelled()?;
                if let Some(source) = source {
                    source.recheck(self, direct_sources)?;
                }
                let (dir, name) = self.parent(&copy.path)?;
                let (bytes, identity) = read_operation_file(&dir, stage, MAX_OPERATION_BYTES)?;
                if Oid::hash_object(git2::ObjectType::Blob, &bytes)?.to_string() != copy.revision {
                    return Err(ContentError::InvalidBase);
                }
                rename_noreplace(&dir, stage, &dir, &name)?;
                changed.push(copy.path.clone());
                let (current, name) = self.parent(&copy.path)?;
                let (bytes, published) = read_operation_file(&current, &name, MAX_OPERATION_BYTES)?;
                if identity != published
                    || Oid::hash_object(git2::ObjectType::Blob, &bytes)?.to_string()
                        != copy.revision
                {
                    return Err(ContentError::InvalidBase);
                }
                verified += 1;
            }
            let mut synced = HashSet::new();
            for copy in &copies {
                let parent = copy.path.rsplit_once('/').map_or("", |(parent, _)| parent);
                if synced.insert(parent) {
                    let (dir, _) = self.parent(&copy.path)?;
                    sync_dir(&dir)?;
                }
            }
            Ok(())
        })();
        let outcome = self.finish_structural(
            changed,
            recovery,
            boundary,
            "native.history.copyContent",
            publication,
        );
        copies.truncate(verified);
        Ok(CreateBatchOutcome {
            outcome,
            files: copies,
            identity_map,
        })
    }
}

fn read_direct_source(path: &str, limit: u64) -> Result<(Vec<u8>, same_file::Handle)> {
    let source = Path::new(path);
    if !source.is_absolute()
        || path.len() > 4096
        || path.contains('\0')
        || path
            .split(['/', '\\'])
            .any(|part| matches!(part, "." | ".."))
        || source.components().count() > 65
    {
        return Err(ContentError::InvalidPath);
    }
    let root = source.ancestors().last().ok_or(ContentError::InvalidPath)?;
    let mut dir = Dir::open_ambient_dir(root, ambient_authority())?;
    let relative = source
        .strip_prefix(root)
        .map_err(|_| ContentError::InvalidPath)?;
    let mut parts = relative.components().peekable();
    while let Some(part) = parts.next() {
        let std::path::Component::Normal(name) = part else {
            return Err(ContentError::InvalidPath);
        };
        let name = name.to_str().ok_or(ContentError::InvalidPath)?;
        if parts.peek().is_none() {
            return read_operation_file(&dir, name, limit);
        }
        dir = child_dir(&dir, name)?;
    }
    Err(ContentError::InvalidPath)
}

fn batch_too_large() -> ContentError {
    ContentError::Io(io::Error::other("native.content.operation.tooLarge"))
}

#[cfg(test)]
mod direct_tests;
#[cfg(test)]
mod tests;
