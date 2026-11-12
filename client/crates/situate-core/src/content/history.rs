use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeletedEntry {
    pub path: String,
    pub revision: String,
    pub is_directory: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RevisionChangeStatus {
    #[serde(rename = "A")]
    Added,
    #[serde(rename = "M")]
    Modified,
    #[serde(rename = "D")]
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevisionChange {
    pub path: String,
    pub status: RevisionChangeStatus,
}

impl ContentStore {
    /// Compares recorded file trees without reading blobs or inferring renames or authorship.
    pub fn changes_between_revisions(
        &self,
        before: &str,
        after: &str,
    ) -> Result<Vec<RevisionChange>> {
        for revision in [before, after] {
            if revision.len() != 40
                || !revision
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(ContentError::InvalidBase);
            }
        }
        let before = self.validated_revision(before)?;
        let after = self.validated_revision(after)?;
        let mut options = git2::DiffOptions::new();
        options.skip_binary_check(true);
        let diff = self.repo.diff_tree_to_tree(
            Some(&before.tree()?),
            Some(&after.tree()?),
            Some(&mut options),
        )?;
        let mut changes = Vec::new();
        for delta in diff.deltas() {
            let status = match delta.status() {
                git2::Delta::Added => RevisionChangeStatus::Added,
                git2::Delta::Modified => RevisionChangeStatus::Modified,
                git2::Delta::Deleted => RevisionChangeStatus::Deleted,
                _ => return Err(ContentError::InvalidPath),
            };
            let file = if status == RevisionChangeStatus::Deleted {
                delta.old_file()
            } else {
                delta.new_file()
            };
            let path = file
                .path()
                .and_then(|p| p.to_str())
                .ok_or(ContentError::InvalidPath)?;
            if path != WORKING_METHOD_PATH
                && path
                    .split('/')
                    .any(|name| paths::technical(name) || crate::ignored_files::is_ignored(name))
            {
                continue;
            }
            validate_path(path)?;
            if path.len() > 4096 || path.split('/').count() > 64 {
                return Err(ContentError::InvalidPath);
            }
            for file in [delta.old_file(), delta.new_file()] {
                if !matches!(
                    file.mode(),
                    git2::FileMode::Unreadable
                        | git2::FileMode::Blob
                        | git2::FileMode::BlobExecutable
                ) {
                    return Err(ContentError::InvalidPath);
                }
            }
            changes.push(RevisionChange {
                path: path.into(),
                status,
            });
        }
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(changes)
    }

    /// Rejects an oversized blob before materializing its contents.
    pub fn read_revision_bounded(&self, path: &str, revision: &str, limit: u64) -> Result<Vec<u8>> {
        validate_path(path)?;
        let tree = self.validated_revision(revision)?.tree()?;
        let entry = tree.get_path(Path::new(path))?;
        let (size, kind) = self.repo.odb()?.read_header(entry.id())?;
        if kind != git2::ObjectType::Blob || size as u64 > limit {
            return Err(ContentError::History(
                "native.content.history.unavailable".into(),
            ));
        }
        Ok(self.repo.find_blob(entry.id())?.content().to_vec())
    }

    pub fn list_revision(&self, revision: &str) -> Result<Vec<ContentEntry>> {
        let tree = self.validated_revision(revision)?.tree()?;
        let mut entries = Vec::new();
        tree_entries(&tree, &self.repo, "", &mut entries)?;
        Ok(entries)
    }

    pub fn read_file_revision(&self, path: &str, revision: &str) -> Result<Vec<u8>> {
        let historical = self.resolved_revision_path(path, revision)?;
        self.read_revision(&historical, revision)
    }

    pub fn file_history(&self, path: &str) -> Result<Vec<HistoryEntry>> {
        self.history_for_path(path, None)
    }

    pub fn historical_file_history(&self, path: &str, revision: &str) -> Result<Vec<HistoryEntry>> {
        self.validated_revision(revision)?
            .tree()?
            .get_path(Path::new(path))?;
        self.history_for_path(path, Some(revision))
    }

    fn history_for_path(&self, path: &str, revision: Option<&str>) -> Result<Vec<HistoryEntry>> {
        validate_path(path)?;
        let mut remaining = 100_000;
        let commits = self.validated_history_with_budget(&mut remaining)?;
        let anchor = match revision {
            Some(revision) => commits
                .iter()
                .position(|entry| entry.commit.id().to_string() == revision)
                .ok_or(ContentError::InvalidReview)?,
            None => 0,
        };
        let state =
            |index: usize, path: &str, remaining: &mut usize| -> Result<Option<(String, Oid)>> {
                *remaining = remaining
                    .checked_sub(path.split('/').count())
                    .ok_or_else(history_records::invalid)?;
                match commits[index].commit.tree()?.get_path(Path::new(path)) {
                    Ok(entry) if matches!(entry.filemode(), 0o100644 | 0o100755 | 0o040000) => {
                        Ok(Some((path.to_owned(), entry.id())))
                    }
                    Ok(_) => Err(ContentError::InvalidPath),
                    Err(error) if error.code() == git2::ErrorCode::NotFound => Ok(None),
                    Err(error) => Err(error.into()),
                }
            };
        let check_boundary = |index: usize, path: &str| -> Result<()> {
            if let history_records::Fact::Boundary { operation, .. } = &commits[index].fact
                && operation.affects(path)
                && !index
                    .checked_sub(1)
                    .is_some_and(|newer| commits[newer].operation.is_some())
            {
                return Err(ContentError::History(
                    "native.content.reference.moveUncertain".into(),
                ));
            }
            Ok(())
        };
        let mut states = Vec::new();
        let mut selected_path = path.to_owned();
        for index in (0..anchor).rev() {
            check_boundary(index, &selected_path)?;
            if let Some(history_records::Operation::Move {
                source,
                destination,
            }) = &commits[index].operation
                && history_records::below(&selected_path, source)
            {
                selected_path = format!("{destination}{}", &selected_path[source.len()..]);
            }
            let current = state(index, &selected_path, &mut remaining)?;
            let deleted = current.is_none();
            states.push((index, current));
            if deleted {
                break;
            }
        }
        states.reverse();
        selected_path = path.to_owned();
        let mut found = false;
        for (index, entry) in commits.iter().enumerate().skip(anchor) {
            check_boundary(index, &selected_path)?;
            let current = state(index, &selected_path, &mut remaining)?;
            let absent = current.is_none();
            states.push((index, current));
            if absent && found {
                break;
            }
            found |= !absent;
            if let Some(history_records::Operation::Move {
                source,
                destination,
            }) = &entry.operation
                && history_records::below(&selected_path, destination)
            {
                selected_path = format!("{source}{}", &selected_path[destination.len()..]);
            }
        }
        let mut result = Vec::new();
        for (position, (index, current)) in states.iter().enumerate() {
            let entry = &commits[*index];
            if matches!(entry.fact, history_records::Fact::Boundary { .. }) {
                continue;
            }
            let previous = states
                .get(position + 1)
                .and_then(|(_, state)| state.as_ref());
            if current.as_ref() != previous {
                result.push(HistoryEntry {
                    deleted: current.is_none(),
                    path: current.as_ref().or(previous).map(|(path, _)| path.clone()),
                    revision: entry.commit.id().to_string(),
                    message: history_records::summary(&entry.commit)?,
                    timestamp: entry.commit.time().seconds(),
                });
            }
        }
        Ok(result)
    }

    pub fn deleted_files(&self) -> Result<Vec<DeletedEntry>> {
        let current = self.list()?;
        let current_paths: std::collections::HashSet<_> =
            current.iter().map(|entry| entry.path.as_str()).collect();
        let mut remaining = 100_000;
        let commits = self.validated_history_with_budget(&mut remaining)?;
        let mut seen = std::collections::HashSet::new();
        let mut deleted = Vec::new();
        for (index, commit) in commits.iter().enumerate() {
            let tree = commit.commit.tree()?;
            let entries = if index == 0 {
                let image = lineage::tree_image(&self.repo, tree.id())?;
                remaining = remaining
                    .checked_sub(image.len())
                    .ok_or_else(history_records::invalid)?;
                image
                    .into_iter()
                    .map(|(path, entry)| ContentEntry {
                        path,
                        is_directory: entry.is_none(),
                    })
                    .collect()
            } else {
                tree_facts::changed_old_entries(
                    &self.repo,
                    tree.id(),
                    commits[index - 1].commit.tree_id(),
                    &mut remaining,
                )?
            };
            for entry in entries {
                if entry.path == ".situate" {
                    continue;
                }
                if index == 0 {
                    if current_paths.contains(entry.path.as_str()) {
                        continue;
                    }
                } else {
                    let newer = &commits[index - 1];
                    if matches!(&newer.operation, Some(history_records::Operation::Move { source, .. })
                        if history_records::below(&entry.path, source))
                    {
                        continue;
                    }
                    match newer.commit.tree()?.get_path(Path::new(&entry.path)) {
                        Ok(_) => continue,
                        Err(error) if error.code() == git2::ErrorCode::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                if !seen.insert(entry.path.clone()) {
                    continue;
                }
                let revision = if matches!(commit.fact, history_records::Fact::Boundary { .. }) {
                    commit.commit.parent_id(0)?
                } else {
                    commit.commit.id()
                };
                deleted.push(DeletedEntry {
                    path: entry.path,
                    revision: revision.to_string(),
                    is_directory: entry.is_directory,
                });
            }
        }
        Ok(deleted)
    }

    /// An explicit restoration of pending editor text after external deletion.
    /// It never replaces a newly occupied path and keeps failed recovery text.
    pub fn restore_draft(
        &mut self,
        path: &str,
        base: &TextVersion,
        text: &str,
    ) -> Result<SaveOutcome> {
        if version(&base.text)?.revision != base.revision {
            return Err(ContentError::InvalidBase);
        }
        let (parent, name) = self.parent(path)?;
        require_absent(&parent, &name, "native.content.restore.occupied")?;
        if is_markdown(path) && crate::metadata::requires_identity_confirmation(&base.text, text) {
            return Err(ContentError::InvalidReview);
        }
        let metadata = crate::metadata::inspect(if is_markdown(path) { &base.text } else { "" });
        let identities: std::collections::HashSet<_> =
            metadata.tasks.into_iter().map(|task| task.id).collect();
        for entry in self.list()? {
            if identities.is_empty() || entry.is_directory || !is_markdown(&entry.path) {
                continue;
            }
            let current = self.read_text(&entry.path)?;
            let metadata = crate::metadata::inspect(&current.text);
            if metadata
                .tasks
                .iter()
                .any(|task| identities.contains(&task.id))
            {
                return Err(ContentError::InvalidReview);
            }
        }
        // Do not let an unrelated request replace retained recovery text.
        if let Some(retained) = self.drafts()?.into_iter().find(|draft| draft.path == path)
            && (retained.base.as_ref() != Some(base) || retained.text != text)
        {
            return Err(ContentError::InvalidReview);
        }
        self.stage_draft(&Draft {
            path: path.into(),
            base: Some(base.clone()),
            text: text.into(),
        })?;
        self.record_external_changes()?;
        let temp = temporary_file(&parent, text.as_bytes())?;
        let written = version(text)?;
        let identity = text_writes::pin_stage(&parent, &temp)?;
        let boundary = self.begin_text_write(path, None, text)?;
        publish_new_file(&parent, &temp, &name)?;
        self.finish_text_write(
            path,
            written,
            "native.history.restoreDraft",
            boundary,
            &identity,
            &parent,
        )
    }

    pub fn resolved_revision_path(&self, path: &str, revision: &str) -> Result<String> {
        validate_path(path)?;
        self.validated_revision(revision)?;
        let mut path = path.to_owned();
        let commits = self.validated_history()?;
        let mut found = false;
        for (index, entry) in commits.iter().enumerate() {
            let present = match entry.commit.tree()?.get_path(Path::new(&path)) {
                Ok(_) => true,
                Err(error) if error.code() == git2::ErrorCode::NotFound => false,
                Err(error) => return Err(error.into()),
            };
            if !present && found {
                return Err(ContentError::InvalidReview);
            }
            found |= present;
            if entry.commit.id().to_string() == revision {
                return if present {
                    Ok(path)
                } else {
                    Err(ContentError::InvalidReview)
                };
            }
            if let history_records::Fact::Boundary { operation, .. } = &entry.fact
                && operation.affects(&path)
                && !index
                    .checked_sub(1)
                    .is_some_and(|newer| commits[newer].operation.is_some())
            {
                return Err(ContentError::History(
                    "native.content.reference.moveUncertain".into(),
                ));
            }
            if let Some(history_records::Operation::Move {
                source,
                destination,
            }) = &entry.operation
                && history_records::below(&path, destination)
            {
                path = format!("{source}{}", &path[destination.len()..]);
            }
        }
        Err(ContentError::InvalidReview)
    }
}

fn tree_entries(
    tree: &git2::Tree<'_>,
    repo: &Repository,
    prefix: &str,
    output: &mut Vec<ContentEntry>,
) -> Result<()> {
    for entry in tree {
        let name = entry.name()?;
        let path = if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}/{name}")
        };
        let directory = entry.kind() == Some(git2::ObjectType::Tree);
        paths::validate_tree_path(&path, directory)?;
        output.push(ContentEntry {
            path: path.clone(),
            is_directory: directory,
        });
        if directory {
            tree_entries(&repo.find_tree(entry.id())?, repo, &path, output)?;
        }
    }
    Ok(())
}
