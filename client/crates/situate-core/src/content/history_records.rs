use super::*;

const PREFIX: &str = "\n\nSituate-History: ";
pub(super) const MAX_RECORD_BYTES: usize = 64 * 1024;
pub(super) const MAX_COMMITS: usize = 10_000;
pub(super) const MAX_BATCH_PATH_BYTES: usize = 60 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Envelope {
    pub version: u8,
    pub parent_tree: Option<String>,
    pub result_tree: String,
    pub fact: Fact,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Fact {
    Observation,
    Change,
    Interrupted,
    Boundary {
        operation: Operation,
        expected_tree: String,
        patches: Vec<String>,
    },
    Completed {
        boundary: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Operation {
    Move { source: String, destination: String },
    Delete { source: String },
    Create { destination: String },
    CreateBatch { destinations: Vec<String> },
    Write { path: String },
}

pub(super) fn summary(commit: &git2::Commit<'_>) -> Result<String> {
    Envelope::read(commit)?;
    Ok(commit
        .message()?
        .split_once(PREFIX)
        .ok_or_else(invalid)?
        .0
        .into())
}

pub(super) fn invalid() -> ContentError {
    ContentError::History("native.content.reference.invalid".into())
}
fn record_path(path: &str) -> Result<()> {
    if path.len() > 4096 || path.split('/').count() > 64 {
        return Err(invalid());
    }
    validate_path(path)?;
    Ok(())
}

fn oid(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
impl Operation {
    pub fn affects(&self, path: &str) -> bool {
        match self {
            Self::Move {
                source,
                destination,
            } => below(path, source) || below(path, destination),
            Self::Delete { source } => below(path, source),
            Self::Create { destination } => below(path, destination),
            Self::CreateBatch { destinations } => destinations.iter().any(|root| below(path, root)),
            Self::Write { path: selected } => below(path, selected),
        }
    }
    fn validate(&self) -> Result<()> {
        match self {
            Self::Move {
                source,
                destination,
            } => {
                record_path(source)?;
                record_path(destination)?;
                if below(source, destination) || below(destination, source) {
                    return Err(invalid());
                }
            }
            Self::Delete { source } => {
                record_path(source)?;
            }
            Self::Create { destination } => {
                record_path(destination)?;
            }
            Self::CreateBatch { destinations } => {
                if destinations.is_empty()
                    || destinations.len() > 256
                    || serde_json::to_vec(destinations)
                        .map_err(|_| invalid())?
                        .len()
                        > MAX_BATCH_PATH_BYTES
                {
                    return Err(invalid());
                }
                let mut sorted = destinations.clone();
                sorted.sort();
                for path in &sorted {
                    record_path(path)?;
                }
                for (index, path) in sorted.iter().enumerate() {
                    if sorted[index + 1..].iter().any(|next| below(next, path)) {
                        return Err(invalid());
                    }
                }
            }
            Self::Write { path } => record_path(path)?,
        }
        Ok(())
    }
}
pub(super) fn below(path: &str, root: &str) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|tail| tail.starts_with('/'))
}
impl Envelope {
    fn validate(&self) -> Result<()> {
        if self.version != 1
            || !oid(&self.result_tree)
            || self.parent_tree.as_deref().is_some_and(|id| !oid(id))
        {
            return Err(invalid());
        }
        match &self.fact {
            Fact::Boundary {
                operation,
                expected_tree,
                patches,
            } => {
                operation.validate()?;
                if patches.len() > 1000 {
                    return Err(invalid());
                }
                let mut unique = std::collections::HashSet::new();
                for path in patches {
                    record_path(path)?;
                    if !is_markdown(path) || !unique.insert(path) {
                        return Err(invalid());
                    }
                }
                if !oid(expected_tree) || self.parent_tree.as_ref() != Some(&self.result_tree) {
                    return Err(invalid());
                }
            }
            Fact::Completed { boundary } if !oid(boundary) => return Err(invalid()),
            _ => {}
        }
        Ok(())
    }
    pub fn message(&self, summary: &str) -> Result<String> {
        self.validate()?;
        if summary.contains(PREFIX) {
            return Err(invalid());
        }
        let message = format!(
            "{summary}{PREFIX}{}",
            serde_json::to_string(self).map_err(|_| invalid())?
        );
        if message.len() > MAX_RECORD_BYTES {
            return Err(invalid());
        }
        Ok(message)
    }
    pub fn parse(message: &str) -> Result<Self> {
        if message.len() > MAX_RECORD_BYTES {
            return Err(invalid());
        }
        let (_, json) = message.split_once(PREFIX).ok_or_else(invalid)?;
        let record: Self = serde_json::from_str(json).map_err(|_| invalid())?;
        record.validate()?;
        Ok(record)
    }
    pub fn read(commit: &git2::Commit<'_>) -> Result<Self> {
        if commit.parent_count() > 1 {
            return Err(invalid());
        }
        let record = Self::parse(commit.message()?)?;
        let parent_tree = if commit.parent_count() == 1 {
            Some(commit.parent(0)?.tree_id().to_string())
        } else {
            None
        };
        if record.parent_tree != parent_tree || record.result_tree != commit.tree_id().to_string() {
            return Err(invalid());
        }
        Ok(record)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelope_rejects_unknown_versions_fields_and_noncanonical_ids() {
        let record = Envelope {
            version: 1,
            parent_tree: Some("a".repeat(40)),
            result_tree: "a".repeat(40),
            fact: Fact::Boundary {
                operation: Operation::Move {
                    source: "a.pdf".into(),
                    destination: "archive/a.pdf".into(),
                },
                expected_tree: "b".repeat(40),
                patches: Vec::new(),
            },
        };
        let message = record.message("native.history.moveContent").unwrap();
        assert_eq!(Envelope::parse(&message).unwrap(), record);
        assert!(Envelope::parse(&message.replace("\"version\":1", "\"version\":2")).is_err());
        assert!(
            Envelope::parse(&message.replace("\"version\":1", "\"extra\":true,\"version\":1"))
                .is_err()
        );
        assert!(Envelope::parse(&message.replace(&"b".repeat(40), &"B".repeat(40))).is_err());
        assert!(Envelope::parse(&message.replace("archive/a.pdf", "../a.pdf")).is_err());
        assert!(Envelope::parse("native.history.externalChanges").is_err());
    }
    #[test]
    fn boundaries_require_same_tree_and_component_paths() {
        let mut record = Envelope {
            version: 1,
            parent_tree: Some("a".repeat(40)),
            result_tree: "b".repeat(40),
            fact: Fact::Boundary {
                operation: Operation::Delete {
                    source: "folder".into(),
                },
                expected_tree: "c".repeat(40),
                patches: Vec::new(),
            },
        };
        assert!(record.message("delete").is_err());
        record.result_tree = "a".repeat(40);
        assert!(record.message("delete").is_ok());
        let operation = Operation::Delete {
            source: "folder".into(),
        };
        assert!(operation.affects("folder/a.pdf"));
        assert!(!operation.affects("folder2/a.pdf"));
    }
}
