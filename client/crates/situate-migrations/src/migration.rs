use crate::{MigrationError, MigrationErrorKind, Result, filesystem};
use cap_std::fs::Dir;
use std::path::{Component, Path};

#[derive(
    Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct MigrationId(pub u64);

/// One numbered conversion; recovery and progress publication belong to the runner.
///
/// A conversion without a number cannot be registered:
/// ```compile_fail
/// use situate_migrations::{Migration, MigrationWorkspace, MigrationError};
/// struct Unnumbered;
/// impl Migration for Unnumbered {
///     const MINIMUM_APP_VERSION: Option<&'static str> = None;
///     fn apply(_: &MigrationWorkspace<'_>) -> Result<(), MigrationError> { Ok(()) }
///     fn validate(_: &MigrationWorkspace<'_>) -> Result<(), MigrationError> { Ok(()) }
/// }
/// ```
pub trait Migration {
    const VERSION: MigrationId;
    const MINIMUM_APP_VERSION: Option<&'static str>;
    fn apply(workspace: &MigrationWorkspace<'_>) -> Result<()>;
    fn validate(workspace: &MigrationWorkspace<'_>) -> Result<()>;
}

#[derive(Clone, Copy)]
pub struct MigrationDescriptor {
    pub version: MigrationId,
    pub minimum_app_version: Option<&'static str>,
    pub(crate) apply: fn(&MigrationWorkspace<'_>) -> Result<()>,
    pub(crate) validate: fn(&MigrationWorkspace<'_>) -> Result<()>,
}
impl MigrationDescriptor {
    pub const fn of<M: Migration>() -> Self {
        Self {
            version: M::VERSION,
            minimum_app_version: M::MINIMUM_APP_VERSION,
            apply: M::apply,
            validate: M::validate,
        }
    }
}

/// A held capability for managed data only. Paths never include the workspace root.
pub struct MigrationWorkspace<'a> {
    pub(crate) managed: &'a Dir,
}
impl MigrationWorkspace<'_> {
    fn parent(&self, path: &Path) -> Result<(Dir, String)> {
        let mut components: Vec<_> = path.components().collect();
        if components.is_empty()
            || components
                .iter()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
        }
        let first = components[0].as_os_str();
        if first.to_str().is_some_and(|name| {
            name.eq_ignore_ascii_case(filesystem::CONTROL)
                || name.eq_ignore_ascii_case(crate::metadata::FILE)
        }) {
            return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
        }
        if filesystem::exists(
            self.managed,
            first
                .to_str()
                .ok_or_else(|| MigrationError::new(MigrationErrorKind::UnsafePath))?,
        )? {
            let candidate = self
                .managed
                .open_with(Path::new(first), filesystem::options().read(true))?
                .into_std();
            let candidate = same_file::Handle::from_file(candidate)?;
            for reserved in [filesystem::CONTROL, crate::metadata::FILE] {
                if filesystem::exists(self.managed, reserved)? {
                    let protected = self
                        .managed
                        .open_with(reserved, filesystem::options().read(true))?
                        .into_std();
                    if candidate == same_file::Handle::from_file(protected)? {
                        return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
                    }
                }
            }
        }
        let name = components
            .pop()
            .unwrap()
            .as_os_str()
            .to_str()
            .ok_or_else(|| MigrationError::new(MigrationErrorKind::UnsafePath))?
            .to_owned();
        let mut dir = self.managed.try_clone()?;
        for component in components {
            dir = filesystem::child(&dir, component.as_os_str())?;
        }
        Ok((dir, name))
    }
    pub fn read(&self, path: impl AsRef<Path>) -> Result<Vec<u8>> {
        let (dir, name) = self.parent(path.as_ref())?;
        filesystem::read(&dir, &name)
    }
    pub fn write(&self, path: impl AsRef<Path>, bytes: &[u8]) -> Result<()> {
        let (dir, name) = self.parent(path.as_ref())?;
        filesystem::replace(&dir, &name, bytes)
    }
    pub fn remove_file(&self, path: impl AsRef<Path>) -> Result<()> {
        let (dir, name) = self.parent(path.as_ref())?;
        filesystem::regular(&dir, &name)?;
        dir.remove_file(&name)?;
        filesystem::sync(&dir)
    }
    pub fn create_dir(&self, path: impl AsRef<Path>) -> Result<()> {
        let (dir, name) = self.parent(path.as_ref())?;
        dir.create_dir(&name)?;
        filesystem::sync(&dir)
    }
    pub(crate) fn initialize_metadata(&self) -> Result<()> {
        if let Some(value) = crate::metadata::load(self.managed)? {
            if crate::metadata::parse(&value)?.1 == 0 {
                return Ok(());
            }
            return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
        }
        crate::metadata::save(self.managed, &crate::metadata::initial())
    }
}
