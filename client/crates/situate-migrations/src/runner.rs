use crate::{
    MigrationDescriptor, MigrationError, MigrationErrorKind, MigrationWorkspace,
    PluginHistoryMigration, Result, backup, filesystem as fs, metadata, registry,
};
use cap_std::{ambient_authority, fs::Dir};
use semver::Version;
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
    app: Version,
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
        if !current(&managed, &control, &self.app, registry::MIGRATIONS)? {
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
fn require_app(value: &serde_json::Value, app: &Version) -> Result<()> {
    let (minimum, _) = metadata::parse(value)?;
    if app.cmp_precedence(&minimum).is_lt() {
        return Err(MigrationError::update(&minimum.to_string()));
    }
    Ok(())
}
fn current(
    managed: &Dir,
    control: &Dir,
    app: &Version,
    migrations: &[MigrationDescriptor],
) -> Result<bool> {
    if backup::pending(control)? {
        return Ok(false);
    }
    let Some(value) = metadata::load(managed)? else {
        return Ok(false);
    };
    require_app(&value, app)?;
    let (_, position) = metadata::parse(&value)?;
    Ok(position >= migrations.last().map_or(0, |m| m.version.0) && !backup::pending(control)?)
}

/// Prepare an authorized workspace root before any normal managed-data access.
/// Lock contention fails busy; this call never waits for another workspace owner.
/// Existing metadata-free markers are legacy input, not empty workspaces.
pub fn prepare(root: &Path, app_version: &str) -> Result<WorkspaceLease> {
    admit(root, app_version, registry::MIGRATIONS, false, None)
}

/// Prepare a workspace with a history adapter for pinned plugin revisions.
/// The adapter runs inside the migration's exclusive lease and managed-data backup.
pub fn prepare_with_plugin_history(
    root: &Path,
    app_version: &str,
    migrate: PluginHistoryMigration,
) -> Result<WorkspaceLease> {
    admit(
        root,
        app_version,
        registry::MIGRATIONS,
        false,
        Some(migrate),
    )
}

#[cfg(test)]
pub(crate) fn prepare_with(
    root: &Path,
    app_version: &str,
    migrations: &[MigrationDescriptor],
) -> Result<WorkspaceLease> {
    admit(root, app_version, migrations, false, None)
}

/// Admit a closed, already-current workspace without migrating it.
pub fn lock_current_exclusively(root: &Path, app_version: &str) -> Result<WorkspaceLease> {
    admit(root, app_version, registry::MIGRATIONS, true, None)
}

fn admit(
    root: &Path,
    app_version: &str,
    migrations: &[MigrationDescriptor],
    exclusive: bool,
    plugin_history: Option<PluginHistoryMigration>,
) -> Result<WorkspaceLease> {
    registry::validate(migrations)?;
    let app = Version::parse(app_version)
        .map_err(|_| MigrationError::new(MigrationErrorKind::InvalidAppVersion))?;
    let path = std::path::absolute(root)?;
    let root = Dir::open_ambient_dir(&path, ambient_authority())?;
    let managed = fs::child(&root, ".situate")?;
    if !fs::exists(&managed, fs::CONTROL)?
        && let Some(value) = metadata::load(&managed)?
    {
        require_app(&value, &app)?;
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
        app: app.clone(),
    };
    if fs::exists(&control, backup::RECOVERABLE)?
        && let Some(value) = backup::verify(&control)?.metadata
    {
        require_app(&value, &app)?;
    }
    if current(&managed, &control, &app, migrations)? {
        return Ok(lease);
    }
    if exclusive {
        return Err(MigrationError::new(MigrationErrorKind::Busy));
    }
    // No payload read above this point authorizes writes. Re-read under exclusive
    // ownership after conversion; a competing opener may have completed the work.
    lease
        .lock
        .try_lock()
        .map_err(|_| MigrationError::new(MigrationErrorKind::Busy))?;
    if !current(&managed, &control, &app, migrations)? {
        let workspace = MigrationWorkspace {
            managed: &managed,
            root: &lease.path,
            plugin_history,
        };
        run(&workspace, &control, &app, migrations)?;
    }
    lease
        .lock
        .try_lock_shared()
        .map_err(|_| MigrationError::new(MigrationErrorKind::Busy))?;
    if !current(&managed, &control, &app, migrations)? {
        return Err(MigrationError::new(MigrationErrorKind::Busy));
    }
    Ok(lease)
}
fn run(
    workspace: &MigrationWorkspace<'_>,
    control: &Dir,
    app: &Version,
    migrations: &[MigrationDescriptor],
) -> Result<()> {
    let managed = workspace.managed;
    let recoverable = fs::exists(control, backup::RECOVERABLE)?;
    if recoverable && fs::exists(control, backup::RETIRED)? {
        return Err(MigrationError::new(MigrationErrorKind::RestorationFailed));
    }
    if recoverable {
        if let Some(value) = backup::verify(control)?.metadata {
            require_app(&value, app)?;
        }
        backup::restore(managed, control)
            .map_err(|error| error.with_kind(MigrationErrorKind::RestorationFailed))?;
    } else {
        backup::cleanup(control)
            .map_err(|error| error.with_kind(MigrationErrorKind::CleanupFailed))?;
    }
    let mut value = metadata::load(managed)?.unwrap_or_else(metadata::initial);
    require_app(&value, app)?;
    let (_, position) = metadata::parse(&value)?;
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
    let minimums = pending
        .iter()
        .map(|migration| registry::minimum_version(migration))
        .collect::<Result<Vec<_>>>()?;
    for minimum in minimums.iter().flatten() {
        if app.cmp_precedence(minimum).is_lt() {
            return Err(MigrationError::update(&minimum.to_string()));
        }
    }
    if !recoverable {
        backup::create(managed, control)?;
    }
    let converted = (|| {
        for (migration, minimum) in pending.into_iter().zip(minimums) {
            fs::checkpoint("step-before")?;
            (migration.apply)(workspace)?;
            fs::checkpoint("step-applied")?;
            (migration.validate)(workspace)?;
            fs::checkpoint("step-validated")?;
            if let Some(minimum) = minimum {
                let (existing, _) = metadata::parse(&value)?;
                if minimum.cmp_precedence(&existing).is_gt() {
                    value["minimumAppVersion"] = minimum.to_string().into();
                }
            }
        }
        require_app(&value, app)?;
        value["lastAppliedMigration"] = migrations.last().unwrap().version.0.into();
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
pub fn initialize_fresh(managed: &Dir, app_version: &str) -> Result<()> {
    registry::validate(registry::MIGRATIONS)?;
    Version::parse(app_version)
        .map_err(|_| MigrationError::new(MigrationErrorKind::InvalidAppVersion))?;
    if metadata::load(managed)?.is_some() || fs::exists(managed, fs::CONTROL)? {
        return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
    }
    let mut value = metadata::initial();
    for migration in registry::MIGRATIONS {
        if let Some(minimum) = registry::minimum_version(migration)?
            && minimum.cmp_precedence(&metadata::parse(&value)?.0).is_gt()
        {
            value["minimumAppVersion"] = minimum.to_string().into();
        }
    }
    require_app(&value, &Version::parse(app_version).unwrap())?;
    value["lastAppliedMigration"] = registry::MIGRATIONS
        .last()
        .map_or(0, |m| m.version.0)
        .into();
    metadata::save(managed, &value)
}
