use super::*;
use crate::ai_storage::Storage;
use sha1collisiondetection::Sha1CD;

pub(super) const FILE: &str = "plugin-state.json";
const MAX_STATE: u64 = 64 * 1024;
const INVALID: &str = "native.plugins.stateInvalid";
const CONFLICT: &str = "native.plugins.stateConflict";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct State {
    pub(super) version: u32,
    pub(super) generation: String,
    pub(super) plugins: Vec<EnabledState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) publication: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EnabledState {
    pub(super) id: String,
    pub(super) enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) incarnation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) revision: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub id: String,
    pub enabled: bool,
    pub manifest: Option<PluginManifest>,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub incarnation: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Listing {
    pub plugins: Vec<Summary>,
    pub revision: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Skill {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    pub manifest: PluginManifest,
    pub service_entry: Option<String>,
    pub ui_entry: Option<String>,
    pub modules: std::collections::BTreeMap<String, String>,
    pub skills: Vec<Skill>,
}

pub(super) fn storage(root: &Path) -> Result<Option<Storage>, String> {
    let parent = Dir::open_ambient_dir(root.parent().ok_or(INVALID)?, ambient_authority())
        .map_err(|_| INVALID)?;
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(INVALID)?;
    let dir = child(&parent, name).map_err(|e| e.to_string())?;
    if optional_child(&dir, ".situate")
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Ok(None);
    }
    Storage::open(root, "")
        .map(Some)
        .map_err(|_| INVALID.into())
}

fn read_legacy(storage: &Storage) -> Result<Option<Vec<u8>>, String> {
    match storage.dir.symlink_metadata(FILE) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {}
        Ok(_) => return Err(INVALID.into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(INVALID.into()),
    }
    storage
        .read_named(FILE, MAX_STATE)
        .map_err(|_| INVALID.into())
}

struct LocalState {
    incarnation: String,
    bytes: Option<Vec<u8>>,
    state: State,
}

struct Snapshot {
    bytes: Option<Vec<u8>>,
    plugins: std::collections::BTreeMap<String, Result<LocalState, String>>,
}

fn local_state(root: &Path, id: &str) -> Result<LocalState, String> {
    let incarnation = folder::incarnation(root, id)?;
    let marker = folder::metadata(&folder::plugin(root, id)?)?;
    let bytes = folder::read(&marker, folder::STATE)?;
    let (state, _) = decode(bytes.as_deref())?;
    if bytes.is_some()
        && (state.plugins.len() != 1
            || state.plugins[0].id != id
            || state.plugins[0].incarnation.as_deref() != Some(incarnation.as_str()))
    {
        return Err(INVALID.into());
    }
    Ok(LocalState {
        incarnation,
        bytes,
        state,
    })
}

pub(super) fn read_state(root: &Path, store: &Storage) -> Result<Option<Vec<u8>>, String> {
    let snapshot = read_snapshot(root, store)?;
    for local in snapshot.plugins.values() {
        if let Err(error) = local {
            return Err(error.clone());
        }
    }
    Ok(snapshot.bytes)
}

fn read_snapshot(root: &Path, store: &Storage) -> Result<Snapshot, String> {
    if read_legacy(store)?.is_some() {
        let _migration = store
            .lock_named("plugin-migration.lock")
            .map_err(|_| "native.plugins.stateBusy")?;
        // Re-read after admission: a completed migration must never be replayed.
        if let Some(bytes) = read_legacy(store)? {
            let (legacy, _) = decode(Some(&bytes))?;
            let mut ambiguous = false;
            for entry in &legacy.plugins {
                let Some(inventory) = inventory(root).map_err(|e| e.to_string())? else {
                    continue;
                };
                let Some(plugin) =
                    optional_child(&inventory, &entry.id).map_err(|e| e.to_string())?
                else {
                    continue;
                };
                let marker = folder::metadata(&plugin)?;
                if folder::read(&marker, "fresh-installation")?.is_some()
                    && folder::read(&marker, "credential-migration")?.is_none()
                {
                    continue;
                }
                let already_migrating = folder::read(&marker, "credential-migration")?.is_some();
                let historical_owner = entry.revision.as_ref().is_some_and(|revision| {
                    sources::at_revision(
                        root,
                        &sources::PackageRevision {
                            plugin_id: entry.id.clone(),
                            revision: revision.clone(),
                            incarnation: None,
                        },
                    )
                    .is_ok()
                });
                if !already_migrating && !historical_owner {
                    ambiguous = true;
                    continue;
                }
                folder::incarnation(root, &entry.id)?;
                if folder::read(&marker, "credential-migration")?.is_none() {
                    save_result(folder::replace(&marker, "credential-migration", b"pending"))?;
                }
                if folder::read(&marker, folder::STATE)?.is_none() {
                    if let Some(attempt) = &legacy.publication {
                        publication::migrate_record(store, &marker, attempt)?;
                    }
                    let local = State {
                        version: 1,
                        generation: legacy.generation.clone(),
                        plugins: vec![EnabledState {
                            incarnation: Some(folder::incarnation(root, &entry.id)?),
                            ..entry.clone()
                        }],
                        publication: legacy.publication.clone(),
                    };
                    save_result(folder::replace(
                        &marker,
                        folder::STATE,
                        &serde_json::to_vec(&local).map_err(|_| INVALID)?,
                    ))?;
                }
                let local = folder::read(&marker, folder::STATE)?.ok_or(INVALID)?;
                let (local, _) = decode(Some(&local))?;
                if local.plugins.len() != 1
                    || local.plugins[0].id != entry.id
                    || local.plugins[0].enabled != entry.enabled
                    || local.plugins[0].revision != entry.revision
                    || local.publication != legacy.publication
                {
                    return Err(INVALID.into());
                }
                if let Some(attempt) = &local.publication {
                    publication::migrate_record(store, &marker, attempt)?;
                }
                folder::sync_metadata(&marker)?;
                crate::durable_storage::sync_directory(&plugin)
                    .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
                crate::durable_storage::sync_directory(&inventory)
                    .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
            }
            if ambiguous {
                let recovery = drafts::ensure_child(&store.dir, "plugin-metadata-legacy")
                    .map_err(|e| e.to_string())?;
                let name = format!("plugin-state-{}.json", legacy.generation);
                if let Some(existing) = folder::read(&recovery, &name)? {
                    if existing != bytes {
                        return Err(INVALID.into());
                    }
                } else {
                    save_result(folder::replace(&recovery, &name, &bytes))?;
                }
                folder::sync_metadata(&recovery)?;
                crate::durable_storage::sync_directory(&store.dir)
                    .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
                archive_legacy_artifacts(store)?;
            }
            publication::remove_legacy_records(store)?;
            store.dir.remove_file(FILE).map_err(|_| INVALID)?;
            crate::durable_storage::sync_directory(&store.dir)
                .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
        }
    }
    archive_legacy_artifacts(store)?;
    let plugins: std::collections::BTreeMap<_, _> = folder::owners(root)?
        .into_iter()
        .map(|id| {
            let local = local_state(root, &id);
            (id, local)
        })
        .collect();
    let mut state = decode(None)?.0;
    let mut hash = Sha1CD::default();
    for (id, local) in &plugins {
        hash.update(id.as_bytes());
        if let Ok(local) = local {
            hash.update(local.incarnation.as_bytes());
        }
    }
    for (id, local) in &plugins {
        if let Ok(local) = local
            && let Some(bytes) = &local.bytes
        {
            hash.update(id.as_bytes());
            hash.update(bytes);
            state.plugins.extend(local.state.plugins.clone());
        }
    }
    let bytes = if plugins.is_empty() {
        None
    } else {
        let digest = hash.finalize_cd().map_err(|_| INVALID)?;
        let mut generation = [0; 16];
        generation.copy_from_slice(&digest[..16]);
        state.generation = uuid::Uuid::from_bytes(generation).to_string();
        Some(serde_json::to_vec(&state).map_err(|_| INVALID)?)
    };
    Ok(Snapshot { bytes, plugins })
}

fn archive_legacy_artifacts(store: &Storage) -> Result<(), String> {
    let mut names = vec![];
    for entry in store.dir.entries().map_err(|_| INVALID)? {
        let name = entry
            .map_err(|_| INVALID)?
            .file_name()
            .into_string()
            .map_err(|_| INVALID)?;
        let attempt = name
            .strip_prefix("plugin-publication-")
            .and_then(|value| {
                value
                    .strip_suffix(".json")
                    .or_else(|| value.strip_suffix(".tmp"))
            })
            .or_else(|| {
                name.strip_prefix("plugin-state-")
                    .and_then(|value| value.strip_suffix(".tmp"))
            });
        if attempt.is_some_and(|id| uuid::Uuid::parse_str(id).is_ok()) {
            if names.len() == MAX_FILES {
                return Err(PluginError::TooLarge.to_string());
            }
            let metadata = store.dir.symlink_metadata(&name).map_err(|_| INVALID)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(INVALID.into());
            }
            names.push(name);
        }
    }
    if names.is_empty() {
        return Ok(());
    }
    let recovery =
        drafts::ensure_child(&store.dir, "plugin-metadata-legacy").map_err(|e| e.to_string())?;
    for name in names {
        crate::durable_storage::rename_noreplace(&store.dir, &name, &recovery, &name)
            .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
    }
    folder::sync_metadata(&recovery)?;
    crate::durable_storage::sync_directory(&store.dir)
        .map_err(|_| "native.plugins.stateOutcomeUnknown".into())
}

pub(super) fn decode(bytes: Option<&[u8]>) -> Result<(State, Option<String>), String> {
    let Some(bytes) = bytes else {
        return Ok((
            State {
                version: 1,
                generation: uuid::Uuid::new_v4().to_string(),
                plugins: vec![],
                publication: None,
            },
            None,
        ));
    };
    let state: State = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    let mut ids = HashSet::new();
    if state.version != 1
        || uuid::Uuid::parse_str(&state.generation).is_err()
        || state.plugins.len() > MAX_PACKAGES
        || state.plugins.iter().any(|p| {
            !valid_id(&p.id)
                || !ids.insert(&p.id)
                || p.revision
                    .as_deref()
                    .is_some_and(|r| !sources::valid_revision(r))
        })
        || state
            .publication
            .as_deref()
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
    {
        return Err(INVALID.into());
    }
    let mut hash = Sha1CD::default();
    hash.update(bytes);
    let revision = hash
        .finalize_cd()
        .map_err(|_| INVALID)?
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((state, Some(revision)))
}

pub(super) fn retained(root: &Path) -> Result<(State, Option<String>), String> {
    let bytes = storage(root)?
        .map(|store| read_state(root, &store))
        .transpose()?
        .flatten();
    let (state, revision) = decode(bytes.as_deref())?;
    for id in folder::owners(root)? {
        let local = local_state(root, &id)?;
        if let Some(attempt) = local.state.publication
            && publication::status(root, &attempt)?.status
                != publication::PublicationStatus::Published
        {
            return Err("native.plugins.stateOutcomeUnknown".into());
        }
    }
    Ok((state, revision))
}

fn has_pending_publication(root: &Path, snapshot: &Snapshot) -> bool {
    snapshot
        .plugins
        .values()
        .filter_map(|local| local.as_ref().ok())
        .filter_map(|local| local.state.publication.as_ref())
        .any(|attempt| {
            publication::status(root, attempt)
                .is_ok_and(|record| record.status != publication::PublicationStatus::Published)
        })
}

pub fn list(root: &Path) -> Result<Listing, String> {
    let packages = super::list(root).map_err(|error| error.to_string())?;
    let snapshot = storage(root).and_then(|store| match store {
        Some(store) => read_snapshot(root, &store),
        None => Ok(Snapshot {
            bytes: None,
            plugins: Default::default(),
        }),
    });
    let revision = snapshot
        .as_ref()
        .ok()
        .map(|snapshot| decode(snapshot.bytes.as_deref()))
        .transpose()?
        .and_then(|(_, revision)| revision);
    let pending_publication = snapshot
        .as_ref()
        .ok()
        .is_some_and(|snapshot| has_pending_publication(root, snapshot));
    let plugins = packages
        .into_iter()
        .map(|package| {
            let local = snapshot
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|snapshot| {
                    snapshot
                        .plugins
                        .get(&package.id)
                        .ok_or_else(|| INVALID.to_string())?
                        .as_ref()
                        .map_err(Clone::clone)
                });
            let (incarnation, retained, state_error) = match local {
                Ok(local) => {
                    let error = local.state.publication.as_ref().and_then(|attempt| {
                        match publication::status(root, attempt) {
                            Ok(record)
                                if record.status == publication::PublicationStatus::Published =>
                            {
                                None
                            }
                            Ok(_) => Some("native.plugins.stateOutcomeUnknown".into()),
                            Err(error) => Some(error),
                        }
                    });
                    (
                        Some(local.incarnation.clone()),
                        local.state.plugins.first(),
                        error,
                    )
                }
                Err(error) => (None, None, Some(error)),
            };
            let pinned = retained.and_then(|entry| entry.revision.clone());
            let (manifest, mut error) = if let Some(revision) = &pinned {
                match sources::at_revision(
                    root,
                    &sources::PackageRevision {
                        incarnation: None,
                        plugin_id: package.id.clone(),
                        revision: revision.clone(),
                    },
                ) {
                    Ok(source) => (Some(source.manifest), None),
                    Err(error) => (None, Some(error)),
                }
            } else {
                (package.manifest, package.error)
            };
            error = state_error.or(error);
            if pending_publication {
                error = Some("native.plugins.stateOutcomeUnknown".into());
            }
            Summary {
                id: package.id,
                enabled: error.is_none() && retained.is_some_and(|entry| entry.enabled),
                manifest,
                error,
                revision: pinned,
                incarnation,
            }
        })
        .collect();
    Ok(Listing { plugins, revision })
}

/// Pins enabled legacy source before production hosts expose runtime revisions or code.
/// Failed packages remain unpinned and unavailable; healthy packages are prepared together.
/// This does not enable plugins or resume execution.
pub fn prepare(root: &Path) -> Result<Listing, String> {
    let store = match storage(root) {
        Ok(Some(store)) => store,
        Ok(None) | Err(_) => return list(root),
    };
    let _lock = store
        .lock_named("plugin-state.lock")
        .map_err(|_| "native.plugins.stateBusy")?;
    let listing = list(root)?;
    if !listing
        .plugins
        .iter()
        .any(|plugin| plugin.enabled && plugin.revision.is_none())
    {
        return Ok(listing);
    }
    let snapshot = read_snapshot(root, &store)?;
    let (mut state, _) = decode(snapshot.bytes.as_deref())?;
    state.plugins.retain(|entry| {
        listing
            .plugins
            .iter()
            .any(|plugin| plugin.id == entry.id && plugin.error.is_none())
    });
    let mut failures = Vec::new();
    let mut changed = false;
    for plugin in state
        .plugins
        .iter_mut()
        .filter(|p| p.enabled && p.revision.is_none())
    {
        let result = super::sources::snapshot(root, &plugin.id).and_then(|package| {
            super::sources::at_revision(root, &package)?;
            Ok(package.revision)
        });
        match result {
            Ok(revision) => {
                plugin.revision = Some(revision);
                changed = true;
            }
            Err(error) => failures.push((plugin.id.clone(), error)),
        }
    }
    if changed {
        save_state(root, &store, &mut state)?;
    }
    let mut listing = list(root)?;
    for (id, error) in failures {
        if let Some(plugin) = listing.plugins.iter_mut().find(|p| p.id == id) {
            plugin.manifest = None;
            plugin.enabled = false;
            plugin.error = Some(error);
        }
    }
    Ok(listing)
}

pub fn uninstall(
    root: &Path,
    id: &str,
    expected_revision: Option<&str>,
) -> Result<Option<String>, String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let store = storage(root)?.ok_or(INVALID)?;
    let _lock = store
        .lock_named("plugin-state.lock")
        .map_err(|_| "native.plugins.stateBusy")?;
    let listing = list(root)?;
    if listing.revision.as_deref() != expected_revision {
        return Err(CONFLICT.into());
    }
    let inventory = inventory(root).map_err(|e| e.to_string())?.ok_or(INVALID)?;
    let target = child(&inventory, id).map_err(|_| CONFLICT)?;
    let expected_identity = listing
        .plugins
        .iter()
        .find(|plugin| plugin.id == id)
        .and_then(|plugin| plugin.incarnation.as_deref())
        .ok_or(CONFLICT)?;
    let metadata = child(&target, ".runtime").map_err(|_| CONFLICT)?;
    if folder::read(&metadata, "identity")?.as_deref() != Some(expected_identity.as_bytes()) {
        return Err(CONFLICT.into());
    }
    for plugin in &listing.plugins {
        if plugin.id == id {
            continue;
        }
        let manifest = plugin.manifest.as_ref().ok_or("native.plugins.stateBusy")?;
        if manifest
            .dependencies
            .iter()
            .flatten()
            .any(|dependency| dependency == id)
        {
            return Err("native.plugins.stateBusy".into());
        }
    }
    drafts::validate_trial_tree(&target).map_err(|e| e.to_string())?;
    #[cfg(test)]
    publication::fail_at("uninstall-before").map_err(|_| "native.plugins.stateBusy")?;
    #[cfg(test)]
    if publication::fail_at("uninstall-partial").is_err() {
        child(&target, ".runtime")
            .map_err(|_| "native.plugins.stateOutcomeUnknown")?
            .remove_file("identity")
            .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    target
        .remove_open_dir_all()
        .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
    if optional_child(&inventory, id)
        .map_err(|_| "native.plugins.stateOutcomeUnknown")?
        .is_some()
    {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    #[cfg(test)]
    publication::fail_at("uninstall-sync").map_err(|_| "native.plugins.stateOutcomeUnknown")?;
    crate::durable_storage::sync_directory(&inventory)
        .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
    list(root)
        .map(|listing| listing.revision)
        .map_err(|_| "native.plugins.stateOutcomeUnknown".into())
}

pub fn check_enabled(root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    enabled_state(root, id).map(|_| ())
}

fn enabled_state(root: &Path, id: &str) -> Result<EnabledState, String> {
    let Some(store) = storage(root)? else {
        return Err("native.plugins.disabled".into());
    };
    let snapshot = read_snapshot(root, &store)?;
    if has_pending_publication(root, &snapshot) {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    let local = snapshot
        .plugins
        .get(id)
        .ok_or("native.plugins.disabled")?
        .as_ref()
        .map_err(Clone::clone)?;
    if let Some(attempt) = &local.state.publication
        && publication::status(root, attempt)?.status != publication::PublicationStatus::Published
    {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    local
        .state
        .plugins
        .iter()
        .find(|entry| entry.enabled)
        .cloned()
        .ok_or_else(|| "native.plugins.disabled".into())
}

pub fn load(root: &Path, id: &str) -> Result<Sources, String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let plugin = enabled_state(root, id)?;
    match &plugin.revision {
        Some(revision) => super::sources::at_revision(
            root,
            &super::sources::PackageRevision {
                incarnation: None,
                plugin_id: id.into(),
                revision: revision.clone(),
            },
        ),
        None => Err(PluginError::Unavailable.to_string()),
    }
}

fn sources(root: &Path, id: &str) -> Result<Sources, PluginError> {
    let code = code(root, id)?;
    let manifest = validate_code(&code, id)?;
    let files = drafts::entries(&code).map_err(|_| PluginError::ReadFailed)?;
    collect_sources(
        manifest,
        files
            .iter()
            .filter(|file| !file.is_directory)
            .map(|file| file.path.as_str()),
        |path, limit| read_text(&code, path, limit),
    )
}

pub(super) fn collect_sources<'a>(
    manifest: PluginManifest,
    paths: impl IntoIterator<Item = &'a str>,
    mut read: impl FnMut(&str, u64) -> Result<String, PluginError>,
) -> Result<Sources, PluginError> {
    let mut remaining = MAX_DECLARED_TEXT;
    let mut read = |path: &str| {
        let text = read(path, MAX_TEXT.min(remaining))?;
        remaining -= text.len() as u64;
        Ok::<_, PluginError>(text)
    };
    let service_entry = manifest
        .service_entry
        .as_deref()
        .map(&mut read)
        .transpose()?;
    let ui_entry = manifest.ui_entry.as_deref().map(&mut read).transpose()?;
    let mut skills = Vec::new();
    for path in &manifest.skills {
        skills.push(Skill {
            path: path.clone(),
            text: read(path)?,
        });
    }
    let mut modules = std::collections::BTreeMap::new();
    if service_entry.is_some() || ui_entry.is_some() {
        for path in paths {
            if path.to_ascii_lowercase().ends_with(".js")
                && manifest.service_entry.as_deref() != Some(path)
                && manifest.ui_entry.as_deref() != Some(path)
            {
                modules.insert(path.to_owned(), read(path)?);
            }
        }
    }
    Ok(Sources {
        manifest,
        service_entry,
        ui_entry,
        modules,
        skills,
    })
}

pub fn set_enabled(
    root: &Path,
    id: &str,
    enabled: bool,
    expected_revision: Option<&str>,
) -> Result<String, String> {
    set_enabled_revision(root, id, enabled, expected_revision, None)
}

pub(super) fn set_enabled_revision(
    root: &Path,
    id: &str,
    enabled: bool,
    expected_revision: Option<&str>,
    active_revision: Option<&str>,
) -> Result<String, String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    child(
        &inventory(root).map_err(|e| e.to_string())?.ok_or(INVALID)?,
        id,
    )
    .map_err(|e| e.to_string())?;
    let store = storage(root)?.ok_or_else(|| PluginError::Unavailable.to_string())?;
    let _lock = store
        .lock_named("plugin-state.lock")
        .map_err(|_| "native.plugins.stateBusy")?;
    let previous = read_state(root, &store)?;
    let (mut state, revision) = decode(previous.as_deref())?;
    if revision.as_deref() != expected_revision {
        return Err(CONFLICT.into());
    }
    retained(root)?;
    if enabled {
        if let Some(revision) = active_revision.or_else(|| {
            state
                .plugins
                .iter()
                .find(|p| p.id == id)
                .and_then(|p| p.revision.as_deref())
        }) {
            super::sources::at_revision(
                root,
                &super::sources::PackageRevision {
                    incarnation: None,
                    plugin_id: id.into(),
                    revision: revision.into(),
                },
            )?;
        } else {
            sources(root, id).map_err(|e| e.to_string())?;
        }
    }
    if !enabled {
        let mut consumers = Vec::new();
        for plugin in state.plugins.iter().filter(|p| p.enabled) {
            let manifest = match &plugin.revision {
                Some(revision) => super::sources::at_revision(
                    root,
                    &super::sources::PackageRevision {
                        incarnation: None,
                        plugin_id: plugin.id.clone(),
                        revision: revision.clone(),
                    },
                )
                .map(|source| source.manifest),
                None => super::validate(root, &plugin.id).map_err(|error| error.to_string()),
            };
            // An unreadable manifest establishes no dependency edges for this package.
            if let Ok(manifest) = manifest {
                consumers.push((plugin.id.clone(), manifest.dependencies.unwrap_or_default()));
            }
        }
        let mut disabled = HashSet::from([id.to_string()]);
        loop {
            let before = disabled.len();
            for (consumer, dependencies) in &consumers {
                if dependencies
                    .iter()
                    .any(|dependency| disabled.contains(dependency))
                {
                    disabled.insert(consumer.clone());
                }
            }
            if disabled.len() == before {
                break;
            }
        }
        for plugin in &mut state.plugins {
            if disabled.contains(&plugin.id) {
                plugin.enabled = false;
            }
        }
    }
    if let Some(entry) = state.plugins.iter_mut().find(|p| p.id == id) {
        entry.enabled = enabled;
        if let Some(revision) = active_revision {
            entry.revision = Some(revision.into());
        }
    } else {
        if state.plugins.len() == MAX_PACKAGES {
            return Err(PluginError::TooLarge.to_string());
        }
        state.plugins.push(EnabledState {
            id: id.into(),
            enabled,
            incarnation: Some(folder::incarnation(root, id)?),
            revision: active_revision.map(String::from),
        });
    }
    if read_state(root, &store)? != previous {
        return Err(CONFLICT.into());
    }
    save_state(root, &store, &mut state)
}

pub(super) fn save_state(
    root: &Path,
    _store: &Storage,
    state: &mut State,
) -> Result<String, String> {
    state.generation = uuid::Uuid::new_v4().to_string();
    let mut changed = false;
    for entry in &state.plugins {
        let result = (|| -> Result<(), String> {
            let plugin = folder::plugin(root, &entry.id)?;
            if entry.incarnation.as_deref() != Some(folder::incarnation(root, &entry.id)?.as_str())
            {
                return Err(CONFLICT.into());
            }
            let marker = folder::metadata(&plugin)?;
            let local = State {
                version: 1,
                generation: state.generation.clone(),
                plugins: vec![entry.clone()],
                publication: state.publication.clone(),
            };
            let bytes = serde_json::to_vec(&local).map_err(|_| INVALID)?;
            save_result(folder::replace(&marker, folder::STATE, &bytes))?;
            changed = true;
            #[cfg(test)]
            publication::fail_at("state-entry")
                .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
            Ok(())
        })();
        if let Err(error) = result {
            return Err(if changed {
                "native.plugins.stateOutcomeUnknown".into()
            } else {
                error
            });
        }
    }
    #[cfg(test)]
    if publication::fail_at("state-sync").is_err() {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    let store = storage(root)?.ok_or(INVALID)?;
    decode(read_snapshot(root, &store)?.bytes.as_deref())?
        .1
        .ok_or_else(|| INVALID.into())
}

pub(super) fn with_pinned_source<T>(
    root: &Path,
    id: &str,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if !valid_id(id) {
        return Err(PluginError::InvalidPath.to_string());
    }
    let store = storage(root)?.ok_or(INVALID)?;
    let _lock = store
        .lock_named("plugin-state.lock")
        .map_err(|_| "native.plugins.stateBusy")?;
    let (mut state, _) = retained(root)?;
    if let Some(entry) = state
        .plugins
        .iter_mut()
        .find(|p| p.id == id && p.enabled && p.revision.is_none())
    {
        entry.revision = Some(super::sources::snapshot(root, id)?.revision);
        save_state(root, &store, &mut state)?;
    }
    action()
}

fn save_result(result: Result<bool, String>) -> Result<(), String> {
    match result {
        Ok(true) => Ok(()),
        Ok(false) => Err("native.plugins.stateOutcomeUnknown".into()),
        Err(_) => Err("native.plugins.stateSaveFailed".into()),
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
