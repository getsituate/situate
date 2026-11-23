use crate::{MigrationDescriptor, MigrationError, MigrationErrorKind, Result, migrations};
use semver::Version;
use std::collections::BTreeMap;

#[rustfmt::skip]
pub const MIGRATIONS: &[MigrationDescriptor] = &[
    MigrationDescriptor::of::<migrations::m0001_workspace_metadata::Migration>(),
    MigrationDescriptor::of::<migrations::m0002_conversation_history::Migration>(),
    MigrationDescriptor::of::<migrations::m0003_plugin_manifests::Migration>(),
];

pub(crate) fn validate(registry: &[MigrationDescriptor]) -> Result<()> {
    for (index, migration) in registry.iter().enumerate() {
        if migration.version.0 != index as u64 + 1
            || (migration.release_assigned_minimum && migration.minimum_app_version.is_some())
            || migration
                .minimum_app_version
                .is_some_and(|v| semver::Version::parse(v).is_err())
        {
            return Err(MigrationError::new(MigrationErrorKind::InvalidRegistry));
        }
    }
    Ok(())
}

pub(crate) fn minimum_version(migration: &MigrationDescriptor) -> Result<Option<Version>> {
    let assignments = option_env!("SITUATE_MIGRATION_MINIMUM_VERSIONS");
    if migration.release_assigned_minimum
        && assignments.is_none()
        && option_env!("SITUATE_RELEASE_VERSION").is_none()
    {
        return Ok(Some(Version::parse(env!("CARGO_PKG_VERSION")).map_err(
            |_| MigrationError::new(MigrationErrorKind::InvalidRegistry),
        )?));
    }
    resolve_minimum(migration, assignments)
}

fn resolve_minimum(
    migration: &MigrationDescriptor,
    assignments: Option<&str>,
) -> Result<Option<Version>> {
    let invalid = || MigrationError::new(MigrationErrorKind::InvalidRegistry);
    let version = if migration.release_assigned_minimum {
        let versions: BTreeMap<u64, String> =
            serde_json::from_str(assignments.ok_or_else(invalid)?).map_err(|_| invalid())?;
        Some(
            versions
                .get(&migration.version.0)
                .ok_or_else(invalid)?
                .clone(),
        )
    } else {
        migration.minimum_app_version.map(str::to_owned)
    };
    version
        .as_deref()
        .map(Version::parse)
        .transpose()
        .map_err(|_| invalid())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_inputs_list_all_release_assigned_migrations() {
        let declared: Vec<u64> =
            serde_json::from_str(include_str!("../release-minimum-versions.json")).unwrap();
        let registered = MIGRATIONS
            .iter()
            .filter(|m| m.release_assigned_minimum)
            .map(|m| m.version.0)
            .collect::<Vec<_>>();
        assert_eq!(declared, registered);
    }

    #[test]
    fn release_assigned_minimum_requires_the_sealed_assignment_for_its_id() {
        let mut migration = MIGRATIONS[1];
        migration.release_assigned_minimum = true;
        migration.minimum_app_version = None;
        for missing in [None, Some("{}"), Some(r#"{"2":"invalid"}"#)] {
            assert_eq!(
                resolve_minimum(&migration, missing).unwrap_err().kind(),
                MigrationErrorKind::InvalidRegistry
            );
        }
        assert_eq!(
            resolve_minimum(&migration, Some(r#"{"2":"2026.12.3","3":"2026.12.8"}"#)).unwrap(),
            Some(Version::new(2026, 12, 3))
        );
        assert_eq!(
            resolve_minimum(&MIGRATIONS[1], None).unwrap(),
            Some(Version::new(0, 1, 6))
        );
    }
}
