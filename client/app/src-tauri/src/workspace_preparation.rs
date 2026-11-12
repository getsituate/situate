use situate_core::workspaces::Location;
use situate_migrations::{MigrationError, MigrationErrorKind, WorkspaceLease};

pub(crate) struct PreparedWorkspace {
    // Drop the OS lock before releasing the native access grant.
    _lease: WorkspaceLease,
    #[cfg(target_os = "ios")]
    _access: tauri_plugin_workspace_access::SessionAccess,
}

impl PreparedWorkspace {
    pub(crate) fn validate(&self) -> Result<(), String> {
        self._lease.validate().map_err(localized_error)
    }
}

pub(crate) fn prepare(
    app: &tauri::AppHandle,
    location: &Location,
) -> Result<PreparedWorkspace, String> {
    #[cfg(target_os = "ios")]
    {
        let access = tauri_plugin_workspace_access::SessionAccess::begin(
            app,
            serde_json::to_value(location)
                .map_err(|_| "native.workspace.provider.invalidResponse")?,
        )?;
        let lease = access.prepare(prepare_root)?;
        Ok(PreparedWorkspace {
            _lease: lease,
            _access: access,
        })
    }
    #[cfg(not(target_os = "ios"))]
    {
        let root = crate::files::local_root(app, location)?
            .ok_or("native.workspace.migration.unavailable")?;
        prepare_local(&root)
    }
}

#[cfg(not(target_os = "ios"))]
pub(crate) fn prepare_local(root: &std::path::Path) -> Result<PreparedWorkspace, String> {
    Ok(PreparedWorkspace {
        _lease: prepare_root(root)?,
    })
}

fn prepare_root(root: &std::path::Path) -> Result<WorkspaceLease, String> {
    situate_migrations::prepare(root, env!("CARGO_PKG_VERSION")).map_err(localized_error)
}

fn error_key(kind: MigrationErrorKind) -> &'static str {
    match kind {
        MigrationErrorKind::UpdateRequired => "native.workspace.migration.updateRequired",
        MigrationErrorKind::Busy => "native.workspace.migration.busy",
        MigrationErrorKind::MigrationFailed => "native.workspace.migration.failed",
        MigrationErrorKind::RestorationFailed => "native.workspace.migration.restorationFailed",
        MigrationErrorKind::CleanupFailed => "native.workspace.migration.cleanupFailed",
        _ => "native.workspace.migration.preparationFailed",
    }
}

fn localized_error(error: MigrationError) -> String {
    let message = situate_core::messages::error(
        error_key(error.kind()),
        match error.required_app_version() {
            Some(version) => serde_json::json!({"version": version}),
            None => serde_json::json!({}),
        },
    );
    match std::error::Error::source(&error)
        .and_then(|source| source.downcast_ref::<std::io::Error>())
        .and_then(std::io::Error::raw_os_error)
    {
        Some(code) => situate_core::messages::error(
            "native.workspace.migration.fileSystemError",
            serde_json::json!({ "error": message, "code": code }),
        ),
        None => message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filesystem_error_codes_are_retained_without_raw_error_text() {
        let error = localized_error(std::io::Error::from_raw_os_error(13).into());
        let message: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(message["key"], "native.workspace.migration.fileSystemError");
        assert_eq!(message["params"]["code"], 13);
        let nested: serde_json::Value =
            serde_json::from_str(message["params"]["error"].as_str().unwrap()).unwrap();
        assert_eq!(
            nested["key"],
            "native.workspace.migration.preparationFailed"
        );
    }

    #[test]
    fn migration_failures_have_distinct_localized_outcomes() {
        for (kind, expected) in [
            (
                MigrationErrorKind::UpdateRequired,
                "native.workspace.migration.updateRequired",
            ),
            (MigrationErrorKind::Busy, "native.workspace.migration.busy"),
            (
                MigrationErrorKind::MigrationFailed,
                "native.workspace.migration.failed",
            ),
            (
                MigrationErrorKind::RestorationFailed,
                "native.workspace.migration.restorationFailed",
            ),
            (
                MigrationErrorKind::CleanupFailed,
                "native.workspace.migration.cleanupFailed",
            ),
            (
                MigrationErrorKind::InvalidMetadata,
                "native.workspace.migration.preparationFailed",
            ),
            (
                MigrationErrorKind::InvalidRegistry,
                "native.workspace.migration.preparationFailed",
            ),
            (
                MigrationErrorKind::Io,
                "native.workspace.migration.preparationFailed",
            ),
            (
                MigrationErrorKind::UnsafePath,
                "native.workspace.migration.preparationFailed",
            ),
            (
                MigrationErrorKind::InvalidAppVersion,
                "native.workspace.migration.preparationFailed",
            ),
        ] {
            assert_eq!(error_key(kind), expected);
        }
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn existing_metadata_free_workspace_is_bootstrapped_without_replacing_legacy_state() {
        let root = tempfile::tempdir().unwrap();
        let managed = root.path().join(".situate");
        std::fs::create_dir(&managed).unwrap();
        let legacy = b"opaque retained state\0\xff";
        std::fs::write(managed.join("retained-state"), legacy).unwrap();
        let _prepared = prepare_local(root.path()).unwrap();
        assert_eq!(
            std::fs::read(managed.join("retained-state")).unwrap(),
            legacy
        );
        assert!(managed.join("migrations.json").is_file());
        assert!(!managed.join("localization.json").exists());
        assert!(!managed.join("native-onboarding.json").exists());
        assert!(!managed.join("workspace.json").exists());
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn fresh_staged_metadata_is_preserved_at_session_preparation() {
        let root = tempfile::tempdir().unwrap();
        let managed = root.path().join(".situate");
        std::fs::create_dir(&managed).unwrap();
        let directory =
            cap_std::fs::Dir::open_ambient_dir(&managed, cap_std::ambient_authority()).unwrap();
        situate_migrations::initialize_fresh(&directory, env!("CARGO_PKG_VERSION")).unwrap();
        let initialized = std::fs::read(managed.join("migrations.json")).unwrap();
        let _prepared = prepare_local(root.path()).unwrap();
        assert_eq!(
            std::fs::read(managed.join("migrations.json")).unwrap(),
            initialized
        );
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn incompatible_workspace_returns_localized_update_required_without_initializing_stores() {
        let root = tempfile::tempdir().unwrap();
        let managed = root.path().join(".situate");
        std::fs::create_dir(&managed).unwrap();
        let metadata =
            br#"{"minimumAppVersion":"9999.0.0","lastAppliedMigration":1,"unknown":"retained"}"#;
        std::fs::write(managed.join("migrations.json"), metadata).unwrap();
        let error = match prepare_local(root.path()) {
            Ok(_) => panic!("an incompatible workspace must remain closed"),
            Err(error) => error,
        };
        let message: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(message["key"], "native.workspace.migration.updateRequired");
        assert_eq!(message["params"]["version"], "9999.0.0");
        assert_eq!(
            std::fs::read(managed.join("migrations.json")).unwrap(),
            metadata
        );
        assert_eq!(std::fs::read_dir(managed).unwrap().count(), 1);
    }

    #[test]
    fn lease_can_be_retained_by_shared_session_state() {
        fn send_sync<T: Send + Sync>() {}
        send_sync::<PreparedWorkspace>();
    }
}
