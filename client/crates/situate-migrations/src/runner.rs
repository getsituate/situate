use crate::{
    MigrationDescriptor, MigrationError, MigrationErrorKind, MigrationWorkspace,
    PluginHistoryMigration, Result, backup, filesystem as fs, metadata, registry,
};
use cap_std::{ambient_authority, fs::Dir};
use std::{
    fs::File,
    path::{Path, PathBuf},
};

/// Retain this lease in the admitted session and every in-flight authorization.
/// Closing a view must not release it while workspace execution continues.
#[derive(Debug)]
pub struct WorkspaceLease {
    lock: File,
    root: Dir,
    managed: Dir,
    path: PathBuf,
}
impl WorkspaceLease {
    /// Recheck pathname binding before reusing an admitted session.
    pub fn validate(&self) -> Result<()> {
        let root = Dir::open_ambient_dir(&self.path, ambient_authority())?;
        let managed = fs::child(&root, ".situate")?;
        let same = |a: &Dir, b: &Dir| -> Result<bool> {
            Ok(
                same_file::Handle::from_file(a.try_clone()?.into_std_file())?
                    == same_file::Handle::from_file(b.try_clone()?.into_std_file())?,
            )
        };
        if !same(&self.root, &root)? || !same(&self.managed, &managed)? {
            return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
        }
        let control = fs::child(&managed, fs::CONTROL)?;
        let lock = fs::open_read(&control, "workspace.lock")?.into_std();
        if same_file::Handle::from_file(self.lock.try_clone()?)?
            != same_file::Handle::from_file(lock)?
        {
            return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
        }
        if !current(&managed, &control, registry::MIGRATIONS)? {
            return Err(MigrationError::new(MigrationErrorKind::Busy));
        }
        Ok(())
    }
}
impl Drop for WorkspaceLease {
    fn drop(&mut self) {
        let _ = self.lock.unlock();
    }
}
fn current(managed: &Dir, control: &Dir, migrations: &[MigrationDescriptor]) -> Result<bool> {
    if backup::pending(control)? {
        return Ok(false);
    }
    let Some(value) = metadata::load(managed)? else {
        return Ok(false);
    };
    let position = metadata::require_reader(&value, migrations)?;
    Ok(position >= migrations.last().map_or(0, |m| m.version.0) && !backup::pending(control)?)
}

/// Prepare an authorized workspace root before any normal managed-data access.
/// Lock contention fails busy; this call never waits for another workspace owner.
/// Existing metadata-free markers are legacy input, not empty workspaces.
pub fn prepare(root: &Path) -> Result<WorkspaceLease> {
    admit(root, registry::MIGRATIONS, false, None)
}

/// Prepare a workspace with a history adapter for pinned plugin revisions.
/// The adapter runs inside the migration's exclusive lease and managed-data backup.
pub fn prepare_with_plugin_history(
    root: &Path,
    migrate: PluginHistoryMigration,
) -> Result<WorkspaceLease> {
    admit(root, registry::MIGRATIONS, false, Some(migrate))
}

#[cfg(test)]
pub(crate) fn prepare_with(
    root: &Path,
    migrations: &[MigrationDescriptor],
) -> Result<WorkspaceLease> {
    admit(root, migrations, false, None)
}

/// Admit a closed, already-current workspace without migrating it.
pub fn lock_current_exclusively(root: &Path) -> Result<WorkspaceLease> {
    admit(root, registry::MIGRATIONS, true, None)
}

fn admit(
    root: &Path,
    migrations: &[MigrationDescriptor],
    exclusive: bool,
    plugin_history: Option<PluginHistoryMigration>,
) -> Result<WorkspaceLease> {
    registry::validate(migrations)?;
    let path = std::path::absolute(root)?;
    let root = Dir::open_ambient_dir(&path, ambient_authority())?;
    let managed = fs::child(&root, ".situate")?;
    if !fs::exists(&managed, fs::CONTROL)?
        && let Some(value) = metadata::load(&managed)?
    {
        metadata::require_reader(&value, migrations)?;
    }
    let control = if exclusive {
        fs::child(&managed, fs::CONTROL)?
    } else {
        fs::ensure_child(&managed, fs::CONTROL)?
    };
    let lock = control
        .open_with(
            "workspace.lock",
            fs::options().read(true).write(true).create(!exclusive),
        )?
        .into_std();
    if !lock.metadata()?.is_file() {
        return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
    }
    if exclusive {
        lock.try_lock()
    } else {
        lock.try_lock_shared()
    }
    .map_err(|_| MigrationError::new(MigrationErrorKind::Busy))?;
    let lease = WorkspaceLease {
        lock,
        root: root.try_clone()?,
        managed: managed.try_clone()?,
        path,
    };
    if fs::exists(&control, backup::RECOVERABLE)?
        && let Some(value) = backup::verify(&control)?.metadata
    {
        metadata::require_reader(&value, migrations)?;
    }
    if current(&managed, &control, migrations)? {
        return Ok(lease);
    }
    if exclusive {
        return Err(MigrationError::new(MigrationErrorKind::Busy));
    }
    // Windows cannot acquire an exclusive lock over our own shared lock.
    // Recheck state after acquiring it; another opener may have migrated in the gap.
    #[cfg(windows)]
    lease.lock.unlock()?;
    lease
        .lock
        .try_lock()
        .map_err(|_| MigrationError::new(MigrationErrorKind::Busy))?;
    if !current(&managed, &control, migrations)? {
        let workspace = MigrationWorkspace {
            managed: &managed,
            root: &lease.path,
            plugin_history,
        };
        run(&workspace, &control, migrations)?;
    }
    #[cfg(windows)]
    lease.lock.unlock()?;
    lease
        .lock
        .try_lock_shared()
        .map_err(|_| MigrationError::new(MigrationErrorKind::Busy))?;
    if !current(&managed, &control, migrations)? {
        return Err(MigrationError::new(MigrationErrorKind::Busy));
    }
    Ok(lease)
}
fn run(
    workspace: &MigrationWorkspace<'_>,
    control: &Dir,
    migrations: &[MigrationDescriptor],
) -> Result<()> {
    let managed = workspace.managed;
    let recoverable = fs::exists(control, backup::RECOVERABLE)?;
    if recoverable && fs::exists(control, backup::RETIRED)? {
        return Err(MigrationError::new(MigrationErrorKind::RestorationFailed));
    }
    if recoverable {
        if let Some(value) = backup::verify(control)?.metadata {
            metadata::require_reader(&value, migrations)?;
        }
        backup::restore(managed, control)
            .map_err(|error| error.with_kind(MigrationErrorKind::RestorationFailed))?;
    }
    let mut value = metadata::load(managed)?.unwrap_or_else(metadata::initial);
    let position = metadata::require_reader(&value, migrations)?;
    if !recoverable {
        backup::cleanup(control)
            .map_err(|error| error.with_kind(MigrationErrorKind::CleanupFailed))?;
    }
    let pending: Vec<_> = migrations
        .iter()
        .filter(|m| m.version.0 > position)
        .collect();
    if pending.is_empty() {
        if recoverable {
            backup::retire(control)
                .map_err(|error| error.with_kind(MigrationErrorKind::CleanupFailed))?;
        }
        return Ok(());
    }
    if !recoverable {
        backup::create(managed, control)?;
    }
    let converted = (|| {
        for migration in pending {
            fs::checkpoint("step-before")?;
            (migration.apply)(workspace)?;
            fs::checkpoint("step-applied")?;
            (migration.validate)(workspace)?;
            fs::checkpoint("step-validated")?;
        }
        metadata::advance(&mut value, migrations.last().unwrap().version.0, migrations);
        metadata::save(managed, &value)?;
        fs::sync(managed)?;
        fs::checkpoint("metadata-durable")
    })();
    if let Err(error) = converted {
        backup::restore(managed, control)
            .map_err(|error| error.with_kind(MigrationErrorKind::RestorationFailed))?;
        return Err(error.with_kind(MigrationErrorKind::MigrationFailed));
    }
    backup::retire(control).map_err(|error| error.with_kind(MigrationErrorKind::CleanupFailed))
}

/// Initialize only a caller-owned, unpublished workspace staging directory.
/// This does not run conversions over an existing workspace or overwrite metadata.
pub fn initialize_fresh(managed: &Dir) -> Result<()> {
    registry::validate(registry::MIGRATIONS)?;
    if metadata::load(managed)?.is_some() || fs::exists(managed, fs::CONTROL)? {
        return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
    }
    let mut value = metadata::initial();
    let position = registry::MIGRATIONS.last().map_or(0, |m| m.version.0);
    metadata::advance(&mut value, position, registry::MIGRATIONS);
    metadata::save(managed, &value)
}
