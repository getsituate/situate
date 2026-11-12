use super::history_records::{Envelope, Fact, MAX_COMMITS, Operation, below, invalid};
use super::*;
use std::collections::BTreeMap;

const MAX_ENTRIES: usize = 10_000;
const MAX_DEPTH: usize = 64;
const MAX_METADATA: usize = 16 * 1024 * 1024;
pub(super) type TreeImage = BTreeMap<String, Option<(Oid, i32)>>;

pub(super) struct HistoryCommit<'repo> {
    pub commit: git2::Commit<'repo>,
    pub fact: Fact,
    pub operation: Option<Operation>,
}

pub(super) fn tree_image(repo: &Repository, id: Oid) -> Result<TreeImage> {
    fn visit(
        repo: &Repository,
        id: Oid,
        prefix: &str,
        depth: usize,
        image: &mut TreeImage,
    ) -> Result<()> {
        if depth > MAX_DEPTH || repo.odb()?.read_header(id)?.0 > super::tree_facts::MAX_TREE_BYTES {
            return Err(invalid());
        }
        for entry in &repo.find_tree(id)? {
            if image.len() >= MAX_ENTRIES {
                return Err(invalid());
            }
            let name = entry.name()?;
            if prefix.len() + name.len() + 1 > 4096 {
                return Err(invalid());
            }
            let path = if prefix.is_empty() {
                name.to_owned()
            } else {
                format!("{prefix}/{name}")
            };
            if path.len() > 4096 {
                return Err(invalid());
            }
            paths::validate_tree_path(&path, entry.filemode() == 0o040000)?;
            match entry.filemode() {
                0o040000 => {
                    image.insert(path.clone(), None);
                    visit(repo, entry.id(), &path, depth + 1, image)?;
                }
                0o100644 | 0o100755 => {
                    image.insert(path, Some((entry.id(), entry.filemode())));
                }
                _ => return Err(invalid()),
            }
        }
        Ok(())
    }
    let mut image = TreeImage::new();
    visit(repo, id, "", 0, &mut image)?;
    Ok(image)
}

pub(super) fn write_image(repo: &Repository, image: &TreeImage) -> Result<Oid> {
    fn write(repo: &Repository, image: &TreeImage, prefix: &str, depth: usize) -> Result<Oid> {
        if depth > MAX_DEPTH {
            return Err(invalid());
        }
        let mut builder = repo.treebuilder(None)?;
        for (path, entry) in image {
            let Some(name) = path.strip_prefix(prefix) else {
                continue;
            };
            if name.contains('/') {
                continue;
            }
            if let Some((id, mode)) = entry {
                builder.insert(name, *id, *mode)?;
            } else {
                builder.insert(
                    name,
                    write(repo, image, &format!("{path}/"), depth + 1)?,
                    0o040000,
                )?;
            }
        }
        git_storage::write_tree(repo, &mut builder)
    }
    if image.len() > MAX_ENTRIES {
        return Err(invalid());
    }
    write(repo, image, "", 0)
}

pub(super) fn apply_operation(
    before: &TreeImage,
    result: &TreeImage,
    operation: &Operation,
    patches: &[String],
) -> Result<TreeImage> {
    let mut expected = before.clone();
    match operation {
        Operation::Write { .. } => return Err(invalid()),
        Operation::Move {
            source,
            destination,
        } => {
            if !before.contains_key(source) || before.contains_key(destination) {
                return Err(invalid());
            }
            for (path, entry) in before.iter().filter(|(path, _)| below(path, source)) {
                expected.remove(path);
                expected.insert(format!("{destination}{}", &path[source.len()..]), *entry);
            }
        }
        Operation::Delete { source } => {
            if !before.contains_key(source) {
                return Err(invalid());
            }
            expected.retain(|path, _| !below(path, source));
        }
        Operation::CreateBatch { destinations } => {
            for destination in destinations {
                if before.contains_key(destination) {
                    return Err(invalid());
                }
                let Some(Some(created)) = result.get(destination) else {
                    return Err(invalid());
                };
                expected.insert(destination.clone(), Some(*created));
            }
        }
        Operation::Create { destination } => {
            if before.contains_key(destination) || !result.contains_key(destination) {
                return Err(invalid());
            }
            for (path, entry) in result.iter().filter(|(path, _)| below(path, destination)) {
                expected.insert(path.clone(), *entry);
            }
        }
    }
    for path in patches {
        if !matches!(operation, Operation::Move { .. }) || !is_markdown(path) {
            return Err(invalid());
        }
        let Some(Some((_, old_mode))) = expected.get(path) else {
            return Err(invalid());
        };
        let Some(Some((id, mode))) = result.get(path) else {
            return Err(invalid());
        };
        if mode != old_mode {
            return Err(invalid());
        }
        expected.insert(path.clone(), Some((*id, *mode)));
    }
    Ok(expected)
}

pub(super) fn completed_operation(
    repo: &Repository,
    commit: &git2::Commit<'_>,
) -> Result<Option<Operation>> {
    completed_with_budget(repo, commit, &mut 100_000)
}

fn completed_with_budget(
    repo: &Repository,
    commit: &git2::Commit<'_>,
    remaining: &mut usize,
) -> Result<Option<Operation>> {
    let record = Envelope::read(commit)?;
    let Fact::Completed { boundary } = record.fact else {
        return Ok(None);
    };
    if commit.parent_count() != 1 || commit.parent_id(0)?.to_string() != boundary {
        return Err(invalid());
    }
    let parent = commit.parent(0)?;
    let Fact::Boundary {
        operation,
        expected_tree,
        patches,
    } = Envelope::read(&parent)?.fact
    else {
        return Err(invalid());
    };
    if expected_tree != commit.tree_id().to_string() {
        return Err(invalid());
    }
    super::tree_facts::validate_operation_tree(
        repo,
        parent.tree_id(),
        commit.tree_id(),
        &operation,
        &patches,
        remaining,
    )?;
    Ok(Some(operation))
}

impl ContentStore {
    pub(super) fn admit_lineage(&self) -> Result<()> {
        if self.repo.is_shallow()
            || self.history_dir.try_exists("shallow")?
            || self.history_dir.try_exists("info/grafts")?
            || self
                .repo
                .references_glob("refs/replace/*")?
                .next()
                .is_some()
        {
            return Err(invalid());
        }
        Ok(())
    }

    pub(super) fn validated_revision(&self, revision: &str) -> Result<git2::Commit<'_>> {
        self.admit_lineage()?;
        let commit = self.repo.find_commit(Oid::from_str(revision)?)?;
        completed_operation(&self.repo, &commit)?;
        Ok(commit)
    }

    pub(super) fn validated_history(&self) -> Result<Vec<HistoryCommit<'_>>> {
        self.validated_history_with_budget(&mut 100_000)
    }

    pub(super) fn validated_history_with_budget(
        &self,
        remaining: &mut usize,
    ) -> Result<Vec<HistoryCommit<'_>>> {
        self.admit_lineage()?;
        let mut commits = Vec::new();
        let mut commit = self.repo.head()?.peel_to_commit()?;
        let mut metadata = 0usize;
        loop {
            if commits.len() >= MAX_COMMITS {
                return Err(invalid());
            }
            metadata = metadata
                .checked_add(commit.message_bytes().len())
                .ok_or_else(invalid)?;
            if metadata > MAX_METADATA {
                return Err(invalid());
            }
            let operation = completed_with_budget(&self.repo, &commit, remaining)?;
            let fact = Envelope::read(&commit)?.fact;
            let parent = if commit.parent_count() == 1 {
                Some(commit.parent(0)?)
            } else {
                None
            };
            commits.push(HistoryCommit {
                commit,
                fact,
                operation,
            });
            let Some(parent) = parent else {
                break;
            };
            commit = parent;
        }
        Ok(commits)
    }

    /// Resolves a live Git-anchored path without decoding its bytes or writing history.
    /// UUID and historical references use `resolve_reference`. A continuity gap is
    /// an error; confirmed deletion or current absence returns `None`.
    pub fn resolve_reference_path(
        &self,
        reference: &crate::conversation_runtime::ContentReference,
    ) -> Result<Option<String>> {
        use crate::conversation_runtime::ContentReference;
        if !reference.validate() {
            return Err(invalid());
        }
        let ContentReference::Live {
            path,
            anchor_revision: anchor,
            ..
        } = reference
        else {
            return Err(invalid());
        };
        self.resolve_entry_path(path, anchor, false)
    }

    pub(super) fn resolve_entry_path(
        &self,
        path: &str,
        anchor: &str,
        directory: bool,
    ) -> Result<Option<String>> {
        let mut metadata_remaining = MAX_METADATA;
        self.resolve_entry_path_with_budget(
            path,
            anchor,
            directory,
            &mut 100_000,
            &mut metadata_remaining,
        )
    }

    pub(super) fn resolve_entry_path_with_budget(
        &self,
        path: &str,
        anchor: &str,
        directory: bool,
        remaining: &mut usize,
        metadata_remaining: &mut usize,
    ) -> Result<Option<String>> {
        self.admit_lineage()?;
        validate_path(path)?;
        let supported_mode = |mode| {
            if directory {
                mode == 0o040000
            } else {
                matches!(mode, 0o100644 | 0o100755)
            }
        };
        let anchor = Oid::from_str(anchor)?;
        let mut commit = self.repo.head()?.peel_to_commit()?;
        let mut lineage = Vec::new();
        loop {
            if lineage.len() >= MAX_COMMITS {
                return Err(invalid());
            }
            *remaining = remaining.checked_sub(1).ok_or_else(invalid)?;
            *metadata_remaining = metadata_remaining
                .checked_sub(commit.message_bytes().len())
                .ok_or_else(invalid)?;
            let record = Envelope::read(&commit)?;
            if commit.id() == anchor {
                if matches!(record.fact, Fact::Boundary { .. }) {
                    return Err(invalid());
                }
                let entry = commit.tree()?.get_path(Path::new(path))?;
                if !supported_mode(entry.filemode()) {
                    return Err(invalid());
                }
                // Completed anchors must themselves carry valid completion evidence.
                completed_with_budget(&self.repo, &commit, remaining)?;
                break;
            }
            if commit.parent_count() != 1 {
                return Err(invalid());
            }
            let parent = commit.parent(0)?;
            lineage.push((commit, record));
            commit = parent;
        }
        lineage.reverse();
        let mut current = path.to_owned();
        for (index, (commit, record)) in lineage.iter().enumerate() {
            match &record.fact {
                Fact::Boundary { operation, .. } => {
                    let paired = lineage.get(index + 1).is_some_and(|(next, next_record)| {
                        matches!(&next_record.fact, Fact::Completed { boundary } if boundary == &commit.id().to_string()) && next.parent_id(0).ok() == Some(commit.id())
                    });
                    if !paired && operation.affects(&current) {
                        return Err(ContentError::History(
                            "native.content.reference.moveUncertain".into(),
                        ));
                    }
                }
                Fact::Completed { .. } => {
                    match completed_with_budget(&self.repo, commit, remaining)?
                        .ok_or_else(invalid)?
                    {
                        Operation::Move {
                            source,
                            destination,
                        } if below(&current, &source) => {
                            current = format!("{destination}{}", &current[source.len()..])
                        }
                        Operation::Delete { source } if below(&current, &source) => {
                            return Ok(None);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
            if !matches!(record.fact, Fact::Boundary { .. }) {
                match commit.tree()?.get_path(Path::new(&current)) {
                    Ok(entry) if supported_mode(entry.filemode()) => {}
                    Ok(_) => return Ok(None),
                    Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None),
                    Err(error) => return Err(error.into()),
                }
            }
        }
        let (dir, name) = match self.parent(&current) {
            Ok(parent) => parent,
            Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        match dir.symlink_metadata(name) {
            Ok(metadata)
                if !metadata.is_symlink()
                    && (if directory {
                        metadata.is_dir()
                    } else {
                        metadata.is_file()
                    }) =>
            {
                Ok(Some(current))
            }
            Ok(_) => Err(invalid()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
}
