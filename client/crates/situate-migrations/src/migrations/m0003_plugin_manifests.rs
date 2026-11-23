use crate::{
    MigrationError, MigrationErrorKind, MigrationId, MigrationWorkspace, Result, filesystem as fs,
};
use cap_std::fs::Dir;
use serde_json::Value;

pub struct Migration;

impl crate::Migration for Migration {
    const VERSION: MigrationId = MigrationId(3);
    const MINIMUM_APP_VERSION: Option<&'static str> = None;
    const RELEASE_ASSIGNED_MINIMUM: bool = true;

    fn apply(workspace: &MigrationWorkspace<'_>) -> Result<()> {
        visit(workspace, true)
    }

    fn validate(workspace: &MigrationWorkspace<'_>) -> Result<()> {
        visit(workspace, false)
    }
}

fn invalid() -> MigrationError {
    MigrationError::new(MigrationErrorKind::InvalidMetadata)
}

fn directory(parent: &Dir, name: &str) -> Result<Option<Dir>> {
    if fs::exists(parent, name)? {
        fs::child(parent, name).map(Some)
    } else {
        Ok(None)
    }
}

fn convert(bytes: &[u8]) -> Result<Option<Vec<u8>>> {
    let mut value: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if value["schemaVersion"] == 3 {
        return Ok(None);
    }
    if value["schemaVersion"] != 2 || value["id"].as_str().is_none() {
        return Err(invalid());
    }
    value["schemaVersion"] = 3.into();
    value["kind"] = "tool".into();
    serde_json::to_vec(&value).map(Some).map_err(|_| invalid())
}

fn rewrite_code(package: &Dir, apply: bool) -> Result<()> {
    let Some(code) = directory(package, "code")? else {
        return Ok(());
    };
    if fs::exists(&code, "plugin.json")? {
        let bytes = fs::bounded_read(&code, "plugin.json", 64 * 1024)?;
        // An unfinished draft need not have a valid manifest yet.
        if let Ok(Some(converted)) = convert(&bytes) {
            if !apply {
                return Err(invalid());
            }
            fs::replace(&code, "plugin.json", &converted)?;
        }
    }
    Ok(())
}

fn rewrite_drafts(parent: &Dir, name: &str, apply: bool) -> Result<()> {
    if let Some(drafts) = directory(parent, name)? {
        for name in fs::names(&drafts)? {
            if !drafts.symlink_metadata(&name)?.is_dir() {
                continue;
            }
            rewrite_code(&fs::child(&drafts, &name)?, apply)?;
        }
    }
    Ok(())
}

fn visit(workspace: &MigrationWorkspace<'_>, apply: bool) -> Result<()> {
    if let Some(plugins) = directory(workspace.managed, "plugins")? {
        for id in fs::names(&plugins)? {
            if !plugins.symlink_metadata(&id)?.is_dir() {
                continue;
            }
            let package = fs::child(&plugins, &id)?;
            if let Some(runtime) = directory(&package, ".runtime")? {
                rewrite_state(workspace, &runtime, "runtime-state.json", Some(&id), apply)?;
            }
            rewrite_code(&package, apply)?;
            rewrite_drafts(&package, "drafts", apply)?;
        }
        rewrite_state(
            workspace,
            workspace.managed,
            "plugin-state.json",
            None,
            apply,
        )?;
    }
    rewrite_drafts(workspace.managed, "plugin-drafts", apply)
}

fn rewrite_state(
    workspace: &MigrationWorkspace<'_>,
    state_dir: &Dir,
    name: &str,
    owner: Option<&str>,
    apply: bool,
) -> Result<()> {
    if !fs::exists(state_dir, name)? {
        return Ok(());
    }
    let bytes = fs::bounded_read(state_dir, name, 64 * 1024)?;
    let mut state: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if state["version"] != 1 {
        return Err(invalid());
    }
    let plugins = state["plugins"].as_array_mut().ok_or_else(invalid)?;
    if plugins.len() > 128 || (owner.is_some() && plugins.len() != 1) {
        return Err(invalid());
    }
    let mut changed = false;
    for plugin in plugins {
        let Some(value) = plugin.get("revision").filter(|value| !value.is_null()) else {
            continue;
        };
        let revision = value.as_str().ok_or_else(invalid)?;
        let id = plugin["id"].as_str().ok_or_else(invalid)?;
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || owner.is_some_and(|owner| owner != id)
        {
            return Err(invalid());
        }
        if owner.is_none() {
            let inventory = fs::child(workspace.managed, "plugins")?;
            let Some(package) = directory(&inventory, id)? else {
                continue;
            };
            if let Some(runtime) = directory(&package, ".runtime")?
                && fs::exists(&runtime, "fresh-installation")?
                && !fs::exists(&runtime, "credential-migration")?
            {
                continue;
            }
        }
        let migrate = workspace.plugin_history.ok_or_else(invalid)?;
        let next = migrate(
            workspace.root,
            id,
            revision,
            if apply { convert } else { check_revision },
        )?;
        if next != revision {
            changed = true;
            plugin["revision"] = next.into();
        }
    }
    if changed {
        fs::replace(
            state_dir,
            name,
            &serde_json::to_vec(&state).map_err(|_| invalid())?,
        )?;
    }
    Ok(())
}

fn check_revision(bytes: &[u8]) -> Result<Option<Vec<u8>>> {
    if convert(bytes)?.is_some() {
        Err(invalid())
    } else {
        Ok(None)
    }
}
