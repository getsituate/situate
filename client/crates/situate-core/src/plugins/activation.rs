use super::*;
use crate::durable_storage::sync_directory;
use sha1collisiondetection::Sha1CD;
use std::io::Write;

#[derive(Debug)]
pub enum ActivationError {
    Draft(drafts::DraftError),
    Changed,
    State(String),
    /// No automatic retry or repair is safe; artifacts remain under this plugin directory.
    OutcomeUnknown {
        plugin_id: String,
        attempt: String,
    },
}

impl fmt::Display for ActivationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Draft(error) => error.fmt(f),
            Self::Changed => f.write_str("native.plugins.stateConflict"),
            Self::State(error) => f.write_str(error),
            Self::OutcomeUnknown { .. } => f.write_str("native.plugins.stateOutcomeUnknown"),
        }
    }
}
impl std::error::Error for ActivationError {}

impl From<drafts::DraftError> for ActivationError {
    fn from(error: drafts::DraftError) -> Self {
        Self::Draft(error)
    }
}
impl From<PluginError> for ActivationError {
    fn from(error: PluginError) -> Self {
        Self::Draft(error.into())
    }
}
impl From<io::Error> for ActivationError {
    fn from(error: io::Error) -> Self {
        Self::Draft(error.into())
    }
}
type Result<T> = std::result::Result<T, ActivationError>;

#[derive(Debug)]
pub struct CodeEntry {
    pub path: String,
    /// None denotes a directory; Some includes binary assets and empty files.
    pub bytes: Option<Vec<u8>>,
}

#[derive(Debug)]
pub struct CodeSnapshot {
    info: drafts::DraftInfo,
    sources: runtime::Sources,
    digest: String,
    entries: Vec<CodeEntry>,
}

impl CodeSnapshot {
    pub fn info(&self) -> &drafts::DraftInfo {
        &self.info
    }
    pub fn manifest(&self) -> &PluginManifest {
        &self.sources.manifest
    }
    pub fn sources(&self) -> Result<runtime::Sources> {
        Ok(runtime::Sources {
            manifest: self.sources.manifest.clone(),
            service_entry: self.sources.service_entry.clone(),
            ui_entry: self.sources.ui_entry.clone(),
            modules: self.sources.modules.clone(),
            skills: self
                .sources
                .skills
                .iter()
                .map(|skill| runtime::Skill {
                    path: skill.path.clone(),
                    text: skill.text.clone(),
                })
                .collect(),
        })
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    pub fn entries(&self) -> &[CodeEntry] {
        &self.entries
    }
}

/// Captures bounded code bytes without execution. The host must check these bytes,
/// not reread mutable draft paths. The digest excludes history, config and data.
pub fn snapshot(root: &Path, draft_id: &str) -> Result<CodeSnapshot> {
    let (dir, info) = drafts::existing(root, draft_id)?;
    let code = child(&dir, "code")?;
    let files = drafts::entries(&code)?;
    drafts::bounded_size(&code, &files)?;
    let mut entries = Vec::new();
    let mut remaining = drafts::MAX_BYTES;
    let mut hash = Sha1CD::default();
    hash.update(b"situate-plugin-code-v1\0");
    hash.update(info.plugin_id.as_bytes());
    hash.update(
        folder::incarnation(root, &info.plugin_id)
            .map_err(ActivationError::State)?
            .as_bytes(),
    );
    hash.update([0]);
    for file in files {
        let bytes = if file.is_directory {
            None
        } else {
            let limit = MAX_TEXT.min(remaining);
            let mut bytes = Vec::new();
            source_file(&code, &file.path)?
                .take(limit + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() as u64 > limit {
                return Err(PluginError::TooLarge.into());
            }
            remaining -= bytes.len() as u64;
            Some(bytes)
        };
        hash.update([u8::from(bytes.is_some())]);
        hash.update((file.path.len() as u64).to_be_bytes());
        hash.update(file.path.as_bytes());
        if let Some(bytes) = &bytes {
            hash.update((bytes.len() as u64).to_be_bytes());
            hash.update(bytes);
        }
        entries.push(CodeEntry {
            path: file.path,
            bytes,
        });
    }
    let read = |path: &str, limit: u64| {
        let bytes = entries
            .iter()
            .find(|entry| entry.path == path)
            .and_then(|entry| entry.bytes.as_ref())
            .ok_or(PluginError::ReadFailed)?;
        if bytes.len() as u64 > limit {
            return Err(PluginError::TooLarge);
        }
        String::from_utf8(bytes.clone()).map_err(|_| PluginError::ReadFailed)
    };
    let manifest = validate_sources(&info.plugin_id, read)?;
    let sources = runtime::collect_sources(
        manifest,
        entries
            .iter()
            .filter(|entry| entry.bytes.is_some())
            .map(|entry| entry.path.as_str()),
        read,
    )?;
    let digest = hash
        .finalize_cd()
        .map_err(|_| PluginError::ReadFailed)?
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(CodeSnapshot {
        info,
        sources,
        digest,
        entries,
    })
}

const MAX_ARTIFACTS: usize = 8;

#[derive(Debug, PartialEq, Eq)]
pub struct Publication {
    /// Publication and enabling succeeded; backup cleanup could not be confirmed durable.
    pub cleanup_pending: bool,
}

fn artifact_capacity(plugin: &Dir) -> Result<()> {
    let mut artifacts = 0;
    for (index, entry) in plugin.entries()?.enumerate() {
        if index >= MAX_FILES {
            return Err(PluginError::TooLarge.into());
        }
        let name = entry?.file_name();
        let name = name.to_str().ok_or(PluginError::InvalidPath)?;
        if name.starts_with("activation-") {
            artifacts += 1;
            // Reserve both names without removing evidence from earlier attempts.
            if artifacts > MAX_ARTIFACTS - 2 {
                return Err(PluginError::TooLarge.into());
            }
        }
    }
    Ok(())
}

fn cleanup(plugin: &Dir, name: &str) -> io::Result<()> {
    #[cfg(test)]
    tests::fail_at("cleanup")?;
    plugin.remove_dir_all(name)?;
    #[cfg(test)]
    tests::fail_at("cleanup-sync")?;
    sync_directory(plugin)
}

/// Caller must hold the full workspace authorization lease and supply the digest
/// from its successful host-check receipt, never from an untrusted activation request.
/// Ordinary failures restore old code; uncertain durable outcomes retain artifacts.
/// This does not authorize execution or establish that any host checks passed.
pub fn publish(root: &Path, draft_id: &str, expected_digest: &str) -> Result<Publication> {
    let captured = snapshot(root, draft_id)?;
    if captured.digest != expected_digest {
        return Err(ActivationError::Changed);
    }
    let state = runtime::list(root).map_err(ActivationError::State)?;
    if captured
        .manifest()
        .dependencies
        .as_ref()
        .is_some_and(|dependencies| !dependencies.is_empty())
        || state.plugins.iter().any(|plugin| {
            plugin.enabled
                && plugin
                    .manifest
                    .as_ref()
                    .and_then(|manifest| manifest.dependencies.as_ref())
                    .is_some_and(|dependencies| dependencies.contains(&captured.info.plugin_id))
        })
    {
        // A single-draft receipt cannot establish compatibility for a dependency group.
        return Err(ActivationError::Changed);
    }
    runtime::with_pinned_source(root, &captured.info.plugin_id, || Ok(()))
        .map_err(ActivationError::State)?;
    let state = runtime::list(root).map_err(ActivationError::State)?;
    let marker = drafts::ensure_child(&drafts::workspace(root)?, ".situate")?;
    let inventory = drafts::ensure_child(&marker, "plugins")?;
    if optional_child(&inventory, &captured.info.plugin_id)?.is_none()
        && inventory.entries()?.count() >= MAX_PACKAGES
    {
        return Err(PluginError::TooLarge.into());
    }
    let plugin = child(&inventory, &captured.info.plugin_id)?;
    artifact_capacity(&plugin)?;
    let old = optional_child(&plugin, "code")?.is_some();
    let plugin_path = root.join(".situate/plugins").join(&captured.info.plugin_id);
    let history_path = plugin_path.join(".situate");
    if let Some(marker) = optional_child(&plugin, ".situate")? {
        // Missing history in an existing store is damage, not a fresh installation.
        child(&marker, "history.git")?;
    } else if old {
        drafts::ensure_child(&plugin, ".situate")?;
    }
    let mut history = if old {
        Some(
            crate::content::ContentStore::open_with_history(
                &plugin_path.join("code"),
                &history_path,
            )
            .map_err(|e| ActivationError::State(e.to_string()))?,
        )
    } else {
        None
    };
    let attempt = format!("activation-{draft_id}-{}", uuid::Uuid::new_v4());
    let stage_name = format!("{attempt}-staged");
    let backup_name = format!("{attempt}-backup");
    let unknown = || ActivationError::OutcomeUnknown {
        plugin_id: captured.info.plugin_id.clone(),
        attempt: attempt.clone(),
    };
    plugin.create_dir(&stage_name)?;
    let preflight = (|| -> Result<()> {
        sync_directory(&plugin)?;
        let staged = child(&plugin, &stage_name)?;
        for entry in &captured.entries {
            let (parent, name) = drafts::parent_dir(&staged, &entry.path)?;
            if let Some(bytes) = &entry.bytes {
                let mut options = OpenOptions::new();
                options
                    .write(true)
                    .create_new(true)
                    .follow(FollowSymlinks::No);
                let mut file = parent.open_with(&name, &options)?;
                file.write_all(bytes)?;
                file.sync_all()?;
            } else {
                parent.create_dir(&name)?;
            }
            sync_directory(&parent)?;
        }
        sync_directory(&staged)?;
        validate_code(&staged, &captured.info.plugin_id)?;
        if snapshot(root, draft_id)?.digest != expected_digest {
            return Err(ActivationError::Changed);
        }
        #[cfg(test)]
        tests::fail_at("preflight")?;
        Ok(())
    })();
    if let Err(error) = preflight {
        let _ = cleanup(&plugin, &stage_name);
        return Err(error);
    }
    if old {
        if let Err(error) = plugin.rename("code", &plugin, &backup_name) {
            let _ = cleanup(&plugin, &stage_name);
            return Err(error.into());
        }
        #[cfg(test)]
        if tests::fail_at("backup-sync").is_err() {
            return Err(unknown());
        }
        sync_directory(&plugin).map_err(|_| unknown())?;
    }
    if let Err(error) = plugin.rename(&stage_name, &plugin, "code") {
        if old {
            plugin
                .rename(&backup_name, &plugin, "code")
                .map_err(|_| unknown())?;
            sync_directory(&plugin).map_err(|_| unknown())?;
        }
        let _ = cleanup(&plugin, &stage_name);
        return Err(error.into());
    }
    sync_directory(&plugin).map_err(|_| unknown())?;
    #[cfg(test)]
    tests::fail_at("history").map_err(|_| unknown())?;
    let revision = if let Some(history) = &mut history {
        history
            .record_directory_replacement(&plugin_path.join("code"))
            .map_err(|_| unknown())?
    } else {
        drafts::ensure_child(&plugin, ".situate").map_err(|_| unknown())?;
        let mut history = crate::content::ContentStore::open_with_history(
            &plugin_path.join("code"),
            &history_path,
        )
        .map_err(|_| unknown())?;
        history.record_external_changes().map_err(|_| unknown())?
    };
    drop(history);
    let enable = (|| {
        let expected_revision = if state
            .plugins
            .iter()
            .any(|p| p.id == captured.info.plugin_id)
        {
            state.revision.clone()
        } else {
            // Publishing the first manifest adds the installation to the inventory.
            let mut current = runtime::list(root)?;
            let index = current
                .plugins
                .iter()
                .position(|p| p.id == captured.info.plugin_id)
                .ok_or("native.plugins.stateConflict")?;
            let added = current.plugins.remove(index);
            if added.enabled
                || added.error.is_some()
                || added.revision.is_some()
                || serde_json::to_value(&current.plugins)
                    .map_err(|_| "native.plugins.stateInvalid")?
                    != serde_json::to_value(&state.plugins)
                        .map_err(|_| "native.plugins.stateInvalid")?
            {
                return Err("native.plugins.stateConflict".into());
            }
            current.revision
        };
        runtime::set_enabled_revision(
            root,
            &captured.info.plugin_id,
            true,
            expected_revision.as_deref(),
            Some(&revision),
        )
    })();
    if let Err(error) = enable {
        if error == "native.plugins.stateOutcomeUnknown" {
            return Err(unknown());
        }
        plugin
            .rename("code", &plugin, &stage_name)
            .map_err(|_| unknown())?;
        if old {
            plugin
                .rename(&backup_name, &plugin, "code")
                .map_err(|_| unknown())?;
        }
        sync_directory(&plugin).map_err(|_| unknown())?;
        let _ = cleanup(&plugin, &stage_name);
        return Err(ActivationError::State(error));
    }
    Ok(Publication {
        cleanup_pending: old && cleanup(&plugin, &backup_name).is_err(),
    })
}

#[cfg(test)]
#[path = "activation_tests.rs"]
mod tests;
