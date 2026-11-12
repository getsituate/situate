use crate::{MigrationError, MigrationErrorKind, MigrationId, MigrationWorkspace};

pub struct Migration;
impl crate::Migration for Migration {
    const VERSION: MigrationId = MigrationId(1);
    const MINIMUM_APP_VERSION: Option<&'static str> = None;
    fn apply(workspace: &MigrationWorkspace<'_>) -> Result<(), MigrationError> {
        workspace.initialize_metadata()
    }
    fn validate(workspace: &MigrationWorkspace<'_>) -> Result<(), MigrationError> {
        crate::metadata::load(workspace.managed)?
            .ok_or_else(|| MigrationError::new(MigrationErrorKind::InvalidMetadata))?;
        Ok(())
    }
}
