use super::*;

#[cfg(all(test, windows))]
#[path = "windows_identity_tests.rs"]
mod windows_identity_tests;

pub(super) const MAX_OPERATION_BYTES: u64 = 64 * 1024 * 1024;
const MAX_OPERATION_ENTRIES: usize = 10_000;

#[cfg(test)]
thread_local! {
    pub(super) static COMPLETE_EDIT: std::cell::RefCell<Option<(String, Vec<u8>, bool)>> = const { std::cell::RefCell::new(None) };
}

fn size_limit() -> ContentError {
    unsupported("native.content.operation.tooLarge")
}

pub(super) fn read_operation_file(
    dir: &Dir,
    name: &str,
    limit: u64,
) -> Result<(Vec<u8>, same_file::Handle)> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = dir.open_with(name, &options)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(ContentError::InvalidPath);
    }
    if metadata.len() > limit {
        return Err(size_limit());
    }
    let identity = same_file::Handle::from_file(file.try_clone()?.into_std())?;
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(size_limit());
    }
    Ok((bytes, identity))
}

pub(super) enum PatchIdentity {
    Ordinary(same_file::Handle),
    #[cfg(windows)]
    Detached {
        _pin: File,
        id: windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO,
    },
}

impl PatchIdentity {
    pub(super) fn new(
        identity: same_file::Handle,
        inside_moved_directory: bool,
    ) -> io::Result<Self> {
        #[cfg(windows)]
        if inside_moved_directory {
            return detached_patch_identity(identity);
        }
        #[cfg(not(windows))]
        let _ = inside_moved_directory;
        Ok(Self::Ordinary(identity))
    }

    pub(super) fn matches(&self, candidate: &same_file::Handle) -> io::Result<bool> {
        match self {
            Self::Ordinary(identity) => Ok(identity == candidate),
            #[cfg(windows)]
            Self::Detached { id, .. } => {
                Ok(same_windows_file_ids(id, &windows_file_id(candidate)?))
            }
        }
    }
}

#[cfg(windows)]
fn windows_file_id(
    file: &impl std::os::windows::io::AsRawHandle,
) -> io::Result<windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO> {
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
    };
    let mut id = FILE_ID_INFO::default();
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut id as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(id)
}

#[cfg(windows)]
fn same_windows_file_ids(
    left: &windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO,
    right: &windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO,
) -> bool {
    left.VolumeSerialNumber == right.VolumeSerialNumber
        && left.FileId.Identifier == right.FileId.Identifier
}

#[cfg(windows)]
fn detached_patch_identity(identity: same_file::Handle) -> io::Result<PatchIdentity> {
    use std::os::windows::{
        fs::MetadataExt,
        io::{AsRawHandle, FromRawHandle},
    };
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        Storage::FileSystem::{
            ExtendedFileIdType, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_ID_DESCRIPTOR, FILE_ID_DESCRIPTOR_0, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
            FILE_SHARE_READ, FILE_SHARE_WRITE, OpenFileById,
        },
    };
    let id = windows_file_id(&identity)?;
    let descriptor = FILE_ID_DESCRIPTOR {
        dwSize: std::mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
        Type: ExtendedFileIdType,
        Anonymous: FILE_ID_DESCRIPTOR_0 {
            ExtendedFileId: id.FileId,
        },
    };
    // Relative-open readers and ReOpenFile handles can block ancestor moves.
    // Open by ID while keeping the original handle alive until verification.
    let handle = unsafe {
        OpenFileById(
            identity.as_raw_handle(),
            &descriptor,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            FILE_FLAG_OPEN_REPARSE_POINT,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let pin = unsafe { File::from_raw_handle(handle) };
    let metadata = pin.metadata()?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || !same_windows_file_ids(&id, &windows_file_id(&pin)?)
    {
        return Err(io::Error::other(
            "Content identity changed while opening its identity handle.",
        ));
    }
    Ok(PatchIdentity::Detached { _pin: pin, id })
}

/// A failed operation may have published content. The pre-operation revision keeps
/// originals recoverable; callers must not report these outcomes as saved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationOutcome {
    Complete {
        history_revision: String,
    },
    PartialFailure {
        changed_paths: Vec<String>,
        recovery_revision: String,
        error: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReversalOutcome {
    Content(SaveOutcome),
    Structure(OperationOutcome),
}

use super::history_records::{Envelope, Fact, Operation};
pub(super) struct ReferencePatch {
    old_path: String,
    new_path: String,
    bytes: Vec<u8>,
    text: String,
    identity: PatchIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Image {
    // Empty path denotes the selected entry itself; None denotes a directory.
    pub(super) entries: Vec<(String, Option<Vec<u8>>)>,
}

impl ContentStore {
    /// Creates a distinct document from editor text. The source draft
    /// remains retained until its owner explicitly discards it after success.
    pub fn create_from_draft(
        &mut self,
        source: &str,
        destination: &str,
        text: &str,
    ) -> Result<SaveOutcome> {
        disjoint(source, destination)?;
        if !is_markdown(source) && !is_markdown(destination) {
            return self.create_text(destination, text);
        }
        if !is_markdown(destination) {
            return Err(unsupported("native.content.draft.markdownRequired"));
        }
        if text.len() as u64 > MAX_OPERATION_BYTES {
            return Err(size_limit());
        }
        let mut image = Image {
            entries: vec![(String::new(), Some(text.as_bytes().to_vec()))],
        };
        regenerate(&mut image, destination, &self.ambiguous_identities(None)?)?;
        let mut known: std::collections::HashSet<_> =
            self.list()?.into_iter().map(|entry| entry.path).collect();
        known.insert(source.into());
        retarget_image(&mut image, source, destination, &known)?;
        let bytes = image.entries.remove(0).1.ok_or(ContentError::InvalidPath)?;
        let text = String::from_utf8(bytes).map_err(|_| ContentError::InvalidPath)?;
        self.create_text(destination, &text)
    }

    pub fn create_folder(&mut self, path: &str) -> Result<OperationOutcome> {
        validate_portable_path(path)?;
        self.publish_image(
            path,
            Image {
                entries: vec![(String::new(), None)],
            },
            "native.history.createFolder",
        )
    }

    pub fn copy_entry(&mut self, source: &str, destination: &str) -> Result<OperationOutcome> {
        disjoint(source, destination)?;
        let image = self.capture(source)?;
        let mut copied = image.clone();
        regenerate(&mut copied, source, &self.ambiguous_identities(None)?)?;
        let known = self.list()?.into_iter().map(|entry| entry.path).collect();
        retarget_image(&mut copied, source, destination, &known)?;
        // No source mutation; a recheck prevents copying a stale preflight version.
        if self.capture(source)? != image {
            return Err(changed());
        }
        self.publish_image(destination, copied, "native.history.copyContent")
    }

    pub fn move_entry(&mut self, source: &str, destination: &str) -> Result<OperationOutcome> {
        disjoint(source, destination)?;
        self.ensure_no_drafts(source)?;
        let image = self.capture(source)?;
        self.ensure_writable(source, &image)?;
        let (to, name) = self.parent(destination)?;
        require_absent(&to, &name, "native.content.destination.occupied")?;
        self.ensure_no_drafts(destination)?;
        let mut patches = self.move_reference_patches(source, destination, &image)?;
        let recovery = self.record_external_changes()?;
        let marker = self.marker.try_clone()?;
        let mut staged = Vec::new();
        for patch in &patches {
            staged.push(temporary_file(&marker, patch.text.as_bytes())?);
        }
        let (from, old) = self.parent(source)?;
        if self.capture(source)? != image {
            return Err(changed());
        }
        for patch in &patches {
            self.check_patch(patch, &patch.old_path)?;
        }
        let mut identities = self.pin_image(source, destination, &image)?;
        let boundary = self.begin_operation(
            Operation::Move {
                source: source.into(),
                destination: destination.into(),
            },
            Some((&image, source)),
            &patches,
            None,
        )?;
        #[cfg(test)]
        super::live_references::interrupt_move(1)?;
        rename_noreplace(&from, &old, &to, &name)?;
        let mut changed_paths = vec![source.into(), destination.into()];
        let result = (|| -> Result<()> {
            sync_dir(&from)?;
            sync_dir(&to)?;
            #[cfg(test)]
            super::live_references::interrupt_move(2)?;
            self.check_identities(&identities)?;
            for (patch, stage) in patches.iter_mut().zip(&staged) {
                // Transfer the identity pin only after checking the post-move file.
                // Keeping the detached Windows link blocks later replacement.
                patch.identity = PatchIdentity::Ordinary(self.check_patch(patch, &patch.new_path)?);
                let (dir, name) = self.parent(&patch.new_path)?;
                let permissions = dir.symlink_metadata(&name)?.permissions();
                marker.set_permissions(stage, permissions)?;
                let (_, identity) = read_operation_file(&marker, stage, MAX_OPERATION_BYTES)?;
                let identity = PatchIdentity::new(identity, true)?;
                marker.rename(stage, &dir, &name)?;
                identities.insert(patch.new_path.clone(), identity);
                changed_paths.push(patch.new_path.clone());
                sync_dir(&dir)?;
                #[cfg(test)]
                super::live_references::interrupt_move(4)?;
            }
            sync_dir(&marker)?;
            #[cfg(test)]
            super::live_references::interrupt_move(3)?;
            #[cfg(test)]
            if let Some((path, bytes, replace)) = COMPLETE_EDIT.take() {
                let (dir, name) = self.parent(&path)?;
                if replace {
                    let stage = temporary_file(&dir, &bytes)?;
                    dir.rename(stage, &dir, name)?;
                } else {
                    dir.write(name, bytes)?;
                }
            }
            self.check_identities(&identities)?;
            Ok(())
        })();
        Ok(self.finish_structural(
            changed_paths,
            recovery,
            boundary,
            "native.history.moveContent",
            result,
        ))
    }

    pub fn delete_entry(&mut self, path: &str) -> Result<OperationOutcome> {
        self.ensure_no_drafts(path)?;
        let image = self.capture(path)?;
        self.ensure_writable(path, &image)?;
        let recovery = self.record_external_changes()?;
        let (parent, name) = self.parent(path)?;
        let marker = self.marker.try_clone()?;
        let retained = format!("deleted-{}", uuid::Uuid::new_v4());
        if self.capture(path)? != image {
            return Err(changed());
        }
        let identities = self.pin_image(path, path, &image)?;
        let boundary = self.begin_operation(
            Operation::Delete {
                source: path.into(),
            },
            Some((&image, path)),
            &[],
            None,
        )?;
        self.check_identities(&identities)?;
        #[cfg(test)]
        super::live_references::interrupt_move(1)?;
        // Retain the actual entry as well as Git bytes; do not recursively unlink
        // entries which an unrelated writer could replace during traversal.
        rename_noreplace(&parent, &name, &marker, &retained)?;
        let result = (|| -> Result<()> {
            sync_dir(&parent)?;
            sync_dir(&marker)?;
            #[cfg(test)]
            super::live_references::interrupt_move(2)?;
            for (original, identity) in &identities {
                let retained_path = format!("{retained}{}", &original[path.len()..]);
                let mut parts = retained_path.split('/').collect::<Vec<_>>();
                let name = parts.pop().ok_or(ContentError::InvalidPath)?;
                let mut dir = marker.try_clone()?;
                for part in parts {
                    dir = child_dir(&dir, part)?;
                }
                if !identity.matches(&read_operation_file(&dir, name, MAX_OPERATION_BYTES)?.1)? {
                    return Err(changed());
                }
            }
            Ok(())
        })();
        Ok(self.finish_structural(
            vec![path.into()],
            recovery,
            boundary,
            "native.history.deleteContent",
            result,
        ))
    }

    pub fn historical_copy(
        &mut self,
        path: &str,
        revision: &str,
        destination: &str,
    ) -> Result<OperationOutcome> {
        let selected = path.to_owned();
        let mut image = self.revision_image(&selected, revision)?;
        regenerate(
            &mut image,
            &selected,
            &self.ambiguous_identities(Some(revision))?,
        )?;
        let known = self
            .list_revision(revision)?
            .into_iter()
            .map(|entry| entry.path)
            .collect();
        retarget_image(&mut image, &selected, destination, &known)?;
        self.publish_image(destination, image, "native.history.copyHistorical")
    }

    /// Occupied destinations reject without mutation. A different destination is
    /// an explicit caller decision; restoration never regenerates identities.
    pub fn restore_deleted(
        &mut self,
        path: &str,
        revision: &str,
        destination: &str,
    ) -> Result<OperationOutcome> {
        let image = self.revision_image(path, revision)?;
        let mut identities = std::collections::HashSet::new();
        for (relative, bytes) in &image.entries {
            if !is_markdown(&joined(path, relative)) {
                continue;
            }
            if let Some(bytes) = bytes
                && let Ok(source) = std::str::from_utf8(bytes)
            {
                let metadata = crate::metadata::inspect(source);
                identities.extend(metadata.tasks.into_iter().map(|task| task.id));
            }
        }
        if self
            .resolve_entry_path(
                path,
                revision,
                image
                    .entries
                    .first()
                    .is_some_and(|(_, bytes)| bytes.is_none()),
            )?
            .is_some()
        {
            return Err(ContentError::InvalidReview);
        }
        if !identities.is_empty() {
            for entry in self.list()? {
                if entry.is_directory || !is_markdown(&entry.path) {
                    continue;
                }
                let (dir, name) = self.parent(&entry.path)?;
                let bytes = read_operation_file(&dir, &name, MAX_OPERATION_BYTES)?.0;
                let Ok(source) = std::str::from_utf8(&bytes) else {
                    continue;
                };
                let metadata = crate::metadata::inspect(source);
                if metadata
                    .tasks
                    .iter()
                    .any(|task| identities.contains(&task.id))
                {
                    return Err(ContentError::InvalidReview);
                }
            }
        }
        self.publish_image(destination, image, "native.history.restoreContent")
    }

    pub fn reverse_entry_change(&mut self, path: &str, revision: &str) -> Result<ReversalOutcome> {
        validate_path(path)?;
        self.validated_history()?;
        let (parent_revision, operation, before, after) = {
            let commit = self.validated_revision(revision)?;
            if matches!(Envelope::read(&commit)?.fact, Fact::Boundary { .. }) {
                return Err(ContentError::InvalidReview);
            }
            if commit.parent_count() != 1 {
                return Err(unsupported("native.content.history.parentAmbiguous"));
            }
            let parent = commit.parent(0)?;
            let before = tree_entry_id(&parent.tree()?, path)?;
            let after = tree_entry_id(&commit.tree()?, path)?;
            (
                if matches!(Envelope::read(&parent)?.fact, Fact::Boundary { .. }) {
                    parent.parent_id(0)?.to_string()
                } else {
                    parent.id().to_string()
                },
                super::lineage::completed_operation(&self.repo, &commit)?,
                before,
                after,
            )
        };
        if let Some(Operation::Move {
            source,
            destination,
        }) = operation
            && (path == source
                || path == destination
                || path.starts_with(&format!("{destination}/")))
        {
            let expected = self.revision_image(&destination, revision)?;
            self.ensure_reversal_continuity(&destination, revision, &expected)?;
            let current = self.capture(&destination)?;
            if expected.entries.len() != current.entries.len()
                || expected.entries.iter().zip(&current.entries).any(
                    |((relative, bytes), (current_path, current_bytes))| {
                        relative != current_path
                            || (!is_markdown(&joined(&destination, relative))
                                && bytes != current_bytes)
                    },
                )
            {
                return Err(ContentError::InvalidReview);
            }
            return self
                .move_entry(&destination, &source)
                .map(ReversalOutcome::Structure);
        }
        match (before, after) {
            (None, Some(_)) => {
                let expected = self.revision_image(path, revision)?;
                self.ensure_reversal_continuity(path, revision, &expected)?;
                if self.capture(path)? != expected {
                    return Err(ContentError::InvalidReview);
                }
                self.delete_entry(path).map(ReversalOutcome::Structure)
            }
            (Some(_), None) => self
                .restore_deleted(path, &parent_revision, path)
                .map(ReversalOutcome::Structure),
            (Some(_), Some(_)) => self
                .reverse_change(path, revision)
                .map(ReversalOutcome::Content),
            (None, None) => Err(unsupported("native.content.history.pathUnchanged")),
        }
    }

    fn ensure_reversal_continuity(&self, root: &str, revision: &str, image: &Image) -> Result<()> {
        let mut remaining = 100_000;
        let mut metadata_remaining = 16 * 1024 * 1024;
        for (relative, bytes) in &image.entries {
            let path = joined(root, relative);
            let resolved = self.resolve_entry_path_with_budget(
                &path,
                revision,
                bytes.is_none(),
                &mut remaining,
                &mut metadata_remaining,
            )?;
            if resolved.as_deref() != Some(&path) {
                return Err(ContentError::InvalidReview);
            }
        }
        Ok(())
    }

    /// Reverse this commit's text delta, not the whole file's later history.
    /// Structural and binary changes require a separate reviewed operation.
    pub fn reverse_change(&mut self, path: &str, revision: &str) -> Result<SaveOutcome> {
        self.validated_history()?;
        let before_revision = {
            let commit = self.validated_revision(revision)?;
            if matches!(Envelope::read(&commit)?.fact, Fact::Boundary { .. }) {
                return Err(ContentError::InvalidReview);
            }
            if commit.parent_count() != 1 {
                return Err(unsupported("native.content.history.parentAmbiguous"));
            }
            commit.parent_id(0)?.to_string()
        };
        let after = text_version(self.read_file_revision(path, revision)?)?;
        let before = text_version(self.read_file_revision(path, &before_revision)?)?;
        self.ensure_no_drafts(path)?;
        // save's ancestor is the selected change's output; applying its input
        // against today's bytes is a three-way compensating merge.
        if before == after {
            return Err(unsupported("native.content.history.fileUnchanged"));
        }
        self.save_named(
            path,
            &after,
            &before.text,
            &crate::messages::error(
                "native.history.reverseChange",
                serde_json::json!({"revision":revision}),
            ),
        )
    }

    pub(super) fn read_operation_revision(&self, path: &str, revision: &str) -> Result<Vec<u8>> {
        validate_path(path)?;
        let tree = self.validated_revision(revision)?.tree()?;
        let entry = tree.get_path(Path::new(path))?;
        let (size, _) = self.repo.odb()?.read_header(entry.id())?;
        if size as u64 > MAX_OPERATION_BYTES {
            return Err(size_limit());
        }
        self.read_revision(path, revision)
    }

    fn ambiguous_identities(
        &self,
        revision: Option<&str>,
    ) -> Result<std::collections::HashSet<String>> {
        let entries = match revision {
            Some(revision) => self.list_revision(revision)?,
            None => self.list()?,
        };
        let mut counts = HashMap::<String, usize>::new();
        for entry in entries {
            if entry.is_directory || !is_markdown(&entry.path) {
                continue;
            }
            let bytes = match revision {
                Some(revision) => self.read_operation_revision(&entry.path, revision)?,
                None => {
                    let (dir, name) = self.parent(&entry.path)?;
                    read_operation_file(&dir, &name, MAX_OPERATION_BYTES)?.0
                }
            };
            let Ok(source) = std::str::from_utf8(&bytes) else {
                continue;
            };
            let metadata = crate::metadata::inspect(source);
            for task in metadata.tasks {
                *counts.entry(task.id).or_default() += 1;
            }
        }
        Ok(counts
            .into_iter()
            .filter_map(|(id, count)| (count > 1).then_some(id))
            .collect())
    }

    fn move_reference_patches(
        &self,
        source: &str,
        destination: &str,
        image: &Image,
    ) -> Result<Vec<ReferencePatch>> {
        let entries = self.list()?;
        let known = entries.iter().map(|entry| entry.path.clone()).collect();
        let mapping: HashMap<_, _> = image
            .entries
            .iter()
            .map(|(relative, _)| (joined(source, relative), joined(destination, relative)))
            .collect();
        let mut patches = Vec::new();
        let mut patch_bytes = 0u64;
        for entry in entries {
            if entry.is_directory || !is_markdown(&entry.path) {
                continue;
            }
            let (dir, name) = self.parent(&entry.path)?;
            let (bytes, identity) = read_operation_file(&dir, &name, MAX_OPERATION_BYTES)?;
            let Ok(text) = std::str::from_utf8(&bytes) else {
                continue;
            };
            let new_path = mapping.get(&entry.path).unwrap_or(&entry.path).clone();
            let updated =
                super::references::retarget_paths(text, &entry.path, &new_path, &mapping, &known)?;
            if updated == text {
                continue;
            }
            self.ensure_no_drafts(&entry.path)?;
            if dir.symlink_metadata(&name)?.permissions().readonly() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "native.content.references.readOnly",
                )
                .into());
            }
            patch_bytes = patch_bytes
                .checked_add(bytes.len() as u64 + updated.len() as u64)
                .ok_or_else(size_limit)?;
            if patch_bytes > MAX_OPERATION_BYTES || patches.len() >= MAX_OPERATION_ENTRIES {
                return Err(size_limit());
            }
            let identity =
                PatchIdentity::new(identity, entry.path.starts_with(&format!("{source}/")))?;
            patches.push(ReferencePatch {
                old_path: entry.path,
                new_path,
                bytes,
                text: updated,
                identity,
            });
        }
        Ok(patches)
    }

    fn check_patch(&self, patch: &ReferencePatch, path: &str) -> Result<same_file::Handle> {
        let (dir, name) = self.parent(path)?;
        let (bytes, identity) = read_operation_file(&dir, &name, MAX_OPERATION_BYTES)?;
        if bytes != patch.bytes || !patch.identity.matches(&identity)? {
            return Err(changed());
        }
        if dir.symlink_metadata(&name)?.permissions().readonly() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "native.content.references.readOnly",
            )
            .into());
        }
        Ok(identity)
    }

    fn capture(&self, path: &str) -> Result<Image> {
        let (parent, name) = self.parent(path)?;
        let mut image = Image {
            entries: Vec::new(),
        };
        let mut remaining = MAX_OPERATION_BYTES;
        capture_entry(&parent, &name, "", &mut image, &mut remaining)?;
        image.entries.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(image)
    }

    fn ensure_no_drafts(&self, path: &str) -> Result<()> {
        if self
            .drafts()?
            .iter()
            .any(|draft| draft.path == path || draft.path.starts_with(&format!("{path}/")))
        {
            return Err(ContentError::DraftPersistence(
                "native.content.draft.destinationExists".into(),
            ));
        }
        Ok(())
    }

    fn ensure_writable(&self, path: &str, image: &Image) -> Result<()> {
        for (relative, _) in &image.entries {
            let full = joined(path, relative);
            let (dir, name) = self.parent(&full)?;
            if dir.symlink_metadata(name)?.permissions().readonly() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "native.content.readOnly",
                )
                .into());
            }
        }
        Ok(())
    }

    fn revision_image(&self, path: &str, revision: &str) -> Result<Image> {
        validate_path(path)?;
        let commit = self.validated_revision(revision)?;
        let entry = commit.tree()?.get_path(Path::new(path))?;
        let mut image = Image {
            entries: Vec::new(),
        };
        let mut remaining = MAX_OPERATION_BYTES;
        capture_object(&self.repo, entry.id(), "", &mut image, &mut remaining)?;
        image.entries.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(image)
    }

    fn publish_image(
        &mut self,
        path: &str,
        image: Image,
        message: &str,
    ) -> Result<OperationOutcome> {
        let (parent, name) = self.parent(path)?;
        require_absent(&parent, &name, "native.content.destination.occupied")?;
        self.ensure_no_drafts(path)?;
        let recovery = self.record_external_changes()?;
        let stage = format!(".situate-write-{}", uuid::Uuid::new_v4());
        // All bytes and directories are constructed privately before publication.
        // Failed stages are retained, not destructively rolled back.
        build_image(&parent, &stage, &image)?;
        let boundary = self.begin_operation(
            Operation::Create {
                destination: path.into(),
            },
            None,
            &[],
            Some((&image, path)),
        )?;
        #[cfg(test)]
        super::live_references::interrupt_move(1)?;
        rename_noreplace(&parent, &stage, &parent, &name)?;
        let result = sync_dir(&parent).map_err(ContentError::from);
        Ok(self.finish_structural(vec![path.into()], recovery, boundary, message, result))
    }

    fn pin_image(
        &self,
        source: &str,
        destination: &str,
        image: &Image,
    ) -> Result<HashMap<String, PatchIdentity>> {
        let mut identities = HashMap::new();
        for (relative, bytes) in &image.entries {
            let Some(expected) = bytes else {
                continue;
            };
            let (dir, name) = self.parent(&joined(source, relative))?;
            let (bytes, identity) = read_operation_file(&dir, &name, MAX_OPERATION_BYTES)?;
            if &bytes != expected {
                return Err(changed());
            }
            identities.insert(
                joined(destination, relative),
                PatchIdentity::new(identity, true)?,
            );
        }
        Ok(identities)
    }

    fn check_identities(&self, identities: &HashMap<String, PatchIdentity>) -> Result<()> {
        for (path, identity) in identities {
            let (dir, name) = self.parent(path)?;
            if !identity.matches(&read_operation_file(&dir, &name, MAX_OPERATION_BYTES)?.1)? {
                return Err(changed());
            }
        }
        Ok(())
    }

    pub(super) fn begin_operation(
        &self,
        operation: Operation,
        source: Option<(&Image, &str)>,
        patches: &[ReferencePatch],
        created: Option<(&Image, &str)>,
    ) -> Result<Oid> {
        let parent = self.repo.head()?.peel_to_commit()?;
        let before = super::lineage::tree_image(&self.repo, parent.tree_id())?;
        if let Some((image, root)) = source {
            let selected: Vec<_> = before
                .iter()
                .filter(|(path, _)| super::history_records::below(path, root))
                .collect();
            if selected.len() != image.entries.len() {
                return Err(changed());
            }
            for (relative, bytes) in &image.entries {
                let entry = before.get(&joined(root, relative)).ok_or_else(changed)?;
                match (bytes, entry) {
                    (None, None) => {}
                    (Some(bytes), Some((id, _)))
                        if *id == Oid::hash_object(git2::ObjectType::Blob, bytes)? => {}
                    _ => return Err(changed()),
                }
            }
        }
        let mut result = before.clone();
        if let Some((image, root)) = created {
            for (relative, bytes) in &image.entries {
                let entry = bytes
                    .as_ref()
                    .map(|bytes| {
                        git_storage::write_object(&self.repo, git2::ObjectType::Blob, bytes)
                            .map(|id| (id, 0o100644))
                    })
                    .transpose()?;
                result.insert(joined(root, relative), entry);
            }
        }
        result = super::lineage::apply_operation(&before, &result, &operation, &[])?;
        for patch in patches {
            let old = before.get(&patch.old_path).ok_or_else(changed)?;
            let Some((id, mode)) = old else {
                return Err(changed());
            };
            if *id != Oid::hash_object(git2::ObjectType::Blob, &patch.bytes)? {
                return Err(changed());
            }
            let id = git_storage::write_object(
                &self.repo,
                git2::ObjectType::Blob,
                patch.text.as_bytes(),
            )?;
            result.insert(patch.new_path.clone(), Some((id, *mode)));
        }
        let expected_tree = super::lineage::write_image(&self.repo, &result)?;
        let fact = Fact::Boundary {
            operation,
            expected_tree: expected_tree.to_string(),
            patches: patches.iter().map(|patch| patch.new_path.clone()).collect(),
        };
        git_storage::commit_fact(
            &self.repo,
            &self.history_dir,
            &parent.tree()?,
            &[&parent],
            "native.history.operationBoundary",
            fact,
        )
    }

    pub(super) fn finish_structural(
        &mut self,
        paths: Vec<String>,
        recovery: String,
        boundary: Oid,
        message: &str,
        durability: Result<()>,
    ) -> OperationOutcome {
        let finish = || -> Result<String> {
            durability?;
            let parent = self.repo.head()?.peel_to_commit()?;
            if parent.id() != boundary {
                return Err(changed());
            }
            let Fact::Boundary {
                operation,
                expected_tree,
                patches,
            } = Envelope::read(&parent)?.fact
            else {
                return Err(changed());
            };
            let tree = self.repo.find_tree(Oid::from_str(&expected_tree)?)?;
            let expected = super::lineage::tree_image(&self.repo, tree.id())?;
            let actual =
                super::lineage::tree_image(&self.repo, snapshot_tree(&self.repo, &self.root)?)?;
            let footprint = |path: &&String| {
                operation.affects(path)
                    || patches
                        .iter()
                        .any(|patch| super::history_records::below(path, patch))
            };
            let wanted: Vec<_> = expected
                .iter()
                .filter(|(path, _)| footprint(path))
                .collect();
            let observed: Vec<_> = actual.iter().filter(|(path, _)| footprint(path)).collect();
            if wanted != observed {
                return Err(changed());
            }
            let before = super::lineage::tree_image(&self.repo, parent.tree_id())?;
            if super::lineage::apply_operation(&before, &expected, &operation, &patches)?
                != expected
            {
                return Err(changed());
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
            Ok(revision.to_string())
        };
        match finish() {
            Ok(history_revision) => OperationOutcome::Complete { history_revision },
            Err(error) => OperationOutcome::PartialFailure {
                changed_paths: paths,
                recovery_revision: recovery,
                error: error.to_string(),
            },
        }
    }
}

fn tree_entry_id(tree: &git2::Tree<'_>, path: &str) -> Result<Option<Oid>> {
    match tree.get_path(Path::new(path)) {
        Ok(entry) => Ok(Some(entry.id())),
        Err(error) if error.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn joined(root: &str, child: &str) -> String {
    if root.is_empty() {
        child.into()
    } else if child.is_empty() {
        root.into()
    } else {
        format!("{root}/{child}")
    }
}
fn disjoint(source: &str, destination: &str) -> Result<()> {
    validate_path(source)?;
    validate_path(destination)?;
    if source == destination
        || destination.starts_with(&format!("{source}/"))
        || source.starts_with(&format!("{destination}/"))
    {
        return Err(ContentError::InvalidPath);
    }
    Ok(())
}
fn changed() -> ContentError {
    io::Error::new(
        io::ErrorKind::WouldBlock,
        "native.content.operation.changed",
    )
    .into()
}
fn unsupported(message: &str) -> ContentError {
    io::Error::new(io::ErrorKind::Unsupported, message).into()
}
fn capture_entry(
    parent: &Dir,
    name: &str,
    relative: &str,
    image: &mut Image,
    remaining: &mut u64,
) -> Result<()> {
    if image.entries.len() >= MAX_OPERATION_ENTRIES {
        return Err(size_limit());
    }
    let metadata = parent.symlink_metadata(name)?;
    if metadata.is_symlink() {
        return Err(ContentError::InvalidPath);
    }
    if metadata.is_file() {
        let bytes = read_operation_file(parent, name, *remaining)?.0;
        *remaining -= bytes.len() as u64;
        image.entries.push((relative.into(), Some(bytes)));
    } else if metadata.is_dir() {
        image.entries.push((relative.into(), None));
        let dir = child_dir(parent, name)?;
        let mut names = Vec::new();
        for entry in dir.entries()? {
            if image.entries.len() + names.len() >= MAX_OPERATION_ENTRIES {
                return Err(size_limit());
            }
            names.push(
                entry?
                    .file_name()
                    .into_string()
                    .map_err(|_| ContentError::InvalidPath)?,
            );
        }
        names.sort();
        for child in names {
            validate_path(&child)?;
            let path = if relative.is_empty() {
                child.clone()
            } else {
                joined(relative, &child)
            };
            capture_entry(&dir, &child, &path, image, remaining)?;
        }
    } else {
        return Err(ContentError::InvalidPath);
    }
    Ok(())
}
fn capture_object(
    repo: &Repository,
    id: Oid,
    relative: &str,
    image: &mut Image,
    remaining: &mut u64,
) -> Result<()> {
    if image.entries.len() >= MAX_OPERATION_ENTRIES {
        return Err(size_limit());
    }
    let (size, kind) = repo.odb()?.read_header(id)?;
    if size as u64 > *remaining {
        return Err(size_limit());
    }
    if kind == git2::ObjectType::Blob {
        *remaining -= size as u64;
    }
    let object = repo.find_object(id, None)?;
    if let Some(blob) = object.as_blob() {
        image
            .entries
            .push((relative.into(), Some(blob.content().to_vec())));
    } else if let Some(tree) = object.as_tree() {
        image.entries.push((relative.into(), None));
        for entry in tree {
            let name = entry.name()?;
            validate_path(name)?;
            if !matches!(entry.filemode(), 0o100644 | 0o100755 | 0o040000) {
                return Err(ContentError::InvalidPath);
            }
            let path = if relative.is_empty() {
                name.into()
            } else {
                joined(relative, name)
            };
            capture_object(repo, entry.id(), &path, image, remaining)?;
        }
    } else {
        return Err(ContentError::InvalidPath);
    }
    Ok(())
}
fn build_image(parent: &Dir, stage: &str, image: &Image) -> Result<()> {
    for (relative, bytes) in &image.entries {
        let path = joined(stage, relative);
        let mut parts = path.split('/').collect::<Vec<_>>();
        let name = parts.pop().ok_or(ContentError::InvalidPath)?;
        let mut dir = parent.try_clone()?;
        for part in parts {
            dir = child_dir(&dir, part)?;
        }
        if let Some(bytes) = bytes {
            let mut options = OpenOptions::new();
            options
                .write(true)
                .create_new(true)
                .follow(FollowSymlinks::No);
            #[cfg(unix)]
            {
                use cap_std::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = dir.open_with(name, &options)?;
            file.write_all(bytes)?;
            file.sync_all()?;
        } else {
            dir.create_dir(name)?;
        }
        sync_dir(&dir)?;
    }
    Ok(())
}

#[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
pub(super) fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> Result<()> {
    crate::durable_storage::rename_noreplace(from, old, to, new)?;
    Ok(())
}
#[cfg(windows)]
fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> Result<()> {
    use std::os::windows::{ffi::OsStrExt, ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, MoveFileExW};
    fn path(dir: &Dir, name: &str) -> io::Result<Vec<u16>> {
        let file = dir.try_clone()?.into_std_file();
        let mut buffer = vec![0u16; 32768];
        // The directory handle was opened without following symlinks. Windows
        // publication still requires ancestors to stay put until MoveFileExW.
        let size = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        if size as usize >= buffer.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "native.content.path.tooLong",
            ));
        }
        buffer.truncate(size as usize);
        let path = PathBuf::from(std::ffi::OsString::from_wide(&buffer)).join(name);
        Ok(path.as_os_str().encode_wide().chain(Some(0)).collect())
    }
    let from = path(from, old)?;
    let to = path(to, new)?;
    // Zero flags exclude replacement, including an existing empty directory.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
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
fn rename_noreplace(_from: &Dir, _old: &str, _to: &Dir, _new: &str) -> Result<()> {
    Err(unsupported(
        "native.content.operation.publicationUnsupported",
    ))
}

fn retarget_image(
    image: &mut Image,
    source: &str,
    destination: &str,
    known: &std::collections::HashSet<String>,
) -> Result<()> {
    let mapping = image
        .entries
        .iter()
        .map(|(relative, _)| (joined(source, relative), joined(destination, relative)))
        .collect();
    let mut total: usize = image
        .entries
        .iter()
        .filter_map(|(_, bytes)| bytes.as_ref().map(Vec::len))
        .sum();
    if total as u64 > MAX_OPERATION_BYTES {
        return Err(size_limit());
    }
    for (relative, bytes) in &mut image.entries {
        let old = joined(source, relative);
        if !is_markdown(&old) {
            continue;
        }
        if let Some(bytes) = bytes
            && let Ok(text) = std::str::from_utf8(bytes)
        {
            let updated = super::references::retarget_paths(
                text,
                &old,
                &joined(destination, relative),
                &mapping,
                known,
            )?
            .into_bytes();
            total = total - bytes.len() + updated.len();
            if total as u64 > MAX_OPERATION_BYTES {
                return Err(size_limit());
            }
            *bytes = updated;
        }
    }
    Ok(())
}

pub(super) fn regenerate(
    image: &mut Image,
    root: &str,
    ambiguous: &std::collections::HashSet<String>,
) -> Result<HashMap<String, String>> {
    let mut plans = Vec::new();
    let mut mapping = HashMap::new();
    for (index, (relative, bytes)) in image.entries.iter().enumerate() {
        if !is_markdown(&joined(root, relative)) {
            continue;
        }
        let Some(bytes) = bytes else {
            continue;
        };
        let source = match classify_file(bytes)? {
            FileContent::Text(source) => source,
            FileContent::Binary => continue,
        };
        let plan = crate::metadata::copy_identities(source).map_err(|e| unsupported(&e))?;
        for (old, new) in &plan.identities {
            if mapping.insert(old.clone(), new.clone()).is_some() {
                return Err(unsupported("native.metadata.copiedIdentitiesAmbiguous"));
            }
        }
        plans.push((index, plan.source));
    }
    mapping.retain(|id, _| !ambiguous.contains(id));
    for (index, source) in plans {
        image.entries[index].1 =
            Some(crate::metadata::retarget_identity_links(&source, &mapping).into_bytes());
    }
    Ok(mapping)
}
