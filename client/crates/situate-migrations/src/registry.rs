use crate::{MigrationDescriptor, MigrationError, MigrationErrorKind, Result, migrations};
use semver::Version;

#[rustfmt::skip]
pub const MIGRATIONS: &[MigrationDescriptor] = &[
    MigrationDescriptor::of::<migrations::m0001_workspace_metadata::Migration>(),
    MigrationDescriptor::of::<migrations::m0002_conversation_history::Migration>(),
    MigrationDescriptor::of::<migrations::m0003_plugin_manifests::Migration>(),
];

#[derive(Clone, Copy)]
pub(crate) struct Reader {
    pub epoch: u64,
    pub legacy_floor: &'static str,
}

pub(crate) fn reader_at(registry: &[MigrationDescriptor], position: u64) -> Reader {
    registry
        .iter()
        .rev()
        .filter(|m| m.version.0 <= position)
        .find_map(|m| {
            legacy_floor(m).map(|legacy_floor| Reader {
                epoch: m.version.0,
                legacy_floor,
            })
        })
        .unwrap_or(Reader {
            epoch: 0,
            legacy_floor: "0.0.0",
        })
}

fn legacy_floor(migration: &MigrationDescriptor) -> Option<&'static str> {
    if migration.release_assigned_minimum && migration.version.0 == 3 {
        // The first published release containing migration 3 sealed this assignment.
        Some("2026.11.27")
    } else {
        migration.minimum_app_version
    }
}

pub(crate) fn validate(registry: &[MigrationDescriptor]) -> Result<()> {
    let invalid = || MigrationError::new(MigrationErrorKind::InvalidRegistry);
    let mut last_floor = Version::new(0, 0, 0);
    for (index, migration) in registry.iter().enumerate() {
        if migration.version.0 != index as u64 + 1
            || (migration.release_assigned_minimum
                && (migration.version.0 != 3 || migration.minimum_app_version.is_some()))
        {
            return Err(invalid());
        }
        if let Some(floor) = legacy_floor(migration) {
            let floor = Version::parse(floor).map_err(|_| invalid())?;
            if !floor.cmp_precedence(&last_floor).is_gt() {
                return Err(invalid());
            }
            last_floor = floor;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn historical_release_assignments_match_the_registry() {
        let declared: Vec<u64> =
            serde_json::from_str(include_str!("../release-minimum-versions.json")).unwrap();
        let registered = MIGRATIONS
            .iter()
            .filter(|m| m.release_assigned_minimum)
            .map(|m| m.version.0)
            .collect::<Vec<_>>();
        assert_eq!(declared, registered);
    }
}
