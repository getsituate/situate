use crate::appearance::Storage;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha1collisiondetection::Sha1CD;
use std::{collections::BTreeMap, path::Path, sync::LazyLock};

#[cfg(test)]
mod tests;

const FILE: &str = "keyboard-shortcuts.json";
const LOCK: &str = "keyboard-shortcuts.lock";
const INVALID: &str = "native.shortcuts.invalid";
const CHANGED: &str = "native.shortcuts.changed";
static DEFAULTS: LazyLock<BTreeMap<String, BTreeMap<String, String>>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../contracts/keyboard-shortcuts.json"))
        .expect("keyboard shortcut defaults must be valid JSON")
});

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
}
impl Platform {
    pub fn current() -> Option<Self> {
        if cfg!(target_os = "macos") {
            Some(Self::Macos)
        } else if cfg!(target_os = "windows") {
            Some(Self::Windows)
        } else {
            None
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Macos => "macos",
            Self::Windows => "windows",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub revision: Option<String>,
    pub bindings: BTreeMap<String, BTreeMap<String, Option<String>>>,
}
#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct PluginDefaults {
    pub id: String,
    pub defaults: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BindingChange {
    Set { keys: String },
    Remove,
    Restore,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    pub action: String,
    pub expected_revision: Option<String>,
    pub change: BindingChange,
    pub platform: Option<Platform>,
}

fn mapped(error: String) -> String {
    match error.as_str() {
        "native.appearance.invalid" => INVALID,
        "native.appearance.changed" => CHANGED,
        "native.appearance.busy" => "native.shortcuts.busy",
        "native.appearance.durability" => "native.shortcuts.durability",
        _ => "native.shortcuts.storage",
    }
    .into()
}
fn name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"-_.".contains(&ch))
}
fn action_id(action: &str) -> bool {
    DEFAULTS.contains_key(action)
        || action
            .split_once(':')
            .is_some_and(|(plugin, name_)| name(plugin) && name(name_))
}
fn valid_binding(keys: &str, platform: Platform) -> bool {
    let mut parts = keys.split('+').collect::<Vec<_>>();
    let Some(key) = parts.pop() else {
        return false;
    };
    let modifiers = ["Control", "Alt", "Shift", "Meta"];
    if parts.is_empty()
        || parts == ["Shift"]
        || parts.iter().any(|part| !modifiers.contains(part))
        || !parts.windows(2).all(|pair| {
            modifiers.iter().position(|m| *m == pair[0])
                < modifiers.iter().position(|m| *m == pair[1])
        })
    {
        return false;
    }
    let printable =
        key.chars().count() == 1 && key.chars().all(|c| !c.is_control() && !c.is_whitespace());
    let arrow = matches!(key, "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown");
    let known = printable
        || arrow
        || matches!(
            key,
            "Space"
                | "Plus"
                | "Tab"
                | "Enter"
                | "Backspace"
                | "Delete"
                | "Home"
                | "End"
                | "PageUp"
                | "PageDown"
        )
        || key
            .strip_prefix('F')
            .and_then(|key| key.parse::<u8>().ok())
            .is_some_and(|n| (1..=24).contains(&n));
    if !known || keys.len() > 80 || (printable && key != key.to_uppercase()) {
        return false;
    }
    match platform {
        Platform::Macos => !matches!(
            keys,
            "Meta+Q"
                | "Meta+Tab"
                | "Shift+Meta+Tab"
                | "Meta+Space"
                | "Alt+Meta+Space"
                | "Alt+Meta+Escape"
        ),
        Platform::Windows => {
            !parts.contains(&"Meta")
                && !(matches!(
                    keys,
                    "Alt+Tab" | "Alt+Shift+Tab" | "Alt+F4" | "Control+Alt+Delete"
                ))
                && !(parts.contains(&"Control") && parts.contains(&"Alt") && !arrow)
        }
    }
}

fn hash(bytes: &[u8]) -> Result<String, String> {
    let mut digest = Sha1CD::default();
    digest.update(bytes);
    Ok(digest
        .finalize_cd()
        .map_err(|_| INVALID)?
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
fn decode(bytes: Option<&[u8]>) -> Result<(Value, Snapshot), String> {
    let document: Value = match bytes {
        None => json!({"version":1,"bindings":{}}),
        Some(bytes) => crate::reference_storage_json::decode_unique(bytes).map_err(|_| INVALID)?,
    };
    if document["version"] != 1 || !document["bindings"].is_object() {
        return Err(INVALID.into());
    }
    let mut bindings = BTreeMap::new();
    for platform in [Platform::Macos, Platform::Windows] {
        let Some(values) = document["bindings"].get(platform.key()) else {
            continue;
        };
        let values = values.as_object().ok_or(INVALID)?;
        let mut recognized = BTreeMap::new();
        for (id, value) in values {
            if !action_id(id) {
                continue;
            }
            let keys = if value.is_null() {
                None
            } else {
                Some(
                    value
                        .as_str()
                        .filter(|key| valid_binding(key, platform))
                        .ok_or(INVALID)?
                        .into(),
                )
            };
            recognized.insert(id.clone(), keys);
        }
        bindings.insert(platform.key().into(), recognized);
    }
    Ok((
        document,
        Snapshot {
            revision: bytes.map(hash).transpose()?,
            bindings,
        },
    ))
}
pub fn snapshot(root: &Path) -> Result<Snapshot, String> {
    let storage = Storage::open(root).map_err(mapped)?;
    decode(storage.read_named(FILE).map_err(mapped)?.as_deref()).map(|(_, snapshot)| snapshot)
}
pub fn defaults() -> &'static BTreeMap<String, BTreeMap<String, String>> {
    &DEFAULTS
}
pub fn update(
    root: &Path,
    platform: Platform,
    request: Update,
    plugins: &[PluginDefaults],
) -> Result<Snapshot, String> {
    if !action_id(&request.action) {
        return Err(INVALID.into());
    }
    let storage = Storage::open(root).map_err(mapped)?;
    let _lock = storage.lock_named(LOCK).map_err(mapped)?;
    let original = storage.read_named(FILE).map_err(mapped)?;
    let (mut document, current) = decode(original.as_deref())?;
    if current.revision != request.expected_revision {
        return Err(CHANGED.into());
    }
    let platform_key = platform.key();
    let selections = current.bindings.get(platform_key);
    let mut claimed = std::collections::BTreeSet::new();
    for (id, defaults) in DEFAULTS.iter() {
        if let Some(key) = selections
            .and_then(|map| map.get(id))
            .map(Option::as_ref)
            .unwrap_or_else(|| defaults.get(platform_key))
        {
            claimed.insert(key.clone());
        }
    }
    for (id, keys) in selections.into_iter().flatten() {
        if id != &request.action
            && let Some(keys) = keys
        {
            claimed.insert(keys.clone());
        }
    }
    let mut plugin_bindings = BTreeMap::new();
    for plugin in plugins {
        if !plugin.id.contains(':')
            || !action_id(&plugin.id)
            || selections.is_some_and(|map| map.contains_key(&plugin.id))
        {
            continue;
        }
        if let Some(keys) = plugin
            .defaults
            .get(platform_key)
            .filter(|keys| valid_binding(keys, platform))
            && claimed.insert(keys.clone())
        {
            plugin_bindings.insert(plugin.id.clone(), keys.clone());
        }
    }
    let default = DEFAULTS
        .get(&request.action)
        .and_then(|keys| keys.get(platform_key))
        .or_else(|| {
            plugins
                .iter()
                .find(|plugin| plugin.id == request.action)
                .and_then(|plugin| plugin.defaults.get(platform_key))
                .filter(|keys| valid_binding(keys, platform))
        });
    let keys = match &request.change {
        BindingChange::Set { keys } if valid_binding(keys, platform) => Some(keys),
        BindingChange::Set { .. } => return Err(INVALID.into()),
        BindingChange::Remove => None,
        BindingChange::Restore => default,
    };
    if let Some(keys) = keys {
        let selections = current.bindings.get(platform_key);
        let ids = DEFAULTS
            .keys()
            .chain(selections.into_iter().flat_map(|map| map.keys()))
            .chain(plugin_bindings.keys());
        if ids.filter(|id| *id != &request.action).any(|id| {
            let assigned = selections
                .and_then(|map| map.get(id))
                .map(Option::as_ref)
                .unwrap_or_else(|| {
                    DEFAULTS
                        .get(id)
                        .and_then(|item| item.get(platform_key))
                        .or_else(|| plugin_bindings.get(id))
                });
            assigned == Some(keys)
        }) {
            return Err("native.shortcuts.conflict".into());
        }
    }
    let values = document["bindings"]
        .as_object_mut()
        .ok_or(INVALID)?
        .entry(platform_key)
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or(INVALID)?;
    match request.change {
        BindingChange::Set { keys } => {
            values.insert(request.action, json!(keys));
        }
        BindingChange::Remove => {
            values.insert(request.action, Value::Null);
        }
        BindingChange::Restore => {
            values.remove(&request.action);
        }
    }
    let mut updated = serde_json::to_vec_pretty(&document).map_err(|_| INVALID)?;
    updated.push(b'\n');
    storage
        .save_named(FILE, &updated, original.as_deref())
        .map_err(mapped)?;
    decode(Some(&updated)).map(|(_, snapshot)| snapshot)
}
