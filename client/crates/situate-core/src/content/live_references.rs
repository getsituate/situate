use super::*;
use crate::conversation_runtime::ContentReference;

const MAX_REFERENCE_BYTES: u64 = 8 * 1024 * 1024;
const INVALID: &str = "native.content.reference.invalid";
const UNCERTAIN: &str = "native.content.reference.moveUncertain";

#[cfg(test)]
thread_local! {
    pub(super) static INTERRUPT: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
    static CAPTURE_REPLACE: std::cell::RefCell<Option<Vec<u8>>> = const { std::cell::RefCell::new(None) };
    static CAPTURE_ANCESTOR: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}
#[cfg(test)]
pub(super) fn interrupt_move(phase: u8) -> Result<()> {
    if INTERRUPT.get() == phase {
        INTERRUPT.set(0);
        Err(failure(UNCERTAIN))
    } else {
        Ok(())
    }
}
#[cfg(test)]
#[path = "lineage_tests.rs"]
mod lineage_tests;
#[cfg(test)]
#[path = "lineage_validation_tests.rs"]
mod lineage_validation_tests;
#[cfg(test)]
#[path = "live_reference_tests.rs"]
mod tests;

fn failure(key: &str) -> ContentError {
    ContentError::Io(io::Error::other(key.to_owned()))
}

impl ContentStore {
    /// Captures a new selection, recording observed content before assigning a Git
    /// anchor. The expected revision is a blob hash, not the returned commit hash.
    /// Captures bytes up to the 64 MiB structural limit without text decoding;
    /// resolving content as text has a separate 8 MiB limit.
    /// Existing stored references must be resolved rather than captured again.
    pub fn capture_reference(
        &mut self,
        workspace_id: &str,
        path: &str,
        expected_revision: Option<&str>,
    ) -> Result<ContentReference> {
        let (dir, name) = self.parent(path)?;
        let (bytes, identity) = read_file_bounded(&dir, &name, operations::MAX_OPERATION_BYTES)?;
        let blob = Oid::hash_object(git2::ObjectType::Blob, &bytes)?;
        if expected_revision.is_some_and(|expected| expected != blob.to_string()) {
            return Err(failure("native.content.reference.changed"));
        }
        let anchor_revision = self.record_external_changes()?;
        let commit = self.repo.find_commit(Oid::from_str(&anchor_revision)?)?;
        let record = history_records::Envelope::read(&commit)?;
        if matches!(record.fact, history_records::Fact::Boundary { .. }) {
            return Err(failure(UNCERTAIN));
        }
        if commit.tree()?.get_path(Path::new(path))?.id() != blob {
            return Err(failure("native.content.reference.changed"));
        }
        #[cfg(test)]
        if let Some(replacement) = CAPTURE_REPLACE.take() {
            let stage = temporary_file(&dir, &replacement)?;
            dir.rename(stage, &dir, &name)?;
        }
        #[cfg(test)]
        if let Some(ancestor) = CAPTURE_ANCESTOR.take() {
            self.root.rename(&ancestor, &self.root, "detached")?;
            self.root.create_dir(&ancestor)?;
            self.root.write(path, &bytes)?;
        }
        let (current_dir, current_name) = self.parent(path)?;
        let (current, current_identity) =
            read_file_bounded(&current_dir, &current_name, operations::MAX_OPERATION_BYTES)?;
        if current != bytes || current_identity != identity {
            return Err(failure("native.content.reference.changed"));
        }
        let reference = ContentReference::Live {
            workspace_id: workspace_id.into(),
            path: path.into(),
            anchor_revision,
        };
        if !reference.validate() {
            return Err(failure(INVALID));
        }
        Ok(reference)
    }

    pub fn resolve_reference(
        &self,
        reference: &ContentReference,
    ) -> Result<Option<(ContentReference, String, TextVersion)>> {
        if !reference.validate() {
            return Err(failure(INVALID));
        }
        match reference {
            ContentReference::Historical { path, revision, .. } => {
                let commit = self.validated_revision(revision)?;
                let entry = commit
                    .tree()
                    .and_then(|tree| tree.get_path(Path::new(path)));
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None),
                    Err(error) => return Err(error.into()),
                };
                if !matches!(entry.filemode(), 0o100644 | 0o100755) {
                    return Err(failure(INVALID));
                }
                if self.repo.odb()?.read_header(entry.id())?.0 as u64 > MAX_REFERENCE_BYTES {
                    return Err(failure("native.files.read.tooLarge"));
                }
                let blob = self.repo.find_blob(entry.id())?;
                if blob.content().contains(&0) {
                    return Err(failure("native.content.file.invalidUtf8"));
                }
                let mut version = text_version(blob.content().to_vec())?;
                version.revision = revision.clone();
                Ok(Some((reference.clone(), path.clone(), version)))
            }
            ContentReference::Live { .. } => {
                let Some(path) = self.resolve_reference_path(reference)? else {
                    return Ok(None);
                };
                match self.read_reference_text(&path) {
                    Ok(version) => Ok(Some((reference.clone(), path, version))),
                    Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                        Ok(None)
                    }
                    Err(error) => Err(error),
                }
            }
        }
    }

    fn read_reference_text(&self, path: &str) -> Result<TextVersion> {
        let (dir, name) = self.parent(path)?;
        let (bytes, _) = read_file_bounded(&dir, &name, MAX_REFERENCE_BYTES)?;
        if bytes.contains(&0) {
            return Err(failure("native.content.file.invalidUtf8"));
        }
        text_version(bytes)
    }
}
