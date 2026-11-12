use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExactEdit {
    pub old_text: String,
    pub new_text: String,
}

pub fn apply_exact_edits(source: &str, edits: &[ExactEdit]) -> Result<String> {
    if edits.is_empty() || edits.len() > 100 {
        return Err(ContentError::InvalidBase);
    }
    let mut ranges = Vec::new();
    for edit in edits {
        if edit.old_text.is_empty() {
            return Err(ContentError::InvalidBase);
        }
        // Include overlapping matches, unlike str::match_indices.
        let matches: Vec<_> = source
            .char_indices()
            .filter_map(|(i, _)| source[i..].starts_with(&edit.old_text).then_some(i))
            .take(2)
            .collect();
        if matches.len() != 1 {
            return Err(ContentError::InvalidBase);
        }
        ranges.push((matches[0], matches[0] + edit.old_text.len(), &edit.new_text));
    }
    ranges.sort_by_key(|range| range.0);
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err(ContentError::InvalidBase);
    }
    let mut result = source.to_owned();
    for (start, end, replacement) in ranges.into_iter().rev() {
        result.replace_range(start..end, replacement);
    }
    Ok(result)
}

impl ContentStore {
    pub fn agent_read_source(&self, path: &str) -> Result<TextVersion> {
        let (dir, name) = self.parent(path)?;
        text_version(read_file_bounded(&dir, &name, 1_048_576)?.0)
    }

    pub fn agent_write(
        &mut self,
        path: &str,
        expected: Option<&str>,
        text: &str,
    ) -> Result<SaveOutcome> {
        if text.len() > 1_048_576 {
            return Err(io::Error::other("native.files.read.tooLarge").into());
        }
        if self.drafts()?.iter().any(|draft| draft.path == path) {
            return Err(ContentError::Busy);
        }
        let Some(expected) = expected else {
            return self.create_text(path, text);
        };
        let (dir, name) = self.parent(path)?;
        let (bytes, identity) = read_file_bounded(&dir, &name, 1_048_576)?;
        let before = text_version(bytes)?;
        if before.revision != expected {
            return Err(ContentError::InvalidBase);
        }
        self.persist_draft(&Draft {
            path: path.into(),
            base: Some(before.clone()),
            text: text.into(),
        })?;
        self.record_external_changes()?;
        self.replace_checked(path, &before, &identity, text, "native.history.editFile")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn edit(old: &str, new: &str) -> ExactEdit {
        ExactEdit {
            old_text: old.into(),
            new_text: new.into(),
        }
    }
    #[test]
    fn exact_replacements_use_original_and_reject_ambiguity() {
        assert_eq!(
            apply_exact_edits("one two", &[edit("one", "two"), edit("two", "three")]).unwrap(),
            "two three"
        );
        for (source, edits) in [
            ("aaa", vec![edit("aa", "x")]),
            ("abc", vec![edit("z", "x")]),
            ("abc", vec![edit("ab", "x"), edit("bc", "y")]),
            ("abc", vec![edit("", "x")]),
        ] {
            assert!(apply_exact_edits(source, &edits).is_err());
        }
    }
    #[test]
    fn oversized_mutations_do_not_create_files_or_drafts() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join(".situate")).unwrap();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let text = "x".repeat(1_048_577);
        assert!(store.agent_write("large.md", None, &text).is_err());
        assert!(!temp.path().join("large.md").exists());
        assert!(store.drafts().unwrap().is_empty());
    }
    #[test]
    fn failures_before_and_after_target_write_preserve_recovery() {
        for external in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            std::fs::create_dir(temp.path().join(".situate")).unwrap();
            std::fs::write(temp.path().join("note.md"), "original").unwrap();
            let mut store = ContentStore::open(temp.path()).unwrap();
            if external {
                std::fs::write(temp.path().join("note.md"), "external").unwrap();
            }
            let before = store.read_text("note.md").unwrap();
            let head = store.repo.head().unwrap().name().unwrap().to_owned();
            let lock = temp
                .path()
                .join(".situate/history.git")
                .join(format!("{head}.lock"));
            if external {
                std::fs::create_dir_all(lock.parent().unwrap()).unwrap();
                std::fs::write(&lock, "locked").unwrap();
            } else {
                super::super::git_storage::FAIL_REF_SYNC.set(Some(1));
            }
            let outcome = store.agent_write("note.md", Some(&before.revision), "agent text");
            if external {
                assert!(outcome.is_err());
                assert_eq!(
                    std::fs::read_to_string(temp.path().join("note.md")).unwrap(),
                    "external"
                );
            } else {
                assert!(matches!(
                    outcome.unwrap(),
                    SaveOutcome::SavedHistoryFailed { .. }
                ));
                assert_eq!(
                    std::fs::read_to_string(temp.path().join("note.md")).unwrap(),
                    "agent text"
                );
            }
            assert_eq!(store.drafts().unwrap()[0].text, "agent text");
            if external {
                std::fs::remove_file(lock).unwrap();
            }
            drop(store);
            assert_eq!(
                ContentStore::open(temp.path()).unwrap().drafts().unwrap()[0].text,
                "agent text"
            );
        }
    }
    #[test]
    fn versioned_write_preserves_drafts_and_rejects_stale_source() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join(".situate")).unwrap();
        let mut store = ContentStore::open(temp.path()).unwrap();
        store.agent_write("a.md", None, "one two").unwrap();
        let before = store.read_text("a.md").unwrap();
        let next = apply_exact_edits(&before.text, &[edit("two", "three")]).unwrap();
        assert!(matches!(
            store
                .agent_write("a.md", Some(&before.revision), &next)
                .unwrap(),
            SaveOutcome::Saved { .. }
        ));
        let after = store.read_text("a.md").unwrap();
        assert_eq!(after.text, "one three");
        assert_ne!(before.revision, after.revision);
        assert!(
            store
                .agent_write("a.md", Some(&before.revision), "lost")
                .is_err()
        );
        store
            .persist_draft(&Draft {
                path: "a.md".into(),
                base: Some(after.clone()),
                text: "typing".into(),
            })
            .unwrap();
        assert!(
            store
                .agent_write("a.md", Some(&after.revision), "lost")
                .is_err()
        );
        assert_eq!(store.drafts().unwrap()[0].text, "typing");
        assert_eq!(
            std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
            after.text
        );
        drop(store);
        let reopened = ContentStore::open(temp.path()).unwrap();
        let history = reopened.file_history("a.md").unwrap();
        assert_eq!(
            reopened
                .read_revision("a.md", &history[0].revision)
                .unwrap(),
            b"one three"
        );
        assert!(history.iter().any(|entry| {
            reopened
                .read_revision("a.md", &entry.revision)
                .ok()
                .as_deref()
                == Some(b"one two")
        }));
    }
}
