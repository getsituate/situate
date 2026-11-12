//! Versioned storage for ordinary filesystem workspaces, not mobile provider handles.
//!
//! Keep one store alive per workspace. Its advisory lock excludes cooperating stores;
//! `&mut self` serializes operations. External programs do not honor that lock. Reads
//! and final byte rechecks are not an atomic filesystem compare-and-swap: an external
//! write between recheck and replacement can still be lost. Directory handles prevent
//! symlink traversal, but concurrent directory relocation may move the opened target.
//! Situate exclusively manages Git internals; other programs may edit content
//! files, not history files. Workspace snapshots are sequential observations,
//! not atomic multi-file snapshots. Symlinks and technical directories are excluded,
//! except the editable `.situate/working-method.md` document. Non-UTF-8 filenames
//! and special files reject a snapshot rather than being silently omitted.
//!
//! Saves preserve caller bytes; metadata validation/identity confirmation belongs to
//! the caller. A successful draft write precedes each versioned text target write. Retain editor text
//! on every error, especially `DraftPersistence`, which promises no restart recovery.

mod file_kind;
pub use file_kind::{FileContent, classify_file};
mod import_batch;
pub use import_batch::{CreateBatchOutcome, CreatedFile, PreparedFile, is_batch_manifest_path};
mod paths;
pub use paths::{WORKING_METHOD_PATH, validate_portable_path, validate_provider_path};
use paths::{technical, validate_history_path as validate_path};

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use git2::{Oid, Repository, Signature};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fmt,
    fs::File,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub enum ContentError {
    Io(io::Error),
    History(String),
    InvalidPath,
    InvalidBase,
    Busy,
    DraftPersistence(String),
    InvalidReview,
}
impl fmt::Display for ContentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => f.write_str(&crate::messages::supplied(
                e,
                "native.content.storage.failed",
            )),
            Self::History(e) => f.write_str(&crate::messages::supplied(
                e,
                "native.content.history.unavailable",
            )),
            Self::InvalidPath => f.write_str("native.content.path.unsafe"),
            Self::InvalidBase => f.write_str("native.content.base.mismatch"),
            Self::Busy => f.write_str("native.content.store.busy"),
            Self::DraftPersistence(_) => f.write_str("native.content.draft.recoveryFailed"),
            Self::InvalidReview => f.write_str("native.content.conflict.reviewAgain"),
        }
    }
}
impl std::error::Error for ContentError {}
impl From<io::Error> for ContentError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<git2::Error> for ContentError {
    fn from(e: git2::Error) -> Self {
        Self::History(e.to_string())
    }
}
pub type Result<T> = std::result::Result<T, ContentError>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextVersion {
    pub text: String,
    pub revision: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentEntry {
    pub path: String,
    pub is_directory: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub path: Option<String>,
    pub deleted: bool,
    pub revision: String,
    pub message: String,
    pub timestamp: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub path: String,
    pub base: Option<TextVersion>,
    pub text: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedDraft {
    version: u32,
    draft: Draft,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SaveOutcome {
    Saved {
        version: TextVersion,
        history_revision: String,
    },
    Conflict {
        editor: String,
        external: TextVersion,
        review_token: String,
    },
    ExternalDeleted,
    ChangedSinceReview,
    SavedHistoryFailed {
        version: TextVersion,
        error: String,
    },
    SavedDraftCleanupFailed {
        version: TextVersion,
        history_revision: String,
        error: String,
    },
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum VersionChoice {
    Editor,
    External,
}
struct Review {
    message: String,
    path: String,
    editor: String,
    external: TextVersion,
    identity: same_file::Handle,
}

mod agent_tools;
pub use agent_tools::{ExactEdit, apply_exact_edits};
mod git_storage;
mod history;
#[cfg(test)]
mod history_limits_tests;
mod history_records;
mod lineage;
mod live_references;
mod observation;
#[cfg(test)]
mod operation_tests;
mod operations;
#[cfg(test)]
mod publication_tests;
mod references;
#[cfg(test)]
mod reversal_lineage_tests;
#[cfg(test)]
mod text_write_tests;
mod text_writes;
mod tree_facts;
pub use history::{DeletedEntry, RevisionChange, RevisionChangeStatus};
#[cfg(test)]
mod revision_changes_tests;
pub use operations::{OperationOutcome, ReversalOutcome};

struct ContentOwnership(File);

impl ContentOwnership {
    fn acquire(file: File) -> Result<Self> {
        file.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => ContentError::Busy,
            std::fs::TryLockError::Error(error) => ContentError::Io(error),
        })?;
        Ok(Self(file))
    }
}

impl Drop for ContentOwnership {
    fn drop(&mut self) {
        // An unrelated fork can retain the file description after the owner closes it.
        let _ = self.0.unlock();
    }
}

pub struct ContentStore {
    root: Dir,
    marker: Dir,
    drafts: Dir,
    history_dir: Dir,
    repo: Repository,
    _ownership: ContentOwnership,
    reviews: HashMap<String, Review>,
    observations: observation::ObservationCache,
}

impl ContentStore {
    /// Initializes history only inside an existing real `.situate` directory.
    /// Existing but unusable history is never reset or replaced. Opening records
    /// observed changes, including binaries, without replaying interrupted operations.
    pub fn open(path: &Path) -> Result<Self> {
        let root = Dir::open_ambient_dir(path, ambient_authority())?;
        let marker = child_dir(&root, ".situate")?;
        Self::open_store(root, marker, &path.join(".situate"), true)
    }

    /// Keeps code history stable when an installed code directory is replaced.
    /// Callers validate both paths and serialize publication with history recording.
    pub(crate) fn open_with_history(path: &Path, marker_path: &Path) -> Result<Self> {
        Self::open_separate_history(path, marker_path, true)
    }

    /// Opens existing history under normal ownership without initializing metadata,
    /// changing Git configuration, or observing current source contents.
    pub fn open_existing_history(path: &Path, marker_path: &Path) -> Result<Self> {
        Self::open_separate_history(path, marker_path, false)
    }

    fn open_separate_history(path: &Path, marker_path: &Path, observe: bool) -> Result<Self> {
        let root = Dir::open_ambient_dir(path, ambient_authority())?;
        let marker_parent = Dir::open_ambient_dir(
            marker_path
                .parent()
                .ok_or_else(|| io::Error::other("native.content.path.unsafe"))?,
            ambient_authority(),
        )?;
        let marker = child_dir(
            &marker_parent,
            marker_path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| io::Error::other("native.content.path.unsafe"))?,
        )?;
        Self::open_store(root, marker, marker_path, observe)
    }

    fn open_store(root: Dir, marker: Dir, marker_path: &Path, observe: bool) -> Result<Self> {
        let mut opts = OpenOptions::new();
        opts.read(true)
            .write(true)
            .create(observe)
            .follow(FollowSymlinks::No);
        let ownership = marker.open_with("content.lock", &opts)?.into_std();
        if !observe && !ownership.metadata()?.is_file() {
            return Err(ContentError::InvalidPath);
        }
        let ownership = ContentOwnership::acquire(ownership)?;
        let history_path = marker_path.canonicalize()?.join("history.git");
        let exists = match marker.symlink_metadata("history.git") {
            Ok(m) if m.is_dir() && !m.is_symlink() => true,
            Ok(_) => {
                return Err(ContentError::History(
                    "native.content.history.notDirectory".into(),
                ));
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => false,
            Err(e) => return Err(e.into()),
        };
        let repo = if exists {
            let directory = child_dir(&marker, "history.git")?;
            reject_links(&directory)?;
            // Older Unix writers could leave unflushed, unreferenced objects.
            // Older Windows initialization failed before publishing history.git.
            #[cfg(not(windows))]
            if observe {
                sync_tree(&directory)?;
            }
            let repo = Repository::open_bare(&history_path)?;
            let repo = if observe {
                git_storage::configure(repo, &directory)?
            } else {
                repo
            };
            repo.head()?.peel_to_commit()?.tree()?;
            repo
        } else if observe {
            initialize_history(&root, &marker, &history_path)?
        } else {
            return Err(ContentError::History(
                "native.content.history.notDirectory".into(),
            ));
        };
        if observe {
            if !marker.try_exists("drafts")? {
                marker.create_dir("drafts")?;
            }
            sync_dir(&marker)?;
        }
        let drafts = child_dir(&marker, "drafts")?;
        let mut store = Self {
            root,
            drafts,
            history_dir: child_dir(&marker, "history.git")?,
            marker,
            repo,
            _ownership: ownership,
            reviews: HashMap::new(),
            observations: Default::default(),
        };
        if observe {
            store.record_external_changes()?;
        }
        Ok(store)
    }

    pub(crate) fn record_directory_replacement(&mut self, path: &Path) -> Result<String> {
        self.root = Dir::open_ambient_dir(path, ambient_authority())?;
        self.record_external_changes()
    }

    /// Lists user content and the editable working method, excluding other internals and symlinks.
    pub fn list(&self) -> Result<Vec<ContentEntry>> {
        let mut entries = Vec::new();
        list_dir(&self.root, "", &mut entries)?;
        append_working_method_entry(&self.marker, &mut entries)?;
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }

    pub fn working_method(&self) -> Result<Option<TextVersion>> {
        read_working_method_file(&self.marker)
    }

    pub fn read_text(&self, path: &str) -> Result<TextVersion> {
        let (dir, name) = self.parent(path)?;
        let (bytes, _) = read_file(&dir, &name)?;
        text_version(bytes)
    }

    /// Records observed external changes independently. Hosts may call this from
    /// their watcher/poll loop; this type does not install a filesystem watcher.
    pub fn record_external_changes(&mut self) -> Result<String> {
        self.admit_lineage()?;
        {
            let parent = self.repo.head()?.peel_to_commit()?;
            let record = history_records::Envelope::read(&parent)?;
            lineage::completed_operation(&self.repo, &parent)?;
            self.sync_observed_history()?;
            if matches!(record.fact, history_records::Fact::Boundary { .. }) {
                let tree = self
                    .repo
                    .find_tree(snapshot_tree(&self.repo, &self.root)?)?;
                return Ok(git_storage::commit_fact(
                    &self.repo,
                    &self.history_dir,
                    &tree,
                    &[&parent],
                    "native.history.interruptedChanges",
                    history_records::Fact::Interrupted,
                )?
                .to_string());
            }
        }
        self.record_snapshot("native.history.externalChanges")
    }

    pub fn save(&mut self, path: &str, base: &TextVersion, text: &str) -> Result<SaveOutcome> {
        self.save_named(path, base, text, "native.history.editFile")
    }

    fn save_named(
        &mut self,
        path: &str,
        base: &TextVersion,
        text: &str,
        message: &str,
    ) -> Result<SaveOutcome> {
        validate_path(path)?;
        if version(&base.text)?.revision != base.revision {
            return Err(ContentError::InvalidBase);
        }
        self.persist_draft(&Draft {
            path: path.into(),
            base: Some(base.clone()),
            text: text.into(),
        })?;
        self.reviews.retain(|_, review| review.path != path);
        self.record_external_changes()?;
        let (dir, name) = match self.parent(path) {
            Ok(parent) => parent,
            Err(ContentError::Io(e)) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(SaveOutcome::ExternalDeleted);
            }
            Err(e) => return Err(e),
        };
        let (bytes, identity) = match read_file(&dir, &name) {
            Ok(v) => v,
            Err(ContentError::Io(e)) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(SaveOutcome::ExternalDeleted);
            }
            Err(e) => return Err(e),
        };
        let external = text_version(bytes)?;
        self.record_file(
            path,
            external.text.as_bytes(),
            "native.history.externalChanges",
        )?;
        let merged = if external.text == base.text || external.text == text {
            text.to_owned()
        } else {
            let mut ancestor = git2::MergeFileInput::new();
            let mut ours = git2::MergeFileInput::new();
            let mut theirs = git2::MergeFileInput::new();
            ancestor.content(base.text.as_bytes());
            ours.content(text.as_bytes());
            theirs.content(external.text.as_bytes());
            let result = git2::merge_file(&ancestor, &ours, &theirs, None)?;
            if !result.is_automergeable() {
                let token = uuid::Uuid::new_v4().to_string();
                self.reviews.insert(
                    token.clone(),
                    Review {
                        message: message.into(),
                        path: path.into(),
                        editor: text.into(),
                        external: external.clone(),
                        identity,
                    },
                );
                return Ok(SaveOutcome::Conflict {
                    editor: text.into(),
                    external,
                    review_token: token,
                });
            }
            String::from_utf8(result.content().to_vec()).map_err(|_| ContentError::InvalidBase)?
        };
        self.replace_checked(path, &external, &identity, &merged, message)
    }

    /// Review tokens are scoped to this open store. Both bytes and file identity
    /// are checked again; replacing a file at the same path invalidates the choice.
    pub fn resolve(&mut self, review_token: &str, choice: VersionChoice) -> Result<SaveOutcome> {
        let review = self
            .reviews
            .remove(review_token)
            .ok_or(ContentError::InvalidReview)?;
        let text = match choice {
            VersionChoice::Editor => &review.editor,
            VersionChoice::External => &review.external.text,
        };
        // The original editor draft remains recoverable if the chosen write fails.
        let result = self.record_external_changes().and_then(|_| {
            self.replace_checked(
                &review.path,
                &review.external,
                &review.identity,
                text,
                &review.message,
            )
        });
        if !matches!(
            result,
            Ok(SaveOutcome::Saved { .. } | SaveOutcome::SavedDraftCleanupFailed { .. })
        ) {
            self.reviews.insert(review_token.into(), review);
        }
        result
    }

    /// Creates a file without replacing any existing directory entry. The caller
    /// supplies all metadata and must assign new identities where required.
    pub fn create_text(&mut self, path: &str, text: &str) -> Result<SaveOutcome> {
        let (dir, name) = self.parent(path)?;
        require_absent(&dir, &name, "native.content.destination.occupied")?;
        require_absent(
            &self.drafts,
            &draft_name(path)?,
            "native.content.draft.exists",
        )?;
        self.persist_draft(&Draft {
            path: path.into(),
            base: None,
            text: text.into(),
        })?;
        self.reviews.retain(|_, review| review.path != path);
        self.record_external_changes()?;
        let temp = temporary_file(&dir, text.as_bytes())?;
        let written = version(text)?;
        let identity = text_writes::pin_stage(&dir, &temp)?;
        let boundary = self.begin_text_write(path, None, text)?;
        publish_new_file(&dir, &temp, &name)?;
        self.finish_text_write(
            path,
            written,
            "native.history.createFile",
            boundary,
            &identity,
            &dir,
        )
    }

    pub fn drafts(&self) -> Result<Vec<Draft>> {
        read_drafts(&self.drafts)
    }

    /// Call only after the user explicitly discards a draft or secures another copy.
    pub fn discard_draft(&mut self, path: &str) -> Result<()> {
        validate_path(path)?;
        match self.drafts.remove_file(draft_name(path)?) {
            Ok(()) => sync_dir(&self.drafts)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
        Ok(())
    }

    /// Newest-first changes and uncertain observations, without session grouping.
    /// Internal pre-operation boundaries are not exposed as user actions.
    pub fn history(&self) -> Result<Vec<HistoryEntry>> {
        self.validated_history()?
            .into_iter()
            .filter(|entry| !matches!(entry.fact, history_records::Fact::Boundary { .. }))
            .map(|entry| {
                let commit = entry.commit;
                Ok(HistoryEntry {
                    path: None,
                    deleted: false,
                    revision: commit.id().to_string(),
                    message: history_records::summary(&commit)?,
                    timestamp: commit.time().seconds(),
                })
            })
            .collect()
    }

    pub fn read_revision(&self, path: &str, revision: &str) -> Result<Vec<u8>> {
        validate_path(path)?;
        let commit = self.validated_revision(revision)?;
        let tree = commit.tree()?;
        let entry = tree.get_path(Path::new(path))?;
        Ok(self.repo.find_blob(entry.id())?.content().to_vec())
    }

    fn parent(&self, path: &str) -> Result<(Dir, String)> {
        let parts = validate_path(path)?;
        let mut dir = self.root.try_clone()?;
        for part in &parts[..parts.len() - 1] {
            dir = child_dir(&dir, part)?;
        }
        Ok((dir, parts.last().unwrap().to_string()))
    }

    /// Secures editor text without changing the target file or recording a save.
    pub fn stage_draft(&mut self, draft: &Draft) -> Result<()> {
        validate_path(&draft.path)?;
        if let Some(base) = &draft.base
            && version(&base.text)?.revision != base.revision
        {
            return Err(ContentError::InvalidBase);
        }
        self.persist_draft(draft)
    }

    fn persist_draft(&self, draft: &Draft) -> Result<()> {
        let persist = || -> Result<()> {
            let name = draft_name(&draft.path)?;
            match read_file(&self.drafts, &name) {
                Ok((bytes, _)) => {
                    let previous = decode_draft(&bytes)?;
                    if previous.path != draft.path {
                        return Err(ContentError::DraftPersistence(
                            "native.content.draft.targetMismatch".into(),
                        ));
                    }
                    if previous.base != draft.base
                        && draft
                            .base
                            .as_ref()
                            .is_none_or(|base| base.text != previous.text)
                        && previous.text != draft.text
                    {
                        return Err(ContentError::DraftPersistence(
                            "native.content.draft.baseMismatch".into(),
                        ));
                    }
                }
                Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            let bytes = serde_json::to_vec(&PersistedDraft {
                version: 1,
                draft: draft.clone(),
            })
            .map_err(|e| ContentError::DraftPersistence(e.to_string()))?;
            let temp = temporary_file(&self.drafts, &bytes)?;
            self.drafts.rename(&temp, &self.drafts, name)?;
            sync_dir(&self.drafts)?;
            Ok(())
        };
        persist().map_err(|error| match error {
            ContentError::DraftPersistence(_) => error,
            other => ContentError::DraftPersistence(other.to_string()),
        })
    }

    fn replace_checked(
        &mut self,
        path: &str,
        expected: &TextVersion,
        identity: &same_file::Handle,
        text: &str,
        message: &str,
    ) -> Result<SaveOutcome> {
        let (dir, name) = match self.parent(path) {
            Ok(parent) => parent,
            Err(ContentError::Io(e)) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(SaveOutcome::ExternalDeleted);
            }
            Err(e) => return Err(e),
        };
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let permissions = match dir.open_with(&name, &options) {
            Ok(file) => file.metadata()?.permissions(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(SaveOutcome::ExternalDeleted);
            }
            Err(e) => return Err(e.into()),
        };
        if permissions.readonly() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "native.content.file.readOnly",
            )
            .into());
        }
        if let Some(outcome) = self.recheck_text_source(path, expected, identity)? {
            return Ok(outcome);
        }
        let written = version(text)?;
        if text == expected.text {
            return self.finish_unchanged_save(path, written, identity);
        }
        let temp = temporary_file_with_permissions(&dir, text.as_bytes(), Some(permissions))?;
        let staged = text_writes::pin_stage(&dir, &temp)?;
        let boundary = self.begin_text_write(path, Some(expected), text)?;
        match self.recheck_text_source(path, expected, identity) {
            Ok(None) => {}
            Ok(Some(outcome)) => {
                let _ = dir.remove_file(&temp);
                return Ok(outcome);
            }
            Err(error) => {
                let _ = dir.remove_file(&temp);
                return Err(error);
            }
        }
        if let Err(e) = dir.rename(&temp, &dir, &name) {
            let _ = dir.remove_file(&temp);
            return Err(e.into());
        }
        self.finish_text_write(path, written, message, boundary, &staged, &dir)
    }

    fn record_file(&self, path: &str, bytes: &[u8], message: &str) -> Result<String> {
        let parent = self.repo.head()?.peel_to_commit()?;
        let tree_id = replace_tree_entry(
            &self.repo,
            &parent.tree()?,
            &validate_path(path)?,
            git_storage::write_object(&self.repo, git2::ObjectType::Blob, bytes)?,
        )?;
        if tree_id == parent.tree_id() {
            self.sync_observed_history()?;
            return Ok(parent.id().to_string());
        }
        let id = git_storage::commit(
            &self.repo,
            &self.history_dir,
            &self.repo.find_tree(tree_id)?,
            &[&parent],
            message,
        )?;
        Ok(id.to_string())
    }

    fn record_snapshot(&mut self, message: &str) -> Result<String> {
        let mut blobs = HashMap::new();
        let tree_id = snapshot_tree_cached(
            &self.repo,
            &self.root,
            "",
            &self.observations.blobs,
            &mut blobs,
        )?;
        self.observations.blobs = blobs;
        let tree = self.repo.find_tree(tree_id)?;
        let parent = self.repo.head()?.peel_to_commit()?;
        if parent.tree_id() == tree_id {
            self.sync_observed_history()?;
            return Ok(parent.id().to_string());
        }
        let id = git_storage::commit(&self.repo, &self.history_dir, &tree, &[&parent], message)?;
        self.observations.durable_head.set(Some(id));
        Ok(id.to_string())
    }
}

/// Reads retained drafts without opening, initializing or repairing Git history.
/// This remains available when history is damaged or snapshot creation fails.
/// No files are changed; callers must not treat returned text as saved content.
pub fn read_recovery_drafts(path: &Path) -> Result<Vec<Draft>> {
    let root = Dir::open_ambient_dir(path, ambient_authority())?;
    let marker = child_dir(&root, ".situate")?;
    match child_dir(&marker, "drafts") {
        Ok(drafts) => read_drafts(&drafts),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

/// Explicitly discards recovery text without requiring usable Git history.
/// The same workspace lock excludes a concurrently active content store.
pub fn discard_recovery_draft(root: &Path, path: &str) -> Result<()> {
    validate_path(path)?;
    let root = Dir::open_ambient_dir(root, ambient_authority())?;
    let marker = child_dir(&root, ".situate")?;
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(true)
        .follow(FollowSymlinks::No);
    let _ownership =
        ContentOwnership::acquire(marker.open_with("content.lock", &options)?.into_std())?;
    let drafts = child_dir(&marker, "drafts")?;
    let name = draft_name(path)?;
    match read_file(&drafts, &name) {
        Ok((bytes, _)) => {
            let draft = decode_draft(&bytes)?;
            if draft.path != path {
                return Err(ContentError::InvalidPath);
            }
            drafts.remove_file(name)?;
            sync_dir(&drafts)?;
        }
        Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    Ok(())
}

pub fn read_working_method(root: &Path) -> Result<Option<TextVersion>> {
    let root = Dir::open_ambient_dir(root, ambient_authority())?;
    let marker = child_dir(&root, ".situate")?;
    read_working_method_file(&marker)
}

fn append_working_method_entry(marker: &Dir, entries: &mut Vec<ContentEntry>) -> Result<()> {
    match marker.symlink_metadata("working-method.md") {
        Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => {
            entries.push(ContentEntry {
                path: WORKING_METHOD_PATH.into(),
                is_directory: false,
            });
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

fn read_working_method_file(marker: &Dir) -> Result<Option<TextVersion>> {
    match read_file_bounded(marker, "working-method.md", 65_536) {
        Ok((bytes, _)) => text_version(bytes).map(Some),
        Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Read-only navigation remains available when Git history cannot be opened.
pub fn list_content(root: &Path) -> Result<Vec<ContentEntry>> {
    let root = Dir::open_ambient_dir(root, ambient_authority())?;
    let marker = child_dir(&root, ".situate")?;
    let mut entries = Vec::new();
    list_dir(&root, "", &mut entries)?;
    append_working_method_entry(&marker, &mut entries)?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn read_drafts(directory: &Dir) -> Result<Vec<Draft>> {
    let mut drafts = Vec::new();
    for entry in directory.entries()? {
        let name = entry?.file_name();
        let name = name.to_str().ok_or(ContentError::InvalidPath)?;
        if !name.ends_with(".json") {
            continue;
        }
        let (bytes, _) = read_file(directory, name)?;
        drafts.push(decode_draft(&bytes)?);
    }
    drafts.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(drafts)
}

fn decode_draft(bytes: &[u8]) -> Result<Draft> {
    let record: PersistedDraft =
        serde_json::from_slice(bytes).map_err(|e| ContentError::DraftPersistence(e.to_string()))?;
    if record.version != 1 {
        return Err(ContentError::DraftPersistence(
            "native.content.draft.unsupported".into(),
        ));
    }
    validate_path(&record.draft.path)?;
    Ok(record.draft)
}

fn require_absent(dir: &Dir, name: &str, message: &str) -> Result<()> {
    match dir.symlink_metadata(name) {
        Ok(_) => Err(io::Error::new(io::ErrorKind::AlreadyExists, message).into()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn initialize_history(root: &Dir, marker: &Dir, history_path: &Path) -> Result<Repository> {
    let stage = format!("history-init-{}", uuid::Uuid::new_v4());
    marker.create_dir(&stage)?;
    let initialize = || -> Result<()> {
        let stage_path = history_path.with_file_name(&stage);
        let mut options = git2::RepositoryInitOptions::new();
        options
            .bare(true)
            .external_template(false)
            .initial_head("main");
        let directory = child_dir(marker, &stage)?;
        let repo =
            git_storage::configure(Repository::init_opts(&stage_path, &options)?, &directory)?;
        let tree = repo.find_tree(snapshot_tree(&repo, root)?)?;
        git_storage::commit(
            &repo,
            &directory,
            &tree,
            &[],
            "native.history.initialContent",
        )?;
        drop(tree);
        drop(repo);
        drop(directory);
        publish_history(marker, &stage, history_path)?;
        sync_dir(marker)?;
        Ok(())
    };
    let result = initialize();
    // Windows cleanup of READONLY objects could change their hardlink aliases.
    #[cfg(not(windows))]
    if result.is_err() {
        // Only the uniquely owned staging directory is disposable; never history.git.
        let _ = marker.remove_dir_all(&stage);
    }
    result?;
    Ok(Repository::open_bare(history_path)?)
}

#[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
fn publish_history(marker: &Dir, stage: &str, _history_path: &Path) -> Result<()> {
    let file = marker.try_clone()?.into_std_file();
    rustix::fs::renameat_with(
        &file,
        stage,
        &file,
        "history.git",
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .map_err(io::Error::from)?;
    Ok(())
}
#[cfg(windows)]
fn publish_history(_marker: &Dir, stage: &str, history_path: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let from: Vec<u16> = history_path
        .with_file_name(stage)
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let to: Vec<u16> = history_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Zero flags deliberately omit MOVEFILE_REPLACE_EXISTING. Both buffers are NUL-terminated.
    if unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0)
    } == 0
    {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}
#[cfg(not(any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    windows
)))]
fn publish_history(_marker: &Dir, _stage: &str, _history_path: &Path) -> Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "native.content.history.initializationUnsupported",
    )
    .into())
}

fn is_markdown(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn child_dir(dir: &Dir, name: &str) -> io::Result<Dir> {
    cap_primitives::fs::open_dir_nofollow(&dir.try_clone()?.into_std_file(), Path::new(name))
        .map(Dir::from_std_file)
}
fn read_file(dir: &Dir, name: &str) -> Result<(Vec<u8>, same_file::Handle)> {
    read_file_bounded(dir, name, u64::MAX)
}
fn read_file_bounded(dir: &Dir, name: &str, limit: u64) -> Result<(Vec<u8>, same_file::Handle)> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = dir.open_with(name, &options)?;
    if !file.metadata()?.is_file() {
        return Err(ContentError::InvalidPath);
    }
    let identity = same_file::Handle::from_file(file.try_clone()?.into_std())?;
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::other("native.files.read.tooLarge").into());
    }
    Ok((bytes, identity))
}
/// Git blob identifier of these exact UTF-8 bytes; does not read or write storage.
pub fn revision_for_text(text: &str) -> Result<String> {
    Ok(Oid::hash_object(git2::ObjectType::Blob, text.as_bytes())?.to_string())
}

fn version(text: &str) -> Result<TextVersion> {
    Ok(TextVersion {
        text: text.into(),
        revision: revision_for_text(text)?,
    })
}
fn text_version(bytes: Vec<u8>) -> Result<TextVersion> {
    let text = match classify_file(&bytes)? {
        FileContent::Text(text) => text.to_owned(),
        FileContent::Binary => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "native.content.file.invalidUtf8",
            )
            .into());
        }
    };
    version(&text)
}
fn draft_name(path: &str) -> Result<String> {
    Ok(format!(
        "{}.json",
        Oid::hash_object(git2::ObjectType::Blob, path.as_bytes())?
    ))
}
fn sync_dir(dir: &Dir) -> io::Result<()> {
    crate::durable_storage::sync_directory(dir)
}
fn publish_new_file(dir: &Dir, stage: &str, name: &str) -> Result<()> {
    #[cfg(target_os = "android")]
    let result = operations::rename_noreplace(dir, stage, dir, name);
    #[cfg(not(target_os = "android"))]
    let result = dir.hard_link(stage, dir, name).map_err(ContentError::from);
    let _ = dir.remove_file(stage);
    result
}

fn temporary_file(dir: &Dir, bytes: &[u8]) -> Result<String> {
    temporary_file_with_permissions(dir, bytes, None)
}
fn temporary_file_with_permissions(
    dir: &Dir,
    bytes: &[u8],
    permissions: Option<cap_std::fs::Permissions>,
) -> Result<String> {
    let name = format!(".situate-write-{}", uuid::Uuid::new_v4());
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = dir.open_with(&name, &opts)?;
    let write = || -> io::Result<()> {
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        file.write_all(bytes)?;
        file.sync_all()
    };
    if let Err(e) = write() {
        let _ = dir.remove_file(&name);
        return Err(e.into());
    }
    Ok(name)
}
fn list_dir(dir: &Dir, prefix: &str, result: &mut Vec<ContentEntry>) -> Result<()> {
    for entry in dir.entries()? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| ContentError::InvalidPath)?;
        if technical(&name) || crate::ignored_files::is_ignored(&name) {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        validate_path(&path)?;
        if kind.is_file() || kind.is_dir() {
            result.push(ContentEntry {
                path: path.clone(),
                is_directory: kind.is_dir(),
            });
        } else {
            return Err(ContentError::InvalidPath);
        }
        if kind.is_dir() {
            list_dir(&child_dir(dir, &name)?, &path, result)?;
        }
    }
    Ok(())
}
fn replace_tree_entry(
    repo: &Repository,
    tree: &git2::Tree<'_>,
    parts: &[&str],
    blob: Oid,
) -> Result<Oid> {
    let mut builder = repo.treebuilder(Some(tree))?;
    if parts.len() == 1 {
        let mode = tree.get_name(parts[0]).map_or(0o100644, |e| e.filemode());
        builder.insert(parts[0], blob, mode)?;
    } else {
        let entry = tree.get_name(parts[0]).ok_or(ContentError::InvalidPath)?;
        let child = repo.find_tree(entry.id())?;
        builder.insert(
            parts[0],
            replace_tree_entry(repo, &child, &parts[1..], blob)?,
            0o040000,
        )?;
    }
    git_storage::write_tree(repo, &mut builder)
}
fn snapshot_tree(repo: &Repository, dir: &Dir) -> Result<Oid> {
    snapshot_tree_cached(repo, dir, "", &HashMap::new(), &mut HashMap::new())
}
fn snapshot_tree_cached(
    repo: &Repository,
    dir: &Dir,
    prefix: &str,
    previous: &HashMap<String, observation::CachedBlob>,
    next: &mut HashMap<String, observation::CachedBlob>,
) -> Result<Oid> {
    let mut tree = repo.treebuilder(None)?;
    for entry in dir.entries()? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| ContentError::InvalidPath)?;
        let path = format!("{prefix}{name}");
        let instruction_directory = prefix.is_empty() && name == ".situate";
        if (prefix == ".situate/" && name != "working-method.md")
            || (technical(&name) && !instruction_directory)
            || crate::ignored_files::is_ignored(&name)
        {
            continue;
        }
        let kind = entry.file_type()?;
        paths::validate_tree_path(&path, kind.is_dir())?;
        if kind.is_symlink() {
            continue;
        }
        if instruction_directory && !kind.is_dir() {
            return Err(ContentError::InvalidPath);
        }
        if kind.is_dir() {
            let oid = snapshot_tree_cached(
                repo,
                &child_dir(dir, &name)?,
                &format!("{path}/"),
                previous,
                next,
            )?;
            tree.insert(&name, oid, 0o040000)?;
        } else if kind.is_file() {
            #[cfg(unix)]
            if let Some(cached) = previous.get(&path) {
                let stamp = observation::FileStamp::read(&dir.symlink_metadata(&name)?)?;
                if cached.stamp.reusable(&stamp) {
                    // Reusing retained bytes does not authorize reading the current file.
                    tree.insert(&name, cached.oid, cached.mode)?;
                    next.insert(path, cached.clone());
                    continue;
                }
            }
            let mut options = OpenOptions::new();
            options.read(true).follow(FollowSymlinks::No).nonblock(true);
            let mut file = dir.open_with(&name, &options)?;
            let stamp = observation::FileStamp::read(&file.metadata()?)?;
            let (blob, mode) = match previous.get(&path) {
                Some(cached) if cached.stamp.reusable(&stamp) => (cached.oid, cached.mode),
                _ => {
                    let observed = snapshot_open_blob(repo, &mut file)?;
                    if !stamp.reusable(&observation::FileStamp::read(&file.metadata()?)?) {
                        tree.insert(&name, observed.0, observed.1)?;
                        continue;
                    }
                    observed
                }
            };
            next.insert(
                path,
                observation::CachedBlob {
                    stamp,
                    oid: blob,
                    mode,
                },
            );
            tree.insert(&name, blob, mode)?;
        } else {
            return Err(ContentError::InvalidPath);
        }
    }
    git_storage::write_tree(repo, &mut tree)
}
fn sync_tree(dir: &Dir) -> Result<()> {
    let mut batch = crate::durable_storage::SyncBatch::default();
    sync_tree_in_batch(dir, &mut batch)?;
    batch.finish()?;
    Ok(())
}

fn sync_tree_in_batch(dir: &Dir, batch: &mut crate::durable_storage::SyncBatch) -> Result<()> {
    for entry in dir.entries()? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            let child = cap_primitives::fs::open_dir_nofollow(
                &dir.try_clone()?.into_std_file(),
                Path::new(&entry.file_name()),
            )?;
            sync_tree_in_batch(&Dir::from_std_file(child), batch)?;
        } else if kind.is_file() {
            batch.sync_file(history_file_for_sync(dir, &entry.file_name())?)?;
        } else {
            return Err(ContentError::History(
                "native.content.history.unsupportedEntry".into(),
            ));
        }
    }
    batch.sync_directory(dir)?;
    Ok(())
}

fn sync_history_file(dir: &Dir, name: &std::ffi::OsStr) -> io::Result<()> {
    history_file_for_sync(dir, name)?.sync_all()
}

#[cfg(not(windows))]
fn history_file_for_sync(dir: &Dir, name: &std::ffi::OsStr) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    Ok(dir.open_with(name, &options)?.into_std())
}

#[cfg(windows)]
fn history_file_for_sync(dir: &Dir, name: &std::ffi::OsStr) -> io::Result<File> {
    use cap_std::fs::OpenOptionsExt;
    use std::os::windows::{
        fs::MetadataExt,
        io::{AsRawHandle, FromRawHandle},
    };
    use windows_sys::Win32::{
        Foundation::{GENERIC_WRITE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ, FILE_SHARE_WRITE, ReOpenFile,
        },
    };

    let mut options = OpenOptions::new();
    options
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .follow(FollowSymlinks::No);
    let file = dir.open_with(name, &options)?.into_std();
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "History entry is not a regular file.",
        ));
    }
    // Changing READONLY also changes every hard-link alias, including aliases
    // outside history. Do not acquire write access by changing file attributes.
    if metadata.permissions().readonly() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Read-only history files cannot be synchronized safely.",
        ));
    }
    let identity = same_file::Handle::from_file(file.try_clone()?)?;
    let handle = unsafe {
        ReOpenFile(
            file.as_raw_handle(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_FLAG_OPEN_REPARSE_POINT,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let writable = unsafe { File::from_raw_handle(handle) };
    let metadata = writable.metadata()?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || same_file::Handle::from_file(writable.try_clone()?)? != identity
    {
        return Err(io::Error::other(
            "History file identity changed before synchronization.",
        ));
    }
    Ok(writable)
}

fn snapshot_blob(repo: &Repository, dir: &Dir, name: &str) -> Result<(Oid, i32)> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let mut file = dir.open_with(name, &options)?;
    snapshot_open_blob(repo, &mut file)
}
fn snapshot_open_blob(repo: &Repository, file: &mut cap_std::fs::File) -> Result<(Oid, i32)> {
    let before = file.metadata()?;
    if !before.is_file() {
        return Err(ContentError::InvalidPath);
    }
    let size = usize::try_from(before.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "native.content.file.tooLarge"))?;
    let database = repo.odb()?;
    let mut writer = git_storage::BlobWriter::new(&database, size)?;
    let copied = io::copy(&mut (&mut *file).take(before.len()), &mut writer)?;
    let extra = file.read(&mut [0])?;
    let after = file.metadata()?;
    if copied != before.len()
        || extra != 0
        || after.len() != before.len()
        || after.modified()? != before.modified()?
    {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "native.content.history.fileChanged",
        )
        .into());
    }
    #[cfg(unix)]
    let mode = {
        use cap_std::fs::MetadataExt;
        if before.mode() & 0o111 != 0 {
            0o100755
        } else {
            0o100644
        }
    };
    #[cfg(not(unix))]
    let mode = 0o100644;
    Ok((writer.finish()?, mode))
}

pub(crate) fn reject_links(dir: &Dir) -> Result<()> {
    for entry in dir.entries()? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(ContentError::History(
                "native.content.history.symlink".into(),
            ));
        }
        if kind.is_dir() {
            let name: PathBuf = entry.file_name().into();
            let child =
                cap_primitives::fs::open_dir_nofollow(&dir.try_clone()?.into_std_file(), &name)?;
            reject_links(&Dir::from_std_file(child))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
#[cfg(all(test, windows))]
mod windows_test_support;
#[cfg(test)]
mod working_method_tests;
