use super::history_records::{Envelope, Fact, Operation};
use super::operations::PatchIdentity;
use super::*;

#[cfg(test)]
thread_local! {
    pub(super) static INTERRUPT: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
    pub(super) static BEFORE_PUBLICATION: std::cell::RefCell<Option<Vec<u8>>> = const { std::cell::RefCell::new(None) };
    pub(super) static AFTER_PUBLICATION: std::cell::RefCell<Option<Vec<u8>>> = const { std::cell::RefCell::new(None) };
    pub(super) static REPLACE_ANCESTOR: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
    pub(super) static UNRELATED_WRITE: std::cell::RefCell<Option<(String, Vec<u8>)>> = const { std::cell::RefCell::new(None) };
}
#[cfg(test)]
fn interrupt(phase: u8) -> Result<()> {
    if INTERRUPT.get() == phase {
        INTERRUPT.set(0);
        return Err(ContentError::History(
            "native.content.history.unavailable".into(),
        ));
    }
    Ok(())
}

pub(super) fn pin_stage(dir: &Dir, stage: &str) -> Result<PatchIdentity> {
    Ok(PatchIdentity::new(read_file(dir, stage)?.1, true)?)
}

impl ContentStore {
    pub(super) fn recheck_text_source(
        &self,
        path: &str,
        expected: &TextVersion,
        identity: &same_file::Handle,
    ) -> Result<Option<SaveOutcome>> {
        let current = self
            .parent(path)
            .and_then(|(dir, name)| read_file(&dir, &name));
        match current {
            Ok((bytes, current)) if bytes == expected.text.as_bytes() && &current == identity => {
                Ok(None)
            }
            Ok(_) => Ok(Some(SaveOutcome::ChangedSinceReview)),
            Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                Ok(Some(SaveOutcome::ExternalDeleted))
            }
            Err(error) => Err(error),
        }
    }

    pub(super) fn begin_text_write(
        &self,
        path: &str,
        expected: Option<&TextVersion>,
        text: &str,
    ) -> Result<Oid> {
        let parent = self.repo.head()?.peel_to_commit()?;
        let before = parent.tree()?;
        match (before.get_path(Path::new(path)), expected) {
            (Ok(entry), Some(expected))
                if matches!(entry.filemode(), 0o100644 | 0o100755)
                    && entry.id().to_string() == expected.revision => {}
            (Err(error), None) if error.code() == git2::ErrorCode::NotFound => {}
            _ => return Err(ContentError::InvalidBase),
        }
        let blob = git_storage::write_object(&self.repo, git2::ObjectType::Blob, text.as_bytes())?;
        let tree = replace_tree_entry(&self.repo, &before, &validate_path(path)?, blob)?;
        let operation = Operation::Write { path: path.into() };
        super::tree_facts::validate_operation_tree(
            &self.repo,
            before.id(),
            tree,
            &operation,
            &[],
            &mut 100_000,
        )?;
        let boundary = git_storage::commit_fact(
            &self.repo,
            &self.history_dir,
            &before,
            &[&parent],
            "native.history.operationBoundary",
            Fact::Boundary {
                operation,
                expected_tree: tree.to_string(),
                patches: Vec::new(),
            },
        )?;
        #[cfg(test)]
        {
            interrupt(1)?;
            if let Some(bytes) = BEFORE_PUBLICATION.take() {
                let (dir, name) = self.parent(path)?;
                let stage = temporary_file(&dir, &bytes)?;
                dir.rename(stage, &dir, name)?;
            }
        }
        Ok(boundary)
    }

    pub(super) fn finish_text_write(
        &mut self,
        path: &str,
        version: TextVersion,
        message: &str,
        boundary: Oid,
        identity: &PatchIdentity,
        published_dir: &Dir,
    ) -> Result<SaveOutcome> {
        let mut finish = || -> Result<String> {
            #[cfg(test)]
            interrupt(2)?;
            sync_dir(published_dir)?;
            #[cfg(test)]
            {
                interrupt(3)?;
                if let Some((path, bytes)) = UNRELATED_WRITE.take() {
                    self.root.write(path, bytes)?;
                }
                if let Some(ancestor) = REPLACE_ANCESTOR.take() {
                    self.root.rename(&ancestor, &self.root, "detached")?;
                    self.root.create_dir(&ancestor)?;
                    self.root.write(path, version.text.as_bytes())?;
                }
                if let Some(bytes) = AFTER_PUBLICATION.take() {
                    let (dir, name) = self.parent(path)?;
                    let stage = temporary_file(&dir, &bytes)?;
                    dir.rename(stage, &dir, name)?;
                }
            }
            let parent = self.repo.head()?.peel_to_commit()?;
            if parent.id() != boundary {
                return Err(ContentError::InvalidBase);
            }
            let Fact::Boundary {
                operation: Operation::Write { path: selected },
                expected_tree,
                ..
            } = Envelope::read(&parent)?.fact
            else {
                return Err(ContentError::InvalidBase);
            };
            if selected != path {
                return Err(ContentError::InvalidBase);
            }
            let tree = self.repo.find_tree(Oid::from_str(&expected_tree)?)?;
            let (dir, name) = self.parent(path)?;
            let actual = snapshot_blob(&self.repo, &dir, &name)?;
            let (bytes, published_identity) = read_file(&dir, &name)?;
            let expected = tree.get_path(Path::new(path))?;
            if bytes != version.text.as_bytes()
                || !identity.matches(&published_identity)?
                || actual != (expected.id(), expected.filemode())
            {
                return Err(ContentError::History(
                    "native.content.operation.changed".into(),
                ));
            }
            let revision = git_storage::commit_fact(
                &self.repo,
                &self.history_dir,
                &tree,
                &[&parent],
                message,
                Fact::Completed {
                    boundary: boundary.to_string(),
                },
            )?;
            drop((parent, tree));
            self.record_external_changes()?;
            #[cfg(test)]
            interrupt(4)?;
            Ok(revision.to_string())
        };
        match finish() {
            Ok(revision) => self.finish_saved_draft(path, version, revision),
            Err(error) => Ok(SaveOutcome::SavedHistoryFailed {
                version,
                error: error.to_string(),
            }),
        }
    }

    pub(super) fn finish_unchanged_save(
        &mut self,
        path: &str,
        version: TextVersion,
        identity: &same_file::Handle,
    ) -> Result<SaveOutcome> {
        let finish = || -> Result<String> {
            let (dir, name) = self.parent(path)?;
            let (bytes, current) = read_file(&dir, &name)?;
            if bytes != version.text.as_bytes() || &current != identity {
                return Err(ContentError::InvalidBase);
            }
            let parent = self.repo.head()?.peel_to_commit()?;
            if matches!(Envelope::read(&parent)?.fact, Fact::Boundary { .. })
                || parent.tree()?.get_path(Path::new(path))?.id().to_string() != version.revision
            {
                return Err(ContentError::InvalidBase);
            }
            #[cfg(test)]
            interrupt(6)?;
            sync_history_file(&dir, std::ffi::OsStr::new(&name))?;
            #[cfg(test)]
            interrupt(7)?;
            sync_dir(&dir)?;
            #[cfg(test)]
            interrupt(8)?;
            git_storage::sync_history(&self.history_dir)?;
            let (dir, name) = self.parent(path)?;
            let (bytes, current) = read_file(&dir, &name)?;
            if bytes != version.text.as_bytes() || &current != identity {
                return Err(ContentError::InvalidBase);
            }
            Ok(parent.id().to_string())
        };
        match finish() {
            Ok(revision) => self.finish_saved_draft(path, version, revision),
            Err(error) => Ok(SaveOutcome::SavedHistoryFailed {
                version,
                error: error.to_string(),
            }),
        }
    }

    fn finish_saved_draft(
        &mut self,
        path: &str,
        version: TextVersion,
        history_revision: String,
    ) -> Result<SaveOutcome> {
        let mut cleanup = || -> Result<()> {
            #[cfg(test)]
            interrupt(5)?;
            self.discard_draft(path)
        };
        Ok(match cleanup() {
            Ok(()) => SaveOutcome::Saved {
                version,
                history_revision,
            },
            Err(error) => SaveOutcome::SavedDraftCleanupFailed {
                version,
                history_revision,
                error: error.to_string(),
            },
        })
    }
}
