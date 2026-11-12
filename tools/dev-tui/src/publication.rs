use crate::{actions::CommandSpec, text};
use serde::Deserialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Check,
    Stage,
    Publish,
    Inspect,
    Reconcile,
}
impl Action {
    pub fn argument(self) -> &'static str {
        match self {
            Self::Check => "check",
            Self::Stage => "stage",
            Self::Publish => "publish",
            Self::Inspect => "inspect",
            Self::Reconcile => "reconcile",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Check => text::PUBLICATION_CHECK,
            Self::Stage => text::PUBLICATION_STAGE,
            Self::Publish => text::PUBLICATION_PUBLISH,
            Self::Inspect => text::PUBLICATION_INSPECT,
            Self::Reconcile => text::PUBLICATION_RECONCILE,
        }
    }
    pub fn writes_remote(self) -> bool {
        matches!(self, Self::Publish | Self::Reconcile)
    }
}

#[derive(Deserialize)]
struct Manifest {
    version: String,
    revision: Option<String>,
    status: String,
    distribution: Option<String>,
    artifacts: Vec<Artifact>,
}
#[derive(Deserialize)]
struct Artifact {
    platform: String,
}
#[derive(Clone, Debug)]
pub struct Candidate {
    pub directory: PathBuf,
    pub version: String,
    pub revision: String,
    pub status: String,
    pub distribution: String,
    pub platforms: String,
    pub journal: bool,
    pub journal_summary: String,
}

fn metadata(path: &Path) -> io::Result<Vec<u8>> {
    let info = fs::symlink_metadata(path)?;
    if !info.is_file() || info.len() > 1024 * 1024 {
        return Err(io::Error::other(text::PUBLICATION_METADATA_ERROR));
    }
    fs::read(path)
}

pub fn discover(root: &Path) -> io::Result<Vec<Candidate>> {
    let directory = root.join("client/artifacts");
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut candidates = vec![];
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with("apple-")
            || !entry.file_type()?.is_dir()
        {
            continue;
        }
        let path = entry.path();
        let Ok(bytes) = metadata(&path.join("manifest.json")) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_slice::<Manifest>(&bytes) else {
            continue;
        };
        let journal_path = path.join("publication-journal.json");
        let journal = fs::symlink_metadata(&journal_path).is_ok();
        let journal_summary = if journal {
            metadata(&journal_path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .map(|value| {
                    ["host", "state", "stage"]
                        .iter()
                        .filter_map(|key| value[*key].as_str())
                        .map(|value| crate::process::clean(value.as_bytes()))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_else(|| text::PUBLICATION_METADATA_ERROR.into())
        } else {
            String::new()
        };
        candidates.push(Candidate {
            journal,
            journal_summary,
            directory: path,
            version: manifest.version,
            revision: manifest.revision.unwrap_or_default(),
            status: manifest.status,
            distribution: manifest.distribution.unwrap_or_default(),
            platforms: manifest
                .artifacts
                .iter()
                .map(|a| a.platform.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        });
    }
    candidates.sort_by(|a, b| a.directory.cmp(&b.directory));
    Ok(candidates)
}

impl Candidate {
    pub fn description(&self) -> String {
        format!(
            "{}\n{}\n{}: {}\n{}: {} / {} / {}\n{}: {} {}",
            crate::process::clean(self.directory.to_string_lossy().as_bytes()),
            crate::process::clean(self.version.as_bytes()),
            text::PUBLICATION_REVISION,
            crate::process::clean(self.revision.as_bytes()),
            text::PUBLICATION_BUILD,
            crate::process::clean(self.status.as_bytes()),
            crate::process::clean(self.distribution.as_bytes()),
            crate::process::clean(self.platforms.as_bytes()),
            text::PUBLICATION_JOURNAL,
            self.journal,
            self.journal_summary
        )
    }
    pub fn command(
        &self,
        root: &Path,
        action: Action,
        confirmation: &str,
    ) -> Result<CommandSpec, String> {
        if action == Action::Publish
            && (self.journal
                || fs::symlink_metadata(self.directory.join("publication-journal.json")).is_ok())
        {
            return Err(text::PUBLICATION_EXISTING_JOURNAL.into());
        }
        let mut spec = crate::actions::Task::Publication(action).command(root);
        spec.args.extend([
            "--release".into(),
            self.directory.to_string_lossy().into_owned(),
        ]);
        if action != Action::Inspect {
            spec.args
                .extend(["--reviewed-revision".into(), self.revision.clone()]);
        }
        if matches!(action, Action::Stage | Action::Publish | Action::Reconcile) {
            let stage = if action == Action::Reconcile {
                let bytes = metadata(&self.directory.join("publication-journal.json"))
                    .map_err(|_| text::PUBLICATION_METADATA_ERROR.to_string())?;
                let journal: serde_json::Value = serde_json::from_slice(&bytes)
                    .map_err(|_| text::PUBLICATION_METADATA_ERROR.to_string())?;
                journal["stage"]
                    .as_str()
                    .ok_or(text::PUBLICATION_METADATA_ERROR)?
                    .to_string()
            } else {
                self.directory
                    .with_file_name(format!(
                        "publication-{}",
                        self.directory
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    ))
                    .to_string_lossy()
                    .into_owned()
            };
            spec.args.extend(["--stage".into(), stage]);
        }
        if action.writes_remote() {
            if !valid_confirmation(confirmation, &self.version) {
                return Err(text::PUBLICATION_TARGET_INVALID.into());
            }
            spec.args.extend(["--confirm".into(), confirmation.into()]);
        }
        Ok(spec)
    }
}

pub fn destination(root: &Path, version: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Destination {
        host: String,
    }
    if crate::version::number(version).is_none() {
        return Err(text::PUBLICATION_METADATA_ERROR.into());
    }
    let output = Command::new("node")
        .args(["infrastructure/releases/publish.mjs", "destination"])
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .map_err(|_| text::PUBLICATION_DESTINATION_FAILED.to_string())?;
    if !output.status.success() || output.stdout.len() > 4096 {
        return Err(text::PUBLICATION_DESTINATION_FAILED.into());
    }
    let destination: Destination = serde_json::from_slice(&output.stdout)
        .map_err(|_| text::PUBLICATION_DESTINATION_FAILED.to_string())?;
    let confirmation = format!("{}:{version}", destination.host);
    if !valid_confirmation(&confirmation, version) {
        return Err(text::PUBLICATION_DESTINATION_FAILED.into());
    }
    Ok(confirmation)
}

pub fn valid_confirmation(value: &str, version: &str) -> bool {
    let Some((host, selected_version)) = value.split_once(':') else {
        return false;
    };
    !host.is_empty()
        && selected_version == version
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@._-".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(root: &Path) -> Candidate {
        let directory = root.join("client/artifacts/apple-test");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("manifest.json"), r#"{"version":"1.2.3","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"complete","distribution":"direct","artifacts":[{"platform":"macos"}]}"#).unwrap();
        discover(root).unwrap().remove(0)
    }
    #[test]
    fn discovers_explicit_candidates_and_builds_argument_vectors() {
        let dir = tempfile::tempdir().unwrap();
        let candidate = fixture(dir.path());
        assert_eq!(candidate.platforms, "macos");
        for action in [
            Action::Check,
            Action::Stage,
            Action::Publish,
            Action::Inspect,
        ] {
            let command = candidate
                .command(dir.path(), action, "operator@host:1.2.3")
                .unwrap();
            assert_eq!(command.args[4], action.argument());
            assert_eq!(
                command.args.contains(&"--confirm".into()),
                action.writes_remote()
            );
            assert_eq!(
                command.args.contains(&"--reviewed-revision".into()),
                action != Action::Inspect
            );
        }
        assert!(
            candidate
                .command(dir.path(), Action::Publish, "host:2.0.0")
                .is_err()
        );
        assert!(!valid_confirmation("host;touch:1.2.3", "1.2.3"));
    }
    #[test]
    fn journal_blocks_republication_and_preserves_reconciliation_stage() {
        let dir = tempfile::tempdir().unwrap();
        let mut candidate = fixture(dir.path());
        candidate.journal = true;
        assert!(
            candidate
                .command(dir.path(), Action::Publish, "host:1.2.3")
                .is_err()
        );
        let stage = dir.path().join("original stage");
        fs::write(
            candidate.directory.join("publication-journal.json"),
            serde_json::json!({"stage":stage}).to_string(),
        )
        .unwrap();
        let command = candidate
            .command(dir.path(), Action::Reconcile, "host:1.2.3")
            .unwrap();
        assert_eq!(
            command.args[command.args.iter().position(|a| a == "--stage").unwrap() + 1],
            stage.to_string_lossy()
        );
    }
    #[test]
    fn malformed_metadata_and_symlinked_builds_are_not_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let candidate = fixture(dir.path());
        std::os::unix::fs::symlink(
            &candidate.directory,
            candidate.directory.with_file_name("apple-link"),
        )
        .unwrap();
        assert_eq!(discover(dir.path()).unwrap().len(), 1);
        fs::write(candidate.directory.join("manifest.json"), "not json").unwrap();
        assert!(discover(dir.path()).unwrap().is_empty());
    }
}
