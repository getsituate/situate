use super::*;
use git2::{ObjectType, Odb, OdbWriter, Tree, TreeBuilder};
use sha1collisiondetection::Sha1CD;

// Situate owns this repository and does not run GC. Reusing an immutable object
// must not invoke libgit2's freshening, which can clear READONLY on Windows.
pub(super) fn configure(repo: Repository, directory: &Dir) -> Result<Repository> {
    let path = repo.path().to_path_buf();
    let mut config = repo.config()?.open_level(git2::ConfigLevel::Local)?;
    let enabled = match config.get_bool("core.fsyncObjectFiles") {
        Ok(value) => value,
        Err(error) if error.code() == git2::ErrorCode::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if !enabled {
        sync_history_file(directory, std::ffi::OsStr::new("config"))?;
        config.set_bool("core.fsyncObjectFiles", true)?;
    }
    drop(config);
    // ODB and ref backends cache this setting when first opened.
    drop(repo);
    Ok(Repository::open_bare(path)?)
}

pub(super) fn write_object(repo: &Repository, kind: ObjectType, bytes: &[u8]) -> Result<Oid> {
    let oid = Oid::hash_object(kind, bytes)?;
    let database = repo.odb()?;
    if !database.exists(oid) && database.write(kind, bytes)? != oid {
        return Err(invalid_object());
    }
    Ok(oid)
}

pub(super) fn write_tree(repo: &Repository, builder: &mut TreeBuilder<'_>) -> Result<Oid> {
    let mut entries = Vec::with_capacity(builder.len());
    builder.filter(|entry| {
        entries.push(entry.to_owned());
        true
    })?;
    // TreeEntry ordering uses Git's directory-aware filename comparator.
    entries.sort();
    let mut bytes = Vec::new();
    for entry in entries {
        write!(bytes, "{:o} ", entry.filemode())?;
        bytes.extend_from_slice(entry.name_bytes());
        bytes.push(0);
        bytes.extend_from_slice(entry.id().as_bytes());
    }
    write_object(repo, ObjectType::Tree, &bytes)
}

pub(super) struct BlobWriter<'odb, 'repo> {
    database: &'odb Odb<'repo>,
    stream: OdbWriter<'odb>,
    hash: Sha1CD,
}

impl<'odb, 'repo> BlobWriter<'odb, 'repo> {
    pub(super) fn new(database: &'odb Odb<'repo>, size: usize) -> Result<Self> {
        let mut hash = Sha1CD::default();
        hash.update(format!("blob {size}\0"));
        Ok(Self {
            database,
            stream: database.writer(size, ObjectType::Blob)?,
            hash,
        })
    }

    pub(super) fn finish(mut self) -> Result<Oid> {
        // Keep collision detection on the reuse path, where libgit2's stream
        // finalizer (and its collision check) deliberately does not run.
        let digest = self.hash.finalize_cd().map_err(|_| invalid_object())?;
        let oid = Oid::from_bytes(&digest)?;
        if !self.database.exists(oid) && self.stream.finalize()? != oid {
            return Err(invalid_object());
        }
        Ok(oid)
    }
}

impl Write for BlobWriter<'_, '_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let written = self.stream.write(bytes)?;
        self.hash.update(&bytes[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}

fn invalid_object() -> ContentError {
    ContentError::History("native.content.history.invalidObject".into())
}

pub(super) fn commit(
    repo: &Repository,
    directory: &Dir,
    tree: &Tree<'_>,
    parents: &[&git2::Commit<'_>],
    message: &str,
) -> Result<Oid> {
    let fact = if message == "native.history.externalChanges" {
        super::history_records::Fact::Observation
    } else {
        super::history_records::Fact::Change
    };
    commit_fact(repo, directory, tree, parents, message, fact)
}

pub(super) fn commit_fact(
    repo: &Repository,
    directory: &Dir,
    tree: &Tree<'_>,
    parents: &[&git2::Commit<'_>],
    summary: &str,
    fact: super::history_records::Fact,
) -> Result<Oid> {
    if parents.len() > 1 {
        return Err(super::history_records::invalid());
    }
    let message = super::history_records::Envelope {
        version: 1,
        parent_tree: parents.first().map(|parent| parent.tree_id().to_string()),
        result_tree: tree.id().to_string(),
        fact,
    }
    .message(summary)?;
    let author = Signature::now("Situate", "content@situate.invalid")?;
    let bytes = repo.commit_create_buffer(&author, &author, &message, tree, parents)?;
    let oid = write_object(repo, ObjectType::Commit, &bytes)?;
    sync_objects(directory)?;
    let name = match repo.head() {
        Ok(head) => head.name()?.to_owned(),
        Err(error) if error.code() == git2::ErrorCode::UnbornBranch => repo
            .find_reference("HEAD")?
            .symbolic_target()?
            .ok_or(ContentError::InvalidPath)?
            .to_owned(),
        Err(error) => return Err(error.into()),
    };
    repo.reference(&name, oid, true, &message)?;
    #[cfg(test)]
    if FAIL_REF_SYNC.with(|failure| match failure.get() {
        Some(0) => {
            failure.set(None);
            true
        }
        Some(remaining) => {
            failure.set(Some(remaining - 1));
            false
        }
        None => false,
    }) {
        return Err(io::Error::other("native.content.history.unavailable").into());
    }
    sync_controls(directory)?;
    Ok(oid)
}

pub(super) fn sync_history(directory: &Dir) -> Result<()> {
    // An unchanged retry can follow a ref update whose final flush failed.
    sync_objects(directory)?;
    sync_controls(directory)
}

fn sync_objects(directory: &Dir) -> Result<()> {
    let mut batch = crate::durable_storage::SyncBatch::default();
    sync_object_directories(&child_dir(directory, "objects")?, &mut batch)?;
    batch.sync_directory(directory)?;
    batch.finish()?;
    Ok(())
}

fn sync_object_directories(
    directory: &Dir,
    batch: &mut crate::durable_storage::SyncBatch,
) -> Result<()> {
    for entry in directory.entries()? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            let child = cap_primitives::fs::open_dir_nofollow(
                &directory.try_clone()?.into_std_file(),
                Path::new(&entry.file_name()),
            )?;
            sync_object_directories(&Dir::from_std_file(child), batch)?;
        } else if !kind.is_file() {
            return Err(ContentError::History(
                "native.content.history.unsupportedEntry".into(),
            ));
        }
    }
    // Object bytes were flushed by their creation handle, before publication.
    batch.sync_directory(directory)?;
    Ok(())
}

fn sync_controls(directory: &Dir) -> Result<()> {
    let mut batch = crate::durable_storage::SyncBatch::default();
    for entry in directory.entries()? {
        let entry = entry?;
        if entry.file_name() == "objects" {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_dir() {
            let child = cap_primitives::fs::open_dir_nofollow(
                &directory.try_clone()?.into_std_file(),
                Path::new(&entry.file_name()),
            )?;
            sync_tree_in_batch(&Dir::from_std_file(child), &mut batch)?;
        } else if kind.is_file() {
            batch.sync_file(history_file_for_sync(directory, &entry.file_name())?)?;
        } else {
            return Err(ContentError::History(
                "native.content.history.unsupportedEntry".into(),
            ));
        }
    }
    batch.sync_directory(directory)?;
    batch.finish()?;
    Ok(())
}

#[cfg(test)]
thread_local! {
    pub(super) static FAIL_REF_SYNC: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

#[cfg(all(test, target_vendor = "apple"))]
mod sync_tests;
#[cfg(test)]
mod tests;
