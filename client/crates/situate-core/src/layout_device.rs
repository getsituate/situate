use super::*;
use cap_std::fs::Dir;

fn child(parent: &Dir, name: &str) -> Result<Dir, String> {
    let mut builder = cap_std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use cap_std::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match parent.create_dir_with(name, &builder) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(_) => return Err(FAILED.into()),
    }
    let dir = cap_primitives::fs::open_dir_nofollow(
        &parent.try_clone().map_err(|_| FAILED)?.into_std_file(),
        Path::new(name),
    )
    .map(Dir::from_std_file)
    .map_err(|_| FAILED)?;
    // Sync even on reopen: an earlier mkdir may have been interrupted before its parent sync.
    crate::durable_storage::sync_directory(parent).map_err(|_| FAILED)?;
    Ok(dir)
}

#[cfg(test)]
thread_local! { pub(super) static INTERRUPT: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) }; }

fn migration_checkpoint(_point: &str) -> Result<(), String> {
    #[cfg(test)]
    if INTERRUPT.with(|interrupt| interrupt.get() == Some(_point)) {
        return Err(FAILED.into());
    }
    Ok(())
}

fn archive_file(source: &Dir, destination: &Dir, name: &str) -> Result<(), String> {
    let bytes = plugins::read(source, name, MAX_LAYOUT_BYTES)?.ok_or(FAILED)?;
    plugins::write_immutable(destination, name, &bytes)?;
    migration_checkpoint("archived")?;
    if plugins::read(source, name, MAX_LAYOUT_BYTES)?.as_ref() != Some(&bytes) {
        return Err(CONFLICT.into());
    }
    source.remove_file(name).map_err(|_| FAILED)?;
    migration_checkpoint("payload-removed")?;
    crate::durable_storage::sync_directory(source).map_err(|_| FAILED.into())
}

fn archive_tree(source: &Dir, destination: &Dir) -> Result<(), String> {
    for entry in source.entries().map_err(|_| FAILED)? {
        let entry = entry.map_err(|_| FAILED)?;
        let name = entry.file_name().into_string().map_err(|_| INVALID)?;
        let metadata = source.symlink_metadata(&name).map_err(|_| FAILED)?;
        if metadata.is_dir() {
            let source_child = plugins::child(source, &name)?.ok_or(FAILED)?;
            let destination_child = child(destination, &name)?;
            archive_tree(&source_child, &destination_child)?;
            drop(source_child);
            source.remove_dir(&name).map_err(|_| FAILED)?;
            crate::durable_storage::sync_directory(source).map_err(|_| FAILED)?;
        } else if metadata.is_file() {
            archive_file(source, destination, &name)?;
        } else {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

fn archive_portable_layout_payloads(workspace: &Dir, device: &Dir) -> Result<(), String> {
    if let Some(inventory) = plugins::child(workspace, "plugins")? {
        for entry in inventory.entries().map_err(|_| FAILED)? {
            let name = entry
                .map_err(|_| FAILED)?
                .file_name()
                .into_string()
                .map_err(|_| INVALID)?;
            let metadata = inventory.symlink_metadata(&name).map_err(|_| FAILED)?;
            if !metadata.is_dir() {
                continue;
            }
            let plugin = plugins::child(&inventory, &name)?.ok_or(INVALID)?;
            let Some(runtime) = plugins::child(&plugin, ".runtime")? else {
                continue;
            };
            let Some(presentation) = plugins::child(&runtime, "presentation")? else {
                continue;
            };
            if !crate::plugins::valid_id(&name) {
                return Err(INVALID.into());
            }
            let recovery = child(device, "legacy-layout-recovery")?;
            let records = child(&recovery, "presentation")?;
            let destination = child(&records, &name)?;
            archive_tree(&presentation, &destination)?;
            drop(presentation);
            runtime.remove_dir("presentation").map_err(|_| FAILED)?;
            crate::durable_storage::sync_directory(&runtime).map_err(|_| FAILED)?;
        }
    }
    for entry in workspace.entries().map_err(|_| FAILED)? {
        let name = entry.map_err(|_| FAILED)?.file_name();
        let Some(name) = name.to_str() else { continue };
        if (name.starts_with("layout-legacy-recovery-") && name.ends_with(".json"))
            || (name.starts_with("layout-") && name.ends_with(".tmp"))
        {
            let recovery = child(device, "legacy-layout-recovery")?;
            archive_file(workspace, &recovery, name)?;
        }
    }
    Ok(())
}

impl LayoutStorage {
    /// The caller retains workspace preparation/access leases. Scope binds references only;
    /// the canonical location selects device-local state independently of runtime authorization.
    pub fn open_device(path: &Path, scope: &str, app_data: &Path) -> Result<Self, String> {
        let mut storage = Storage::open(path, scope)
            .and_then(|storage| storage.with_device_store(app_data))
            .map_err(|_| FAILED)?;
        let device = storage.device.as_mut().ok_or(FAILED)?;
        let root = child(&device.dir, "workspace-layouts")?;
        let mut hash = Sha1CD::default();
        let location = path.canonicalize().map_err(|_| FAILED)?;
        hash.update(location.as_os_str().as_encoded_bytes());
        let digest = hash.finalize_cd().map_err(|_| FAILED)?;
        let namespace: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        device.dir = child(&root, &namespace)?;
        Ok(Self(storage))
    }

    pub(super) fn files(&self) -> &Storage {
        self.0.device.as_deref().unwrap_or(&self.0)
    }

    pub(super) fn records(&self) -> Option<&Dir> {
        self.0.device.as_deref().map(|device| &device.dir)
    }

    pub(super) fn migrate(&self) -> Result<(), String> {
        let Some(device) = self.0.device.as_deref() else {
            return Ok(());
        };
        let Some(source) = read_file(&self.0)? else {
            // The legacy host is removed last, so an existing local layout needs no further scan.
            match device.dir.symlink_metadata(FILE) {
                Ok(_) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err(FAILED.into()),
            }
            return archive_portable_layout_payloads(&self.0.dir, &device.dir);
        };
        let destination = read_file(device)?;
        if destination.as_ref().is_some_and(|bytes| bytes != &source) {
            // Never choose between two independently retained layouts.
            return Err(CONFLICT.into());
        }
        if destination.is_none() {
            decode_with_records(&source, &self.0, None)?;
            let envelope: Envelope = serde_json::from_slice(&source).map_err(|_| INVALID)?;
            plugins::migrate_records(&self.0.dir, &device.dir, &envelope.data)?;
            decode(&source, &self.0)?;
            migration_checkpoint("records")?;
            let temporary = format!("layout-{}.tmp", uuid::Uuid::new_v4());
            if !device
                .replace(FILE, &temporary, &source)
                .map_err(|_| FAILED)?
            {
                return Err("native.layout.storage.durability".into());
            }
        } else {
            decode(&source, &self.0)?;
            // The rename may have survived a failed directory sync in an earlier process.
            use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
            let mut options = cap_std::fs::OpenOptions::new();
            options
                .read(true)
                .write(cfg!(windows))
                .follow(FollowSymlinks::No);
            let file = device.dir.open_with(FILE, &options).map_err(|_| FAILED)?;
            file.sync_all().map_err(|_| FAILED)?;
            if !device.sync_directory() {
                return Err("native.layout.storage.durability".into());
            }
        }
        migration_checkpoint("published")?;
        archive_portable_layout_payloads(&self.0.dir, &device.dir)?;
        if read_file(&self.0)?.as_deref() != Some(&source) {
            return Err(CONFLICT.into());
        }
        self.0.dir.remove_file(FILE).map_err(|_| FAILED)?;
        migration_checkpoint("removed")?;
        if !self.0.sync_directory() {
            return Err("native.layout.storage.durability".into());
        }
        Ok(())
    }
}
