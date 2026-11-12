use super::history_records::{Operation, below, invalid};
use super::*;
use std::collections::BTreeMap;

type TreeEdits = BTreeMap<String, Option<(Oid, i32)>>;
pub(super) const MAX_TREE_BYTES: usize = 8 * 1024 * 1024;

fn entry(repo: &Repository, mut tree: Oid, path: &str) -> Result<Option<(Oid, i32)>> {
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        if repo.odb()?.read_header(tree)?.0 > MAX_TREE_BYTES {
            return Err(invalid());
        }
        let current = repo.find_tree(tree)?;
        let Some(entry) = current.get_name(part) else {
            return Ok(None);
        };
        if !matches!(entry.filemode(), 0o100644 | 0o100755 | 0o040000) {
            return Err(invalid());
        }
        if parts.peek().is_none() {
            return Ok(Some((entry.id(), entry.filemode())));
        }
        if entry.filemode() != 0o040000 {
            return Ok(None);
        }
        tree = entry.id();
    }
    Err(invalid())
}

pub(super) fn validate_operation_tree(
    repo: &Repository,
    before: Oid,
    after: Oid,
    operation: &Operation,
    patches: &[String],
    remaining: &mut usize,
) -> Result<()> {
    let mut edits = TreeEdits::new();
    match operation {
        Operation::Write { path } => {
            let previous = entry(repo, before, path)?;
            let written = entry(repo, after, path)?.ok_or_else(invalid)?;
            if previous
                .is_some_and(|(_, mode)| !matches!(mode, 0o100644 | 0o100755) || mode != written.1)
                || !matches!(written.1, 0o100644 | 0o100755)
                || previous == Some(written)
            {
                return Err(invalid());
            }
            edits.insert(path.clone(), Some(written));
        }
        Operation::Move {
            source,
            destination,
        } => {
            let selected = entry(repo, before, source)?.ok_or_else(invalid)?;
            if entry(repo, before, destination)?.is_some() || entry(repo, after, source)?.is_some()
            {
                return Err(invalid());
            }
            edits.insert(source.clone(), None);
            edits.insert(destination.clone(), Some(selected));
        }
        Operation::Delete { source } => {
            if entry(repo, before, source)?.is_none() || entry(repo, after, source)?.is_some() {
                return Err(invalid());
            }
            edits.insert(source.clone(), None);
        }
        Operation::CreateBatch { destinations } => {
            for destination in destinations {
                if entry(repo, before, destination)?.is_some() {
                    return Err(invalid());
                }
                let created = entry(repo, after, destination)?.ok_or_else(invalid)?;
                if !matches!(created.1, 0o100644 | 0o100755) {
                    return Err(invalid());
                }
                edits.insert(destination.clone(), Some(created));
            }
        }
        Operation::Create { destination } => {
            if entry(repo, before, destination)?.is_some() {
                return Err(invalid());
            }
            edits.insert(
                destination.clone(),
                Some(entry(repo, after, destination)?.ok_or_else(invalid)?),
            );
        }
    }
    for path in patches {
        let Operation::Move {
            source,
            destination,
        } = operation
        else {
            return Err(invalid());
        };
        let old_path = if below(path, destination) {
            format!("{source}{}", &path[destination.len()..])
        } else {
            path.clone()
        };
        if below(path, source) || !is_markdown(path) {
            return Err(invalid());
        }
        let (_, old_mode) = entry(repo, before, &old_path)?.ok_or_else(invalid)?;
        let (id, mode) = entry(repo, after, path)?.ok_or_else(invalid)?;
        if !matches!(mode, 0o100644 | 0o100755) || mode != old_mode {
            return Err(invalid());
        }
        edits.insert(path.clone(), Some((id, mode)));
    }
    if rewritten_tree_id(repo, before, &edits, remaining, 0)? != after {
        return Err(invalid());
    }
    Ok(())
}

// Hash the exact planned tree without publishing objects from a read path. Only
// ancestors of edited paths are expanded; unchanged subtrees retain their OIDs.
fn rewritten_tree_id(
    repo: &Repository,
    tree: Oid,
    edits: &TreeEdits,
    remaining: &mut usize,
    depth: usize,
) -> Result<Oid> {
    if depth > 64 {
        return Err(invalid());
    }
    *remaining = remaining.checked_sub(edits.len() + 1).ok_or_else(invalid)?;
    if repo.odb()?.read_header(tree)?.0 > MAX_TREE_BYTES {
        return Err(invalid());
    }
    let tree = repo.find_tree(tree)?;
    if tree.len() > 10_000 {
        return Err(invalid());
    }
    let mut entries = BTreeMap::new();
    for item in &tree {
        entries.insert(item.name()?.to_owned(), (item.id(), item.filemode()));
    }
    let mut children: BTreeMap<String, TreeEdits> = BTreeMap::new();
    for (path, replacement) in edits {
        if let Some((name, rest)) = path.split_once('/') {
            children
                .entry(name.into())
                .or_default()
                .insert(rest.into(), *replacement);
        } else if let Some(replacement) = replacement {
            entries.insert(path.clone(), *replacement);
        } else {
            entries.remove(path);
        }
    }
    for (name, edits) in children {
        let (id, mode) = entries.get(&name).copied().ok_or_else(invalid)?;
        if mode != 0o040000 {
            return Err(invalid());
        }
        entries.insert(
            name,
            (
                rewritten_tree_id(repo, id, &edits, remaining, depth + 1)?,
                mode,
            ),
        );
    }
    let mut sorted = Vec::with_capacity(entries.len());
    for (name, (id, mode)) in entries {
        let mut order = name.as_bytes().to_vec();
        if mode == 0o040000 {
            order.push(b'/');
        }
        sorted.push((order, name, id, mode));
    }
    sorted.sort_by(|left, right| left.0.cmp(&right.0));
    let mut bytes = Vec::new();
    for (_, name, id, mode) in sorted {
        if bytes.len() + name.len() + 32 > MAX_TREE_BYTES {
            return Err(invalid());
        }
        bytes.extend_from_slice(format!("{mode:o} {name}\0").as_bytes());
        bytes.extend_from_slice(id.as_bytes());
    }
    Ok(Oid::hash_object(git2::ObjectType::Tree, &bytes)?)
}

pub(super) fn changed_old_entries(
    repo: &Repository,
    older: Oid,
    newer: Oid,
    remaining: &mut usize,
) -> Result<Vec<ContentEntry>> {
    fn removed(
        repo: &Repository,
        id: Oid,
        path: &str,
        directory: bool,
        output: &mut Vec<ContentEntry>,
        remaining: &mut usize,
        depth: usize,
    ) -> Result<()> {
        if depth > 64 {
            return Err(invalid());
        }
        *remaining = remaining.checked_sub(1).ok_or_else(invalid)?;
        output.push(ContentEntry {
            path: path.into(),
            is_directory: directory,
        });
        if directory {
            if repo.odb()?.read_header(id)?.0 > MAX_TREE_BYTES {
                return Err(invalid());
            }
            for entry in &repo.find_tree(id)? {
                let name = entry.name()?;
                if path.len() + name.len() + 1 > 4096 {
                    return Err(invalid());
                }
                let child = format!("{path}/{name}");
                paths::validate_tree_path(&child, entry.filemode() == 0o040000)?;
                if !matches!(entry.filemode(), 0o100644 | 0o100755 | 0o040000) {
                    return Err(invalid());
                }
                removed(
                    repo,
                    entry.id(),
                    &child,
                    entry.filemode() == 0o040000,
                    output,
                    remaining,
                    depth + 1,
                )?;
            }
        }
        Ok(())
    }
    fn visit(
        repo: &Repository,
        older: Oid,
        newer: Oid,
        prefix: &str,
        output: &mut Vec<ContentEntry>,
        remaining: &mut usize,
        depth: usize,
    ) -> Result<()> {
        if older == newer {
            return Ok(());
        }
        if depth > 64
            || repo.odb()?.read_header(older)?.0 > MAX_TREE_BYTES
            || repo.odb()?.read_header(newer)?.0 > MAX_TREE_BYTES
        {
            return Err(invalid());
        }
        *remaining = remaining.checked_sub(1).ok_or_else(invalid)?;
        let old = repo.find_tree(older)?;
        let new = repo.find_tree(newer)?;
        for item in &old {
            let name = item.name()?;
            if prefix.len() + name.len() + 1 > 4096 {
                return Err(invalid());
            }
            let path = if prefix.is_empty() {
                name.into()
            } else {
                format!("{prefix}/{name}")
            };
            paths::validate_tree_path(&path, item.filemode() == 0o040000)?;
            let next = new.get_name(name);
            if next
                .as_ref()
                .is_some_and(|next| next.id() == item.id() && next.filemode() == item.filemode())
            {
                continue;
            }
            if !matches!(item.filemode(), 0o100644 | 0o100755 | 0o040000) {
                return Err(invalid());
            }
            if item.filemode() == 0o040000
                && next
                    .as_ref()
                    .is_some_and(|next| next.filemode() == 0o040000)
            {
                visit(
                    repo,
                    item.id(),
                    next.unwrap().id(),
                    &path,
                    output,
                    remaining,
                    depth + 1,
                )?;
            } else {
                removed(
                    repo,
                    item.id(),
                    &path,
                    item.filemode() == 0o040000,
                    output,
                    remaining,
                    depth + 1,
                )?;
            }
        }
        Ok(())
    }
    let mut output = Vec::new();
    visit(repo, older, newer, "", &mut output, remaining, 0)?;
    Ok(output)
}
