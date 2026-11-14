use crate::text;
use serde::Deserialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

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

pub fn drafts(root: &Path) -> String {
    let Ok(entries) = fs::read_dir(root.join(".release-preparation")) else {
        return String::new();
    };
    let mut paths = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort();
    let mut output = String::new();
    for directory in paths {
        let Ok(files) = fs::read_dir(&directory) else {
            continue;
        };
        let mut files = files
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "json")
            })
            .collect::<Vec<_>>();
        files.sort();
        for path in files {
            if output.len() >= 64 * 1024 {
                return output;
            }
            if let Ok(bytes) = metadata(&path) {
                output.push_str(&format!(
                    "\n\n{}\n{}",
                    crate::process::clean(path.to_string_lossy().as_bytes()),
                    crate::process::clean(&bytes)
                        .chars()
                        .take(8192)
                        .collect::<String>()
                ));
            }
        }
    }
    output
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
    fn historical_journals_remain_readable_without_enabling_publication() {
        let dir = tempfile::tempdir().unwrap();
        let candidate = fixture(dir.path());
        fs::write(
            candidate.directory.join("publication-journal.json"),
            r#"{"host":"host","state":"unknown","stage":"retained-stage"}"#,
        )
        .unwrap();
        let candidates = discover(dir.path()).unwrap();
        assert!(candidates[0].journal);
        assert!(
            candidates[0]
                .description()
                .contains("host / unknown / retained-stage")
        );
    }
    #[test]
    fn retained_drafts_are_read_only_and_do_not_follow_linked_files() {
        let dir = tempfile::tempdir().unwrap();
        let draft = dir.path().join(".release-preparation/1.2.3");
        fs::create_dir_all(&draft).unwrap();
        let original = br#"{"phase":"draft","version":"1.2.3"}"#;
        fs::write(draft.join("state.json"), original).unwrap();
        fs::write(dir.path().join("outside.json"), "outside-content").unwrap();
        std::os::unix::fs::symlink(dir.path().join("outside.json"), draft.join("linked.json"))
            .unwrap();
        let description = drafts(dir.path());
        assert!(description.contains("draft"));
        assert!(!description.contains("outside-content"));
        assert_eq!(fs::read(draft.join("state.json")).unwrap(), original);
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
