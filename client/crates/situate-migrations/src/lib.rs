mod backup;
mod filesystem;
mod metadata;
mod migration;
mod migrations;
mod registry;
mod runner;

pub use migration::{Migration, MigrationDescriptor, MigrationId, MigrationWorkspace};
pub use registry::MIGRATIONS;
pub use runner::{WorkspaceLease, initialize_fresh, prepare};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MigrationErrorKind {
    UpdateRequired,
    Busy,
    MigrationFailed,
    RestorationFailed,
    CleanupFailed,
    InvalidMetadata,
    InvalidRegistry,
    Io,
    UnsafePath,
    InvalidAppVersion,
}

#[derive(Debug)]
pub struct MigrationError {
    kind: MigrationErrorKind,
    required: Option<String>,
    source: Option<std::io::Error>,
}

impl MigrationError {
    pub fn kind(&self) -> MigrationErrorKind {
        self.kind
    }
    pub fn required_app_version(&self) -> Option<&str> {
        self.required.as_deref()
    }
    pub(crate) fn new(kind: MigrationErrorKind) -> Self {
        Self {
            kind,
            required: None,
            source: None,
        }
    }
    pub(crate) fn with_kind(mut self, kind: MigrationErrorKind) -> Self {
        self.kind = kind;
        if kind != MigrationErrorKind::UpdateRequired {
            self.required = None;
        }
        self
    }
    pub(crate) fn update(version: &str) -> Self {
        Self {
            kind: MigrationErrorKind::UpdateRequired,
            required: Some(version.into()),
            source: None,
        }
    }
}
impl std::fmt::Display for MigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "workspace migration: {:?}", self.kind)
    }
}
impl std::error::Error for MigrationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|error| error as _)
    }
}
impl From<std::io::Error> for MigrationError {
    fn from(source: std::io::Error) -> Self {
        Self {
            kind: MigrationErrorKind::Io,
            required: None,
            source: Some(source),
        }
    }
}
pub(crate) type Result<T> = std::result::Result<T, MigrationError>;

#[cfg(test)]
#[path = "../tests/support/runner_cases.rs"]
mod runner_cases;
