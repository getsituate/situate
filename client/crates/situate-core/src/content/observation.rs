use super::*;

#[derive(Default)]
pub(super) struct ObservationCache {
    pub durable_head: std::cell::Cell<Option<Oid>>,
    pub blobs: HashMap<String, CachedBlob>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FileStamp {
    size: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64, u32),
}
impl FileStamp {
    pub fn read(metadata: &cap_std::fs::Metadata) -> Result<Self> {
        if !metadata.is_file() {
            return Err(ContentError::InvalidPath);
        }
        Ok(Self {
            size: metadata.len(),
            modified: metadata.modified()?.into_std(),
            #[cfg(unix)]
            identity: {
                use cap_std::fs::MetadataExt;
                (
                    metadata.dev(),
                    metadata.ino(),
                    metadata.ctime(),
                    metadata.ctime_nsec(),
                    metadata.mode(),
                )
            },
        })
    }
    pub fn reusable(&self, other: &Self) -> bool {
        // Reuse requires file identity and change time, not just a restorable modification time.
        cfg!(unix) && self == other
    }
}

#[derive(Clone)]
pub(super) struct CachedBlob {
    pub stamp: FileStamp,
    pub oid: Oid,
    pub mode: i32,
}

impl ContentStore {
    pub(super) fn sync_observed_history(&self) -> Result<()> {
        let head = self.repo.head()?.peel_to_commit()?.id();
        if self.observations.durable_head.get() != Some(head) {
            git_storage::sync_history(&self.history_dir)?;
            self.observations.durable_head.set(Some(head));
        }
        Ok(())
    }

    /// Retains the exact displayed bytes; identity changes require a full workspace observation.
    pub fn observe_text(&mut self, path: &str) -> Result<TextVersion> {
        self.prepare_observation()?;
        let version = self.read_text(path)?;
        self.record_observed_text(path, &version)?;
        Ok(version)
    }

    /// Resolves and retains a live selection; historical selections remain read-only.
    pub fn observe_reference(
        &mut self,
        reference: &crate::conversation_runtime::ContentReference,
    ) -> Result<
        Option<(
            crate::conversation_runtime::ContentReference,
            String,
            TextVersion,
        )>,
    > {
        if matches!(
            reference,
            crate::conversation_runtime::ContentReference::Historical { .. }
        ) {
            return self.resolve_reference(reference);
        }
        self.prepare_observation()?;
        let selected = self.resolve_reference(reference)?;
        if let Some((_, path, version)) = &selected {
            self.record_observed_text(path, version)?;
        }
        Ok(selected)
    }

    fn record_observed_text(&mut self, path: &str, version: &TextVersion) -> Result<()> {
        if revision_for_text(&version.text)? != version.revision {
            return Err(ContentError::InvalidBase);
        }
        if self.observation_changes_identity(path, version)? {
            // Moved identities must not remain at their old locations in the recorded tree.
            self.record_external_changes()?;
            let tree = self.repo.head()?.peel_to_commit()?.tree()?;
            if tree.get_path(Path::new(path)).ok().is_none_or(|entry| {
                !matches!(entry.filemode(), 0o100644 | 0o100755)
                    || entry.id().to_string() != version.revision
            }) {
                return Err(ContentError::History(
                    "native.content.reference.changed".into(),
                ));
            }
        }
        let (dir, name) = self.parent(path)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let metadata = dir.open_with(&name, &options)?.metadata()?;
        FileStamp::read(&metadata)?;
        #[cfg(unix)]
        let mode = {
            use cap_std::fs::MetadataExt;
            if metadata.mode() & 0o111 != 0 {
                0o100755
            } else {
                0o100644
            }
        };
        #[cfg(not(unix))]
        let mode = 0o100644;
        let parent = self.repo.head()?.peel_to_commit()?;
        let blob =
            git_storage::write_object(&self.repo, git2::ObjectType::Blob, version.text.as_bytes())?;
        let tree_id = observed_tree(
            &self.repo,
            Some(&parent.tree()?),
            &validate_path(path)?,
            blob,
            mode,
        )?;
        if tree_id == parent.tree_id() {
            self.sync_observed_history()?;
        } else {
            let head = git_storage::commit(
                &self.repo,
                &self.history_dir,
                &self.repo.find_tree(tree_id)?,
                &[&parent],
                "native.history.externalChanges",
            )?;
            self.observations.durable_head.set(Some(head));
        }
        Ok(())
    }

    fn observation_changes_identity(&self, path: &str, version: &TextVersion) -> Result<bool> {
        let tree = self.repo.head()?.peel_to_commit()?.tree()?;
        let entry = match tree.get_path(Path::new(path)) {
            Ok(entry) if matches!(entry.filemode(), 0o100644 | 0o100755) => entry,
            Ok(_) => return Ok(true),
            Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(true),
            Err(error) => return Err(error.into()),
        };
        if !is_markdown(path) || entry.id().to_string() == version.revision {
            return Ok(false);
        }
        let previous = self.repo.find_blob(entry.id())?;
        let previous = std::str::from_utf8(previous.content())
            .ok()
            .map(crate::metadata::inspect);
        let current = crate::metadata::inspect(&version.text);
        let mut previous_tasks: Vec<_> = previous
            .as_ref()
            .into_iter()
            .flat_map(|metadata| metadata.tasks.iter().map(|task| task.id.as_str()))
            .collect();
        let mut current_tasks: Vec<_> = current.tasks.iter().map(|task| task.id.as_str()).collect();
        previous_tasks.sort_unstable();
        current_tasks.sort_unstable();
        Ok(previous_tasks != current_tasks)
    }

    fn prepare_observation(&mut self) -> Result<()> {
        self.admit_lineage()?;
        let interrupted = {
            let head = self.repo.head()?.peel_to_commit()?;
            lineage::completed_operation(&self.repo, &head)?;
            matches!(
                history_records::Envelope::read(&head)?.fact,
                history_records::Fact::Boundary { .. }
            )
        };
        if interrupted {
            self.record_external_changes()?;
        }
        Ok(())
    }
}

fn observed_tree(
    repo: &Repository,
    tree: Option<&git2::Tree<'_>>,
    parts: &[&str],
    blob: Oid,
    mode: i32,
) -> Result<Oid> {
    let mut builder = repo.treebuilder(tree)?;
    if parts.len() == 1 {
        builder.insert(parts[0], blob, mode)?;
    } else {
        let child = tree
            .and_then(|tree| tree.get_name(parts[0]))
            .filter(|entry| entry.filemode() == 0o040000)
            .map(|entry| repo.find_tree(entry.id()))
            .transpose()?;
        builder.insert(
            parts[0],
            observed_tree(repo, child.as_ref(), &parts[1..], blob, mode)?,
            0o040000,
        )?;
    }
    git_storage::write_tree(repo, &mut builder)
}

#[cfg(all(test, unix))]
mod scan_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_versions_are_retained_without_observing_unrelated_files() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        std::fs::write(root.path().join("note.md"), "A").unwrap();
        std::fs::write(root.path().join("other.md"), "original").unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        std::fs::write(root.path().join("note.md"), "B").unwrap();
        std::fs::write(root.path().join("other.md"), "unobserved").unwrap();
        let base = store.observe_text("note.md").unwrap();
        let observed = store.history().unwrap()[0].revision.clone();
        assert_eq!(store.read_revision("note.md", &observed).unwrap(), b"B");
        assert_eq!(
            store.read_revision("other.md", &observed).unwrap(),
            b"original"
        );
        std::fs::write(root.path().join("note.md"), "C").unwrap();
        assert!(matches!(
            store.save("note.md", &base, "D").unwrap(),
            SaveOutcome::Conflict { .. }
        ));
        assert!(
            store
                .file_history("note.md")
                .unwrap()
                .iter()
                .any(|entry| store.read_revision("note.md", &entry.revision).unwrap() == b"C")
        );
        assert_eq!(store.read_revision("note.md", &observed).unwrap(), b"B");
    }

    #[test]
    fn a_second_external_move_cannot_overlay_stale_identity_after_a_full_observation() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let original = format!("{}Original", crate::metadata::new_document());
        let replacement = format!("{}Replacement", crate::metadata::new_document());
        std::fs::write(root.path().join("a.md"), &original).unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        std::fs::rename(root.path().join("a.md"), root.path().join("b.md")).unwrap();
        let stale = store.read_text("b.md").unwrap();
        std::fs::rename(root.path().join("b.md"), root.path().join("c.md")).unwrap();
        std::fs::write(root.path().join("b.md"), &replacement).unwrap();
        assert!(store.record_observed_text("b.md", &stale).is_err());
        let head = store.repo.head().unwrap().target().unwrap().to_string();
        assert_eq!(
            store.read_revision("b.md", &head).unwrap(),
            replacement.as_bytes()
        );
        assert_eq!(
            store.read_revision("c.md", &head).unwrap(),
            original.as_bytes()
        );
        assert!(!store.file_history("c.md").unwrap().is_empty());
    }

    #[test]
    fn observing_a_moved_task_records_its_removal_from_the_other_file() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let source = crate::metadata::new_document();
        let destination = crate::metadata::new_document();
        let task =
            "- [ ] Read <!-- {\"situate-task-id\":\"11111111-1111-4111-8111-111111111111\"} -->\n";
        std::fs::write(root.path().join("source.md"), format!("{source}{task}")).unwrap();
        std::fs::write(root.path().join("destination.md"), &destination).unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        std::fs::write(root.path().join("source.md"), &source).unwrap();
        std::fs::write(
            root.path().join("destination.md"),
            format!("{destination}{task}"),
        )
        .unwrap();
        store.observe_text("destination.md").unwrap();
        let head = store.repo.head().unwrap().target().unwrap().to_string();
        assert_eq!(
            store.read_revision("source.md", &head).unwrap(),
            source.as_bytes()
        );
        assert_eq!(
            store.read_revision("destination.md", &head).unwrap(),
            format!("{destination}{task}").as_bytes()
        );
    }

    #[test]
    fn external_markdown_is_recorded_without_enrichment_even_after_draft_discard() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        let source = "---\nsituate-id: arbitrary metadata\n---\n# New";
        std::fs::write(root.path().join("new.md"), source).unwrap();
        store
            .stage_draft(&Draft {
                path: "new.md".into(),
                base: Some(version(source).unwrap()),
                text: "# Draft".into(),
            })
            .unwrap();
        store.record_external_changes().unwrap();
        store.discard_draft("new.md").unwrap();
        let revision = store.record_external_changes().unwrap();
        assert_eq!(
            store.read_revision("new.md", &revision).unwrap(),
            source.as_bytes()
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("new.md")).unwrap(),
            source
        );
    }

    #[test]
    fn identical_read_retries_failed_history_publication() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        std::fs::write(root.path().join("note.md"), "before").unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        std::fs::write(root.path().join("note.md"), "after").unwrap();
        git_storage::FAIL_REF_SYNC.set(Some(0));
        assert!(store.observe_text("note.md").is_err());
        let head = store.repo.head().unwrap().target().unwrap();
        assert_ne!(store.observations.durable_head.get(), Some(head));
        assert_eq!(store.observe_text("note.md").unwrap().text, "after");
        assert_eq!(store.observations.durable_head.get(), Some(head));
    }

    #[cfg(unix)]
    #[test]
    fn cached_scans_detect_same_size_edits_with_restored_modification_times_and_deletions() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let path = root.path().join("note.md");
        std::fs::write(&path, "before").unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        store.record_external_changes().unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, "after!").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let changed = store.record_external_changes().unwrap();
        assert_eq!(store.read_revision("note.md", &changed).unwrap(), b"after!");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let executable = store.record_external_changes().unwrap();
        assert_ne!(changed, executable);
        let tree = store
            .repo
            .find_commit(Oid::from_str(&executable).unwrap())
            .unwrap()
            .tree()
            .unwrap();
        assert_eq!(
            tree.get_path(Path::new("note.md")).unwrap().filemode(),
            0o100755
        );
        drop(tree);
        std::fs::remove_file(&path).unwrap();
        let deleted = store.record_external_changes().unwrap();
        assert!(store.read_revision("note.md", &deleted).is_err());
        assert!(!store.observations.blobs.contains_key("note.md"));
    }

    #[test]
    fn interrupted_operations_are_sealed_without_replaying_or_rebinding() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        std::fs::write(root.path().join("a.txt"), "original").unwrap();
        std::fs::write(root.path().join("note.md"), "note").unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        live_references::INTERRUPT.set(1);
        assert!(store.move_entry("a.txt", "b.txt").is_err());
        assert_eq!(store.observe_text("note.md").unwrap().text, "note");
        let head = store.repo.head().unwrap().peel_to_commit().unwrap();
        assert!(matches!(
            history_records::Envelope::read(&head).unwrap().fact,
            history_records::Fact::Interrupted
        ));
        assert_eq!(
            std::fs::read(root.path().join("a.txt")).unwrap(),
            b"original"
        );
        assert!(!root.path().join("b.txt").exists());
        assert!(store.resolve_reference(&reference).is_err());
    }

    #[test]
    fn selected_observation_supports_new_parents_and_directory_replacement() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        std::fs::create_dir(root.path().join("old.md")).unwrap();
        std::fs::write(root.path().join("old.md/child"), "old").unwrap();
        let mut store = ContentStore::open(root.path()).unwrap();
        std::fs::create_dir_all(root.path().join("new/nested")).unwrap();
        std::fs::write(root.path().join("new/nested/note.md"), "new").unwrap();
        store.observe_text("new/nested/note.md").unwrap();
        std::fs::remove_dir_all(root.path().join("old.md")).unwrap();
        std::fs::write(root.path().join("old.md"), "replacement").unwrap();
        store.observe_text("old.md").unwrap();
        let head = store.history().unwrap()[0].revision.clone();
        assert_eq!(
            store.read_revision("new/nested/note.md", &head).unwrap(),
            b"new"
        );
        assert_eq!(
            store.read_revision("old.md", &head).unwrap(),
            b"replacement"
        );
    }
}
