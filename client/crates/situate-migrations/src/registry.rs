use crate::{MigrationDescriptor, MigrationError, MigrationErrorKind, Result, migrations};

#[rustfmt::skip]
pub const MIGRATIONS: &[MigrationDescriptor] = &[
    MigrationDescriptor::of::<migrations::m0001_workspace_metadata::Migration>(),
    MigrationDescriptor::of::<migrations::m0002_conversation_history::Migration>(),
];

pub(crate) fn validate(registry: &[MigrationDescriptor]) -> Result<()> {
    for (index, migration) in registry.iter().enumerate() {
        if migration.version.0 != index as u64 + 1
            || migration
                .minimum_app_version
                .is_some_and(|v| semver::Version::parse(v).is_err())
        {
            return Err(MigrationError::new(MigrationErrorKind::InvalidRegistry));
        }
    }
    Ok(())
}
