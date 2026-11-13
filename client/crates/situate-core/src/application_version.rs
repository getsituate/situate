const APPLICATION_VERSION: &str = resolve(
    option_env!("SITUATE_RELEASE_VERSION"),
    env!("CARGO_PKG_VERSION"),
);

pub const fn application_version() -> &'static str {
    APPLICATION_VERSION
}

const fn resolve(release: Option<&'static str>, source: &'static str) -> &'static str {
    match release {
        Some(version) => {
            assert!(valid_release(version), "Invalid SITUATE_RELEASE_VERSION");
            version
        }
        None => source,
    }
}

const fn valid_release(version: &str) -> bool {
    let bytes = version.as_bytes();
    let mut index = 0;
    let mut components = 0;
    while index < bytes.len() {
        let start = index;
        let mut value = 0_u64;
        while index < bytes.len() && bytes[index] >= b'0' && bytes[index] <= b'9' {
            value = match value.checked_mul(10) {
                Some(value) => value,
                None => return false,
            };
            value = match value.checked_add((bytes[index] - b'0') as u64) {
                Some(value) => value,
                None => return false,
            };
            index += 1;
        }
        if index == start || (index - start > 1 && bytes[start] == b'0') {
            return false;
        }
        components += 1;
        if index == bytes.len() {
            return components == 3;
        }
        if bytes[index] != b'.' || components >= 3 {
            return false;
        }
        index += 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_app_version_overrides_the_library_version() {
        assert_eq!(resolve(Some("2026.11.1"), "0.1.6"), "2026.11.1");
        assert_eq!(resolve(Some("0.1.6"), "0.1.5"), "0.1.6");
        assert_eq!(resolve(None, "0.1.6"), "0.1.6");
        assert_eq!(
            application_version(),
            option_env!("SITUATE_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn invalid_generated_versions_fail_instead_of_using_the_library_version() {
        for version in [
            "",
            " 2026.11.1",
            "2026.11.1 ",
            "2026.11",
            "2026.11.0.1",
            "2026.011.1",
            "2026.11.1-beta",
            "2026.11.1+build",
            "2026.11.x",
            "18446744073709551616.1.1",
        ] {
            assert!(std::panic::catch_unwind(|| resolve(Some(version), "0.1.6")).is_err());
        }
    }

    #[test]
    fn generated_calver_opens_compatible_legacy_and_newer_minimum_workspaces() {
        for minimum in ["0.1.6", "2026.10.1", "2026.11.1"] {
            let root = tempfile::tempdir().unwrap();
            let managed = root.path().join(".situate");
            std::fs::create_dir(&managed).unwrap();
            let bytes = format!(
                r#"{{"minimumAppVersion":"{minimum}","lastAppliedMigration":1,"unknown":"retained"}}"#
            );
            std::fs::write(managed.join("migrations.json"), &bytes).unwrap();
            let lease =
                situate_migrations::prepare(root.path(), resolve(Some("2026.11.1"), "0.1.6"))
                    .unwrap();
            drop(lease);
            let retained: serde_json::Value =
                serde_json::from_slice(&std::fs::read(managed.join("migrations.json")).unwrap())
                    .unwrap();
            assert_eq!(retained["minimumAppVersion"], minimum);
            assert_eq!(retained["unknown"], "retained");
            if minimum != "0.1.6" {
                let error = situate_migrations::prepare(root.path(), resolve(None, "0.1.6"))
                    .err()
                    .unwrap();
                assert_eq!(
                    error.kind(),
                    situate_migrations::MigrationErrorKind::UpdateRequired
                );
                assert_eq!(error.required_app_version(), Some(minimum));
            }
        }
    }
}
