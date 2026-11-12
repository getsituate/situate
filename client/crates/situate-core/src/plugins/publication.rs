use super::sources::PackageRevision;
use super::*;
use std::collections::{BTreeMap, BTreeSet};

const INVALID: &str = "native.plugins.stateInvalid";
const GRAPH: &str = "native.plugins.invalidManifest";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PublicationStatus {
    Published,
    NotPublished,
    OutcomeUnknown,
    NeedsRecheck,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Publication {
    pub attempt: String,
    pub status: PublicationStatus,
}

fn filename(attempt: &str) -> Result<String, String> {
    let id = uuid::Uuid::parse_str(attempt).map_err(|_| INVALID)?;
    if id.to_string() != attempt {
        return Err(INVALID.into());
    }
    Ok(format!("plugin-publication-{attempt}.json"))
}

pub fn status(root: &Path, attempt: &str) -> Result<Publication, String> {
    let name = filename(attempt)?;
    let mut result: Option<Publication> = None;
    for (_, marker) in folder::records(root)? {
        let Some(bytes) = folder::read(&marker, &name)? else {
            continue;
        };
        let record: Publication = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        if record.attempt != attempt {
            return Err(INVALID.into());
        }
        result = Some(match result {
            Some(previous) if previous.status != record.status => Publication {
                attempt: attempt.into(),
                status: PublicationStatus::OutcomeUnknown,
            },
            _ => record,
        });
    }
    result.ok_or_else(|| INVALID.into())
}

/// Inspects retained publication evidence even when interrupted state blocks loading.
pub fn current(root: &Path) -> Result<Option<Publication>, String> {
    let store = runtime::storage(root)?.ok_or(INVALID)?;
    runtime::read_state(root, &store)?;
    let mut current = None;
    for (_, marker) in folder::records(root)? {
        let (state, _) = runtime::decode(folder::read(&marker, folder::STATE)?.as_deref())?;
        if let Some(attempt) = state.publication {
            let record = status(root, &attempt)?;
            if record.status != PublicationStatus::Published {
                return Ok(Some(record));
            }
            current = Some(record);
        }
    }
    Ok(current)
}

fn record(owners: &[(String, Dir)], publication: &Publication) -> Result<bool, String> {
    let bytes = serde_json::to_vec(publication).map_err(|_| INVALID)?;
    let mut durable = true;
    for (_, marker) in owners {
        durable &= folder::replace(marker, &filename(&publication.attempt)?, &bytes)?;
    }
    Ok(durable)
}

pub(super) fn migrate_record(
    store: &crate::ai_storage::Storage,
    marker: &Dir,
    attempt: &str,
) -> Result<(), String> {
    let name = filename(attempt)?;
    let bytes = folder::read(&store.dir, &name)?
        .or(folder::read(marker, &name)?)
        .ok_or(INVALID)?;
    let record: Publication = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
    if record.attempt != attempt {
        return Err(INVALID.into());
    }
    if !folder::replace(marker, &name, &bytes)? {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    Ok(())
}

pub(super) fn remove_legacy_records(store: &crate::ai_storage::Storage) -> Result<(), String> {
    let mut names = vec![];
    for entry in store.dir.entries().map_err(|_| INVALID)? {
        let name = entry
            .map_err(|_| INVALID)?
            .file_name()
            .into_string()
            .map_err(|_| INVALID)?;
        if let Some(attempt) = name
            .strip_prefix("plugin-publication-")
            .and_then(|s| s.strip_suffix(".json"))
        {
            filename(attempt)?;
            // Preserve even old attempt evidence inside every surviving owner.
            if let Some(inventory) =
                optional_child(&store.dir, "plugins").map_err(|e| e.to_string())?
            {
                for plugin in inventory.entries().map_err(|_| INVALID)? {
                    let id = plugin
                        .map_err(|_| INVALID)?
                        .file_name()
                        .into_string()
                        .map_err(|_| INVALID)?;
                    if id == ".git" {
                        continue;
                    }
                    let marker =
                        folder::metadata(&child(&inventory, &id).map_err(|e| e.to_string())?)?;
                    if folder::read(&marker, "credential-migration")?.is_some() {
                        migrate_record(store, &marker, attempt)?;
                    }
                }
            }
            names.push(name);
        }
    }
    for name in names {
        store.dir.remove_file(name).map_err(|_| INVALID)?;
    }
    crate::durable_storage::sync_directory(&store.dir)
        .map_err(|_| "native.plugins.stateOutcomeUnknown".into())
}

fn revisions(packages: &[PackageRevision]) -> Result<BTreeMap<String, String>, String> {
    if packages.len() > MAX_PACKAGES {
        return Err(PluginError::TooLarge.to_string());
    }
    let mut result = BTreeMap::new();
    for package in packages {
        if !valid_id(&package.plugin_id)
            || !sources::valid_revision(&package.revision)
            || result
                .insert(package.plugin_id.clone(), package.revision.clone())
                .is_some()
        {
            return Err(INVALID.into());
        }
    }
    Ok(result)
}

fn bindings(
    packages: &[PackageRevision],
) -> Result<BTreeMap<String, (String, Option<String>)>, String> {
    revisions(packages)?;
    Ok(packages
        .iter()
        .map(|p| {
            (
                p.plugin_id.clone(),
                (p.revision.clone(), p.incarnation.clone()),
            )
        })
        .collect())
}

fn closure(
    root: &Path,
    selected: &[PackageRevision],
    state: &runtime::State,
) -> Result<Vec<PackageRevision>, String> {
    let selected_map = revisions(selected)?;
    if selected_map.is_empty() {
        return Err(INVALID.into());
    }
    let mut prospective = BTreeMap::new();
    let mut dependencies = BTreeMap::new();
    for plugin in state.plugins.iter().filter(|p| p.enabled) {
        if selected_map.contains_key(&plugin.id) {
            continue;
        }
        let (revision, source) = match &plugin.revision {
            Some(revision) => {
                // An unreadable pinned graph may hide a previously running consumer.
                let source = sources::at_revision(
                    root,
                    &PackageRevision {
                        incarnation: None,
                        plugin_id: plugin.id.clone(),
                        revision: revision.clone(),
                    },
                )?;
                (revision.clone(), source)
            }
            None => {
                // Unavailable legacy source has never been admitted to the runtime.
                // Do not initialize or observe its history while checking another package.
                if super::validate(root, &plugin.id).is_err() {
                    continue;
                }
                let Ok(captured) = sources::snapshot(root, &plugin.id) else {
                    continue;
                };
                let Ok(source) = sources::at_revision(root, &captured) else {
                    continue;
                };
                (captured.revision, source)
            }
        };
        dependencies.insert(
            plugin.id.clone(),
            source.manifest.dependencies.unwrap_or_default(),
        );
        prospective.insert(plugin.id.clone(), revision);
    }
    for (id, revision) in &selected_map {
        let source = sources::at_revision(
            root,
            &PackageRevision {
                incarnation: None,
                plugin_id: id.clone(),
                revision: revision.clone(),
            },
        )?;
        dependencies.insert(id.clone(), source.manifest.dependencies.unwrap_or_default());
        prospective.insert(id.clone(), revision.clone());
    }
    if prospective.len() > MAX_PACKAGES {
        return Err(PluginError::TooLarge.to_string());
    }
    fn visit(
        id: &str,
        graph: &BTreeMap<String, Vec<String>>,
        visiting: &mut BTreeSet<String>,
        complete: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if complete.contains(id) {
            return Ok(());
        }
        if !visiting.insert(id.into()) {
            return Err(GRAPH.into());
        }
        for dependency in graph
            .get(id)
            .ok_or("native.plugins.dependencyUnavailable")?
        {
            visit(dependency, graph, visiting, complete)?;
        }
        visiting.remove(id);
        complete.insert(id.into());
        Ok(())
    }
    // Only changed packages propagate compatibility checks to their active consumers.
    let mut affected: BTreeSet<_> = selected_map.keys().cloned().collect();
    loop {
        let before = affected.len();
        for (id, deps) in &dependencies {
            if deps.iter().any(|d| affected.contains(d)) {
                affected.insert(id.clone());
            }
        }
        if before == affected.len() {
            break;
        }
    }
    let mut complete = BTreeSet::new();
    for id in &affected {
        visit(id, &dependencies, &mut BTreeSet::new(), &mut complete)?;
    }
    complete
        .into_iter()
        .map(|plugin_id| {
            Ok(PackageRevision {
                incarnation: Some(folder::incarnation(root, &plugin_id)?),
                revision: prospective[&plugin_id].clone(),
                plugin_id,
            })
        })
        .collect::<Result<Vec<_>, String>>()
}

/// Returns selected revisions, their required active dependencies, and affected active
/// consumers with their dependencies. Editable, unactivated dependency code is never selected.
/// Runnable legacy sources without a pinned commit are captured first. Unavailable
/// unpinned packages cannot supply dependencies; unreadable pinned graphs fail closed.
/// The caller checks the returned immutable bytes before publication.
pub fn checked_closure(
    root: &Path,
    selected: &[PackageRevision],
) -> Result<Vec<PackageRevision>, String> {
    let store = runtime::storage(root)?.ok_or(INVALID)?;
    let _lock = store
        .lock_named("plugin-state.lock")
        .map_err(|_| "native.plugins.stateBusy")?;
    closure(root, selected, &runtime::retained(root)?.0)
}

/// The caller holds the workspace authorization/action-drain lease and supplies trusted
/// receipt revisions, never untrusted claims of successful JavaScript checks. Restoration
/// is explicit per selected package. Interrupted switches are inspected, never replayed.
pub fn publish(
    root: &Path,
    selected: &[PackageRevision],
    checked: &[PackageRevision],
    restore: &[String],
) -> Result<Publication, String> {
    for package in selected.iter().chain(checked) {
        if package.incarnation.as_deref()
            != Some(folder::incarnation(root, &package.plugin_id)?.as_str())
        {
            return Err("native.plugins.stateConflict".into());
        }
    }
    let selected_map = revisions(selected)?;
    let checked_map = revisions(checked)?;
    let mut restores = BTreeSet::new();
    for id in restore {
        if !selected_map.contains_key(id) || !restores.insert(id) {
            return Err(INVALID.into());
        }
    }
    let store = runtime::storage(root)?.ok_or(INVALID)?;
    let _lock = store
        .lock_named("plugin-state.lock")
        .map_err(|_| "native.plugins.stateBusy")?;
    let (mut state, _) = runtime::retained(root)?;
    let evidence = folder::records(root)?;
    let mut publication = Publication {
        attempt: uuid::Uuid::new_v4().to_string(),
        status: PublicationStatus::NotPublished,
    };
    let mut stale = false;
    for package in selected {
        if !restores.contains(&package.plugin_id)
            && sources::snapshot(root, &package.plugin_id)? != *package
        {
            stale = true;
        }
    }
    if stale || bindings(&closure(root, selected, &state)?)? != bindings(checked)? {
        publication.status = PublicationStatus::NeedsRecheck;
        if !record(&evidence, &publication)? {
            publication.status = PublicationStatus::OutcomeUnknown;
        }
        return Ok(publication);
    }
    for entry in &mut state.plugins {
        if entry.enabled
            && entry.revision.is_none()
            && let Some(revision) = checked_map.get(&entry.id)
        {
            entry.revision = Some(revision.clone());
        }
    }
    for package in selected {
        if let Some(entry) = state.plugins.iter_mut().find(|p| p.id == package.plugin_id) {
            entry.enabled = true;
            entry.revision = Some(package.revision.clone());
        } else {
            state.plugins.push(runtime::EnabledState {
                id: package.plugin_id.clone(),
                enabled: true,
                incarnation: Some(folder::incarnation(root, &package.plugin_id)?),
                revision: Some(package.revision.clone()),
            });
        }
    }
    if state.plugins.len() > MAX_PACKAGES {
        return Err(PluginError::TooLarge.to_string());
    }
    state.publication = Some(publication.attempt.clone());
    publication.status = PublicationStatus::OutcomeUnknown;
    // Prepared evidence precedes every state write so interrupted groups fail closed.
    if !record(&evidence, &publication)? {
        return Ok(publication);
    }
    // External source edits are not covered by the state lock. Reobserve immediately
    // before switching; these are sequential observations, not a filesystem transaction.
    let mut stale =
        bindings(&closure(root, selected, &runtime::retained(root)?.0)?)? != bindings(checked)?;
    for package in selected {
        if !restores.contains(&package.plugin_id)
            && sources::snapshot(root, &package.plugin_id)? != *package
        {
            stale = true;
        }
    }
    if stale {
        publication.status = PublicationStatus::NeedsRecheck;
        if !matches!(record(&evidence, &publication), Ok(true)) {
            publication.status = PublicationStatus::OutcomeUnknown;
        }
        return Ok(publication);
    }
    #[cfg(test)]
    if tests::fail_at("before-switch").is_err() {
        publication.status = PublicationStatus::NotPublished;
        record(&evidence, &publication)?;
        return Ok(publication);
    }
    match runtime::save_state(root, &store, &mut state) {
        Ok(_) => (),
        Err(error) if error == "native.plugins.stateOutcomeUnknown" => return Ok(publication),
        Err(_) => {
            publication.status = PublicationStatus::NotPublished;
            if !matches!(record(&evidence, &publication), Ok(true)) {
                publication.status = PublicationStatus::OutcomeUnknown;
            }
            return Ok(publication);
        }
    }
    #[cfg(test)]
    if tests::fail_at("after-switch").is_err() {
        return Ok(publication);
    }
    publication.status = PublicationStatus::Published;
    if !matches!(record(&evidence, &publication), Ok(true)) {
        publication.status = PublicationStatus::OutcomeUnknown;
    }
    Ok(publication)
}

#[cfg(test)]
pub(super) fn inject_failure(point: &'static str) {
    tests::inject_failure(point);
}

#[cfg(test)]
pub(super) fn fail_at(point: &str) -> io::Result<()> {
    tests::fail_at(point)
}

#[cfg(test)]
#[path = "publication_tests.rs"]
mod tests;
