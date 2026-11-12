//! Device-local manual invocation receipts. Loading records never dispatches or resumes work.

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::PathBuf,
};

const INVALID: &str = "native.plugins.actionInvalid";
const CONFLICT: &str = "native.plugins.actionConflict";
const SAVE_FAILED: &str = "native.plugins.actionSaveFailed";
const UNKNOWN: &str = "native.plugins.actionOutcomeUnknown";
const READ_FAILED: &str = "native.plugins.actionReadFailed";
const MAX_BYTES: usize = 256 * 1024;
const MAX_ITEMS: usize = 256;

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Running,
    Completed,
    Failed,
    Disconnected,
}

impl Status {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Disconnected)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    pub request_id: String,
    pub receipt: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    version: u32,
    id: String,
    scope_fingerprint: String,
    plugin_id: String,
    generation: u64,
    export_name: String,
    revision: u64,
    status: Status,
    observations: Vec<Observation>,
    uncertain: bool,
}

impl Record {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn status(&self) -> Status {
        self.status
    }
    pub fn uncertain(&self) -> bool {
        self.uncertain
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn observations(&self) -> &[Observation] {
        &self.observations
    }

    /// Receipts must already be sanitized by the native broker; payloads and free-form output are not accepted.
    pub fn observe(&self, request_id: &str, receipt: Value) -> Result<Self> {
        if self.status.is_terminal() || self.observations.iter().any(|o| o.request_id == request_id)
        {
            return Err(CONFLICT.into());
        }
        let mut next = self.next()?;
        next.observations.push(Observation {
            request_id: request_id.into(),
            receipt,
        });
        next.validate()?;
        Ok(next)
    }

    pub fn terminal(&self, status: Status, uncertain: bool) -> Result<Self> {
        if self.status.is_terminal()
            || !status.is_terminal()
            || (status == Status::Completed && uncertain)
        {
            return Err(CONFLICT.into());
        }
        let mut next = self.next()?;
        next.status = status;
        next.uncertain = uncertain;
        next.validate()?;
        Ok(next)
    }

    fn next(&self) -> Result<Self> {
        let mut next = self.clone();
        next.revision = next.revision.checked_add(1).ok_or(INVALID)?;
        Ok(next)
    }

    fn validate(&self) -> Result<()> {
        if self.version != 2
            || !uuid(&self.id)
            || !fingerprint(&self.scope_fingerprint)
            || !super::valid_id(&self.plugin_id)
            || !identifier(&self.export_name)
            || self.observations.len() > MAX_ITEMS
            || (self.status == Status::Completed && self.uncertain)
        {
            return Err(INVALID.into());
        }
        let mut ids = std::collections::HashSet::new();
        for observation in &self.observations {
            if !uuid(&observation.request_id) || !ids.insert(&observation.request_id) {
                return Err(INVALID.into());
            }
            receipt(&observation.receipt)?;
        }
        if serde_json::to_vec(self).map_err(|_| INVALID)?.len() > MAX_BYTES {
            return Err(INVALID.into());
        }
        Ok(())
    }
}

fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

fn fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(i, b)| {
            b.is_ascii_alphabetic() || matches!(b, b'_' | b'$') || (i > 0 && b.is_ascii_digit())
        })
}

fn receipt(value: &Value) -> Result<()> {
    let object = value.as_object().ok_or(INVALID)?;
    if object.len() > 12 {
        return Err(INVALID.into());
    }
    for (key, value) in object {
        if !matches!(
            key.as_str(),
            "outcome"
                | "status"
                | "code"
                | "success"
                | "uncertain"
                | "statusCode"
                | "exitCode"
                | "bytes"
                | "count"
                | "revision"
                | "durationMs"
        ) || !match value {
            Value::Null | Value::Bool(_) | Value::Number(_) => true,
            Value::String(s) => {
                !s.is_empty()
                    && s.len() <= 128
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
            }
            _ => false,
        } {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    /// The dedicated ledger directory's parent must exist. Serialize all writes for each invocation.
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn create(
        &self,
        id: &str,
        scope_fingerprint: &str,
        plugin_id: &str,
        generation: u64,
        export_name: &str,
    ) -> Result<Record> {
        let record = Record {
            version: 2,
            id: id.into(),
            scope_fingerprint: scope_fingerprint.into(),
            plugin_id: plugin_id.into(),
            generation,
            export_name: export_name.into(),
            revision: 0,
            status: Status::Running,
            observations: vec![],
            uncertain: false,
        };
        record.validate()?;
        let dir = self.directory(true)?;
        self.write(&dir, &record, true)?;
        Ok(record)
    }

    /// Only Ok acknowledges durability. Retry this same staged record after failure; never retry its effects.
    /// A post-rename failure returns actionOutcomeUnknown without rolling back visible bytes.
    pub fn save(&self, record: &Record) -> Result<()> {
        record.validate()?;
        let dir = self.directory(false)?;
        let previous = Self::read(&dir, record.id())?;
        if previous != *record
            && (previous.revision.checked_add(1) != Some(record.revision)
                || previous.status.is_terminal()
                || previous.id != record.id
                || previous.scope_fingerprint != record.scope_fingerprint
                || previous.plugin_id != record.plugin_id
                || previous.generation != record.generation
                || previous.export_name != record.export_name)
        {
            return Err(CONFLICT.into());
        }
        self.write(&dir, record, false)
    }

    pub fn load(&self, id: &str) -> Result<Record> {
        if !uuid(id) {
            return Err(INVALID.into());
        }
        Self::read(&self.directory(false)?, id)
    }

    fn directory(&self, create: bool) -> Result<Dir> {
        let parent = Dir::open_ambient_dir(self.root.parent().ok_or(INVALID)?, ambient_authority())
            .map_err(|_| READ_FAILED)?;
        let name = self
            .root
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or(INVALID)?;
        if create {
            match parent.create_dir(name) {
                Ok(()) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        parent
                            .set_permissions(
                                name,
                                cap_std::fs::Permissions::from_std(
                                    std::fs::Permissions::from_mode(0o700),
                                ),
                            )
                            .map_err(|_| SAVE_FAILED)?;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(SAVE_FAILED.into()),
            }
            crate::durable_storage::sync_directory(&parent).map_err(|_| UNKNOWN)?;
        }
        super::child(&parent, name).map_err(|_| READ_FAILED.into())
    }

    fn read(dir: &Dir, id: &str) -> Result<Record> {
        let name = format!("{id}.json");
        let metadata = dir.symlink_metadata(&name).map_err(|_| READ_FAILED)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(READ_FAILED.into());
        }
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = dir.open_with(&name, &options).map_err(|_| READ_FAILED)?;
        let metadata = file.metadata().map_err(|_| READ_FAILED)?;
        if !metadata.is_file() || metadata.len() > MAX_BYTES as u64 {
            return Err(INVALID.into());
        }
        #[cfg(unix)]
        {
            use cap_std::fs::{MetadataExt, PermissionsExt};
            if metadata.nlink() != 1 || metadata.permissions().mode() & 0o777 != 0o600 {
                return Err(INVALID.into());
            }
        }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| READ_FAILED)?;
        if bytes.len() > MAX_BYTES {
            return Err(INVALID.into());
        }
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        record.validate()?;
        if record.id != id {
            return Err(INVALID.into());
        }
        Ok(record)
    }

    fn write(&self, dir: &Dir, record: &Record, create: bool) -> Result<()> {
        let temp = format!("{}.tmp", uuid::Uuid::new_v4());
        let target = format!("{}.json", record.id);
        let mut renamed = false;
        let result = (|| -> Result<()> {
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
            let mut file = dir.open_with(&temp, &options).map_err(|_| SAVE_FAILED)?;
            file.write_all(&serde_json::to_vec(record).map_err(|_| INVALID)?)
                .map_err(|_| SAVE_FAILED)?;
            fail_at("file-sync")?;
            file.sync_all().map_err(|_| SAVE_FAILED)?;
            fail_at("rename")?;
            if create {
                crate::durable_storage::rename_noreplace(dir, &temp, dir, &target).map_err(
                    |e| {
                        if e.kind() == std::io::ErrorKind::AlreadyExists {
                            CONFLICT
                        } else {
                            SAVE_FAILED
                        }
                    },
                )?;
            } else {
                dir.rename(&temp, dir, &target).map_err(|_| SAVE_FAILED)?;
            }
            renamed = true;
            fail_at("directory-sync").map_err(|_| UNKNOWN)?;
            crate::durable_storage::sync_directory(dir).map_err(|_| UNKNOWN.into())
        })();
        if !renamed {
            let _ = dir.remove_file(&temp);
        }
        result
    }
}

#[cfg(not(test))]
fn fail_at(_: &str) -> Result<()> {
    Ok(())
}

#[cfg(test)]
fn fail_at(point: &str) -> Result<()> {
    if tests::FAILURE.get() == Some(point) {
        tests::FAILURE.set(None);
        Err(SAVE_FAILED.into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests;
