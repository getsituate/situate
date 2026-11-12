use crate::{MigrationError, MigrationErrorKind, Result, filesystem as fs, metadata};
use cap_std::fs::{Dir, File, Permissions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
};

pub(crate) const TEMPORARY: &str = "backup.tar.tmp";
pub(crate) const RECOVERABLE: &str = "backup.tar";
pub(crate) const RETIRED: &str = "retired.tar";
const MANIFEST_LIMIT: u64 = 16 * 1024 * 1024;

#[derive(Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    directory: bool,
    mode: u32,
    bytes: u64,
    digest: String,
}
type Manifest = BTreeMap<String, Entry>;

pub(crate) struct VerifiedBackup {
    file: File,
    pub metadata: Option<serde_json::Value>,
}

struct Hashed<R> {
    reader: R,
    hash: Sha256,
    bytes: u64,
}
impl<R: Read> Hashed<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            hash: Sha256::new(),
            bytes: 0,
        }
    }
}
impl<R: Read> Read for Hashed<R> {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        let read = self.reader.read(bytes)?;
        self.hash.update(&bytes[..read]);
        self.bytes += read as u64;
        Ok(read)
    }
}

#[cfg(unix)]
fn mode(metadata: &cap_std::fs::Metadata) -> u32 {
    use cap_std::fs::PermissionsExt;
    metadata.permissions().mode() & 0o777
}
#[cfg(not(unix))]
fn mode(_: &cap_std::fs::Metadata) -> u32 {
    0o600
}
fn set_mode(dir: &Dir, name: &str, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use cap_std::fs::PermissionsExt;
        dir.set_permissions(name, Permissions::from_mode(mode))?;
    }
    let _ = (dir, name, mode);
    Ok(())
}
fn invalid() -> MigrationError {
    MigrationError::new(MigrationErrorKind::RestorationFailed)
}
fn header(directory: bool, mode: u32, bytes: u64) -> tar::Header {
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(if directory {
        tar::EntryType::Directory
    } else {
        tar::EntryType::Regular
    });
    header.set_mode(mode);
    header.set_uid(0);
    header.set_gid(0);
    header.set_mtime(0);
    header.set_size(bytes);
    header
}
fn pack(
    dir: &Dir,
    prefix: &Path,
    archive: &mut tar::Builder<&mut File>,
    manifest: &mut Manifest,
) -> Result<()> {
    for name in fs::names(dir)? {
        if prefix.as_os_str().is_empty() && name == fs::CONTROL {
            continue;
        }
        let path = prefix.join(&name);
        let metadata = dir.symlink_metadata(&name)?;
        let directory = metadata.is_dir();
        if !directory && !metadata.is_file() {
            return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
        }
        let mode = mode(&metadata);
        let mut header = header(directory, mode, if directory { 0 } else { metadata.len() });
        let (bytes, digest) = if directory {
            archive.append_data(
                &mut header,
                Path::new("payload").join(&path),
                std::io::empty(),
            )?;
            (0, String::new())
        } else {
            let file = fs::open_read(dir, &name)?;
            let mut reader = Hashed::new(file.take(metadata.len()));
            archive.append_data(&mut header, Path::new("payload").join(&path), &mut reader)?;
            if reader.bytes != metadata.len() {
                return Err(MigrationError::new(MigrationErrorKind::Io));
            }
            (reader.bytes, format!("{:x}", reader.hash.finalize()))
        };
        fs::checkpoint("copy-write")?;
        manifest.insert(
            path.to_str().ok_or_else(invalid)?.to_owned(),
            Entry {
                directory,
                mode,
                bytes,
                digest,
            },
        );
        if directory {
            pack(&fs::child(dir, &name)?, &path, archive, manifest)?;
        }
        fs::checkpoint("copy-entry")?;
    }
    Ok(())
}
fn payload_path(path: &Path) -> Result<PathBuf> {
    let relative = path.strip_prefix("payload").map_err(|_| invalid())?;
    let components: Vec<_> = relative.components().collect();
    if components.is_empty()
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
        || components[0]
            .as_os_str()
            .to_str()
            .is_none_or(|name| name.eq_ignore_ascii_case(fs::CONTROL))
    {
        return Err(invalid());
    }
    Ok(components.iter().collect())
}
fn inspect(file: &mut File) -> Result<Option<serde_json::Value>> {
    let mut archive = tar::Archive::new(file);
    let mut actual = Manifest::new();
    let mut expected = None;
    let mut compatibility = None;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if expected.is_some() {
            return Err(invalid());
        }
        if path == Path::new("manifest.json") {
            if !entry.header().entry_type().is_file() || entry.size() > MANIFEST_LIMIT {
                return Err(invalid());
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            expected = Some(serde_json::from_slice::<Manifest>(&bytes).map_err(|_| invalid())?);
            continue;
        }
        let path = payload_path(&path)?;
        let name = path.to_str().ok_or_else(invalid)?;
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            && !actual
                .get(parent.to_str().ok_or_else(invalid)?)
                .is_some_and(|entry: &Entry| entry.directory)
        {
            return Err(invalid());
        }
        let directory = entry.header().entry_type().is_dir();
        if (!directory && !entry.header().entry_type().is_file())
            || (directory && entry.size() != 0)
        {
            return Err(invalid());
        }
        let mode = entry.header().mode()?;
        if mode & !0o777 != 0 {
            return Err(invalid());
        }
        let size = entry.size();
        let mut reader = Hashed::new(entry);
        if name == metadata::FILE {
            if directory || size > metadata::LIMIT {
                return Err(invalid());
            }
            let mut bytes = Vec::new();
            reader.read_to_end(&mut bytes)?;
            compatibility = Some(metadata::decode(&bytes)?);
        } else {
            std::io::copy(&mut reader, &mut std::io::sink())?;
        }
        if reader.bytes != size {
            return Err(invalid());
        }
        let value = Entry {
            directory,
            mode,
            bytes: reader.bytes,
            digest: if directory {
                String::new()
            } else {
                format!("{:x}", reader.hash.finalize())
            },
        };
        if actual.insert(name.to_owned(), value).is_some() {
            return Err(invalid());
        }
    }
    if expected.as_ref() != Some(&actual) {
        return Err(invalid());
    }
    Ok(compatibility)
}

pub(crate) fn pending(control: &Dir) -> Result<bool> {
    for name in [TEMPORARY, RECOVERABLE, RETIRED] {
        if fs::exists(control, name)? {
            return Ok(true);
        }
    }
    Ok(false)
}
pub(crate) fn create(managed: &Dir, control: &Dir) -> Result<()> {
    if pending(control)? {
        return Err(MigrationError::new(MigrationErrorKind::Io));
    }
    let mut file = control.open_with(
        TEMPORARY,
        fs::options().read(true).write(true).create_new(true),
    )?;
    fs::sync(control)?;
    let mut archive = tar::Builder::new(&mut file);
    let mut manifest = Manifest::new();
    pack(managed, Path::new(""), &mut archive, &mut manifest)?;
    fs::checkpoint("backup-copied")?;
    let bytes =
        serde_json::to_vec(&manifest).map_err(|_| MigrationError::new(MigrationErrorKind::Io))?;
    if bytes.len() as u64 > MANIFEST_LIMIT {
        return Err(MigrationError::new(MigrationErrorKind::Io));
    }
    archive.append_data(
        &mut header(false, 0o600, bytes.len() as u64),
        "manifest.json",
        bytes.as_slice(),
    )?;
    archive.finish()?;
    drop(archive);
    file.flush()?;
    fs::checkpoint("file-sync")?;
    file.sync_all()?;
    file.seek(SeekFrom::Start(0))?;
    inspect(&mut file).map_err(|error| error.with_kind(MigrationErrorKind::Io))?;
    drop(file);
    fs::checkpoint("backup-complete")?;
    fs::checkpoint("publish-rename")?;
    control.rename(TEMPORARY, control, RECOVERABLE)?;
    fs::checkpoint("backup-published")?;
    fs::sync(control)?;
    fs::checkpoint("backup-durable")?;
    Ok(())
}
pub(crate) fn verify(control: &Dir) -> Result<VerifiedBackup> {
    let mut file = fs::open_read(control, RECOVERABLE)?;
    let metadata = inspect(&mut file)?;
    file.seek(SeekFrom::Start(0))?;
    Ok(VerifiedBackup { file, metadata })
}
pub(crate) fn restore(managed: &Dir, control: &Dir) -> Result<()> {
    let backup = verify(control)?;
    fs::sync(control)?;
    set_mode(managed, ".", 0o700)?;
    for name in fs::names(managed)? {
        if name != fs::CONTROL {
            fs::remove_tree(managed, &name)?;
            fs::checkpoint("restore-remove")?;
        }
    }
    fs::checkpoint("restore-empty")?;
    let mut directories = Vec::new();
    for entry in tar::Archive::new(backup.file).entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if path == Path::new("manifest.json") {
            continue;
        }
        let path = payload_path(&path)?;
        let mut parent = managed.try_clone()?;
        for component in path.parent().ok_or_else(invalid)?.components() {
            parent = fs::child(&parent, component.as_os_str())?;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(invalid)?;
        let mode = entry.header().mode()?;
        if entry.header().entry_type().is_dir() {
            fs::ensure_child(&parent, name)?;
            directories.push((path, mode));
        } else {
            let mut to = parent.open_with(name, fs::options().write(true).create_new(true))?;
            std::io::copy(&mut entry, &mut to)?;
            fs::checkpoint("restore-write")?;
            set_mode(&parent, name, mode)?;
            to.sync_all()?;
            fs::sync(&parent)?;
        }
        fs::checkpoint("restore-entry")?;
    }
    for (path, mode) in directories.into_iter().rev() {
        let dir = fs::child(managed, &path)?;
        set_mode(&dir, ".", mode)?;
        fs::sync(&dir)?;
    }
    fs::sync(managed)?;
    fs::checkpoint("restored")
}
fn remove_archive(control: &Dir, name: &str) -> Result<()> {
    fs::regular(control, name)?;
    fs::checkpoint("delete-entry")?;
    control.remove_file(name)?;
    fs::checkpoint("entry-deleted")?;
    fs::sync(control)
}
pub(crate) fn cleanup(control: &Dir) -> Result<()> {
    if fs::exists(control, RETIRED)? {
        fs::sync(control)?;
        fs::checkpoint("cleanup-start")?;
        remove_archive(control, RETIRED)?;
        fs::checkpoint("cleanup-finished")?;
    }
    if fs::exists(control, TEMPORARY)? {
        remove_archive(control, TEMPORARY)?;
    }
    fs::sync(control)
}
pub(crate) fn retire(control: &Dir) -> Result<()> {
    if fs::exists(control, RETIRED)? {
        return Err(MigrationError::new(MigrationErrorKind::CleanupFailed));
    }
    fs::checkpoint("retire-start")?;
    fs::checkpoint("retire-rename")?;
    control.rename(RECOVERABLE, control, RETIRED)?;
    fs::checkpoint("backup-retired")?;
    fs::sync(control)?;
    fs::checkpoint("retirement-durable")?;
    cleanup(control)
}
