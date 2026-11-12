use super::{ContentError, Result};

pub(super) use crate::ignored_files::is_internal as technical;

pub const WORKING_METHOD_PATH: &str = ".situate/working-method.md";

pub(super) fn validate_history_path(path: &str) -> Result<Vec<&str>> {
    if path == WORKING_METHOD_PATH {
        return Ok(path.split('/').collect());
    }
    validate_portable_path(path)
}

pub(super) fn validate_tree_path(path: &str, directory: bool) -> Result<Vec<&str>> {
    if directory && path == ".situate" {
        return Ok(vec![path]);
    }
    validate_history_path(path)
}

/// Validates a nonempty relative path for reading existing provider content.
/// Preserves names verbatim, including controls other than NUL and trailing dots/spaces.
/// Colons remain excluded: native Windows paths can interpret them as alternate streams.
/// This is lexical validation only; callers must still prevent symlink traversal and
/// resolve provider names uniquely within the granted root. Empty listing roots must
/// be handled explicitly by the caller, not passed here.
pub fn validate_provider_path(path: &str) -> Result<Vec<&str>> {
    let parts: Vec<_> = path.split('/').collect();
    if parts.iter().any(|s| {
        s.trim_end_matches([' ', '.']).is_empty() || technical(s) || s.contains(['\\', ':', '\0'])
    }) {
        return Err(ContentError::InvalidPath);
    }
    Ok(parts)
}

/// The versioned writer additionally excludes controls and trailing dots/spaces
/// to avoid creating names that change meaning when copied between filesystems.
/// Filesystem-specific restrictions can still cause an otherwise valid write to fail.
pub fn validate_portable_path(path: &str) -> Result<Vec<&str>> {
    let parts = validate_provider_path(path)?;
    if parts
        .iter()
        .any(|s| s.chars().any(char::is_control) || s.ends_with([' ', '.']))
    {
        return Err(ContentError::InvalidPath);
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Case {
        path: String,
        provider: bool,
        portable: bool,
    }

    #[test]
    fn shared_content_path_contract() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../../../contracts/content-paths.json")).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            for (result, accepted) in [
                (validate_provider_path(&case.path), case.provider),
                (validate_portable_path(&case.path), case.portable),
            ] {
                assert_eq!(result.is_ok(), accepted, "path {:?}", case.path);
                if let Ok(parts) = result {
                    assert_eq!(parts.join("/"), case.path);
                }
            }
        }
    }
}
