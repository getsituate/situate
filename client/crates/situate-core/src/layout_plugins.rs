use super::{INVALID, MAX_LAYOUT_BYTES};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use serde_json::{Value, json};
use sha1collisiondetection::Sha1CD;
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::Path,
};

pub type Incarnations = BTreeMap<String, String>;

pub(super) fn child(dir: &Dir, name: &str) -> Result<Option<Dir>, String> {
    match dir.symlink_metadata(name) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => (),
        _ => return Err(INVALID.into()),
    }
    cap_primitives::fs::open_dir_nofollow(
        &dir.try_clone().map_err(|_| INVALID)?.into_std_file(),
        Path::new(name),
    )
    .map(Dir::from_std_file)
    .map(Some)
    .map_err(|_| INVALID.into())
}
pub(super) fn read(dir: &Dir, name: &str, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = match dir.open_with(name, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(INVALID.into()),
    };
    if !file.metadata().map_err(|_| INVALID)?.is_file() {
        return Err(INVALID.into());
    }
    let mut bytes = vec![];
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| INVALID)?;
    if bytes.len() as u64 > limit {
        return Err(INVALID.into());
    }
    Ok(Some(bytes))
}
fn owner(marker: &Dir, id: &str, incarnation: &str) -> Result<Option<Dir>, String> {
    if !crate::plugins::valid_id(id) || uuid::Uuid::parse_str(incarnation).is_err() {
        return Err(INVALID.into());
    }
    let Some(inventory) = child(marker, "plugins")? else {
        return Ok(None);
    };
    let Some(plugin) = child(&inventory, id)? else {
        return Ok(None);
    };
    let Some(runtime) = child(&plugin, ".runtime")? else {
        return Ok(None);
    };
    let Some(identity) = read(&runtime, "identity", 128)? else {
        return Ok(None);
    };
    let identity = std::str::from_utf8(&identity).map_err(|_| INVALID)?;
    uuid::Uuid::parse_str(identity).map_err(|_| INVALID)?;
    Ok((identity == incarnation).then_some(runtime))
}
fn plugin_id(view: &str) -> Option<&str> {
    view.split_once(':').map(|(id, _)| id)
}
fn entries(
    data: &mut Value,
    mut project: impl FnMut(&mut Value) -> Result<(), String>,
) -> Result<(), String> {
    fn tab(
        tab: &mut Value,
        project: &mut impl FnMut(&mut Value) -> Result<(), String>,
    ) -> Result<(), String> {
        if let Some(panes) = tab.get_mut("panes").and_then(Value::as_array_mut) {
            for pane in panes {
                if let Some(entries) = pane
                    .pointer_mut("/navigation/entries")
                    .and_then(Value::as_array_mut)
                {
                    for entry in entries {
                        project(entry)?;
                    }
                }
            }
        }
        Ok(())
    }
    if let Some(tabs) = data
        .pointer_mut("/layout/tabs")
        .and_then(Value::as_array_mut)
    {
        for item in tabs {
            tab(item, &mut project)?;
        }
    }
    if let Some(tabs) = data
        .pointer_mut("/layout/closedTabs")
        .and_then(Value::as_array_mut)
    {
        for item in tabs {
            tab(item.get_mut("tab").ok_or(INVALID)?, &mut project)?;
        }
    }
    Ok(())
}
fn clear(entry: &mut Value) {
    entry["target"] = json!({"kind":"empty"});
    entry["presentation"] = Value::Null;
}

pub fn has_legacy(data: &Value) -> Result<bool, String> {
    let mut legacy = data["pinnedViews"].as_array().is_some_and(|pins| {
        pins.iter()
            .any(|pin| pin.as_str().and_then(plugin_id).is_some())
    });
    entries(&mut data.clone(), |entry| {
        legacy |= entry["target"]["viewId"]
            .as_str()
            .and_then(plugin_id)
            .is_some();
        Ok(())
    })?;
    Ok(legacy)
}

pub fn write_immutable(dir: &Dir, name: &str, payload: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // Publish only complete immutable records; interrupted temporary files are never read.
    let temporary = format!("layout-record-{}.tmp", uuid::Uuid::new_v4());
    let mut file = dir.open_with(&temporary, &options).map_err(|_| INVALID)?;
    let result = file.write_all(payload).and_then(|_| file.sync_all());
    drop(file);
    let result = result.and_then(|_| dir.hard_link(&temporary, dir, name));
    let _ = dir.remove_file(&temporary);
    match result {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let mut options = OpenOptions::new();
            options
                .read(true)
                .write(cfg!(windows))
                .follow(FollowSymlinks::No);
            #[cfg(unix)]
            {
                use cap_std::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NONBLOCK);
            }
            let mut file = dir.open_with(name, &options).map_err(|_| INVALID)?;
            if !file.metadata().map_err(|_| INVALID)?.is_file() {
                return Err(INVALID.into());
            }
            let mut existing = vec![];
            (&mut file)
                .take(MAX_LAYOUT_BYTES + 1)
                .read_to_end(&mut existing)
                .map_err(|_| INVALID)?;
            if existing != payload {
                return Err(INVALID.into());
            }
            file.sync_all().map_err(|_| INVALID)?;
        }
        Err(_) => return Err(INVALID.into()),
    }
    crate::durable_storage::sync_directory(dir).map_err(|_| INVALID.into())
}

fn record_id(bytes: &[u8]) -> Result<String, String> {
    let mut hash = Sha1CD::default();
    hash.update(bytes);
    let digest = hash.finalize_cd().map_err(|_| INVALID)?;
    Ok(
        uuid::Builder::from_custom_bytes(digest[..16].try_into().map_err(|_| INVALID)?)
            .into_uuid()
            .to_string(),
    )
}

fn resolve(
    marker: &Dir,
    records: Option<&Dir>,
    target: &Value,
    remaining: &mut u64,
) -> Result<Option<Value>, String> {
    let id = target["pluginId"].as_str().ok_or(INVALID)?;
    let inc = target["incarnation"].as_str().ok_or(INVALID)?;
    let record = target["recordId"].as_str().ok_or(INVALID)?;
    let parsed = uuid::Uuid::parse_str(record).map_err(|_| INVALID)?;
    if parsed.to_string() != record {
        return Err(INVALID.into());
    }
    let Some(runtime) = owner(marker, id, inc)? else {
        return Ok(None);
    };
    let bytes = if let Some(records) = records {
        Some(read(records, &format!("plugin-{inc}-{record}.json"), *remaining)?.ok_or(INVALID)?)
    } else {
        let Some(dir) = child(&runtime, "presentation")? else {
            return Ok(None);
        };
        read(&dir, &format!("{record}.json"), *remaining)?
    };
    let Some(bytes) = bytes else { return Ok(None) };
    *remaining -= bytes.len() as u64;
    // Earlier random-ID records have no content digest; retain their readable payloads.
    if parsed.get_version() != Some(uuid::Version::Random) && record_id(&bytes)? != record {
        return Err(INVALID.into());
    }
    let payload: Value = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
    if payload["target"]["kind"] != "view"
        || payload["target"]["viewId"].as_str().and_then(plugin_id) != Some(id)
    {
        return Err(INVALID.into());
    }
    Ok(Some(payload))
}

pub(super) fn migrate_records(marker: &Dir, records: &Dir, data: &Value) -> Result<(), String> {
    let mut remaining = MAX_LAYOUT_BYTES;
    entries(&mut data.clone(), |entry| {
        let target = &entry["target"];
        if target["kind"] != "plugin" {
            return Ok(());
        }
        let id = target["pluginId"].as_str().ok_or(INVALID)?;
        let inc = target["incarnation"].as_str().ok_or(INVALID)?;
        let record = target["recordId"].as_str().ok_or(INVALID)?;
        uuid::Uuid::parse_str(record).map_err(|_| INVALID)?;
        let Some(runtime) = owner(marker, id, inc)? else {
            return Ok(());
        };
        let dir = child(&runtime, "presentation")?.ok_or(INVALID)?;
        let bytes = read(&dir, &format!("{record}.json"), remaining)?.ok_or(INVALID)?;
        remaining -= bytes.len() as u64;
        let mut budget = MAX_LAYOUT_BYTES;
        resolve(marker, None, target, &mut budget)?.ok_or(INVALID)?;
        write_immutable(records, &format!("plugin-{inc}-{record}.json"), &bytes)
    })
}

pub fn store(
    marker: &Dir,
    records: Option<&Dir>,
    data: &mut Value,
    expected: &Incarnations,
) -> Result<(), String> {
    entries(data, |entry| {
        if entry["target"]["kind"] == "plugin" {
            return Err(INVALID.into());
        }
        let Some(id) = entry["target"]["viewId"]
            .as_str()
            .and_then(plugin_id)
            .map(str::to_owned)
        else {
            return Ok(());
        };
        let Some(inc) = expected.get(&id) else {
            clear(entry);
            return Ok(());
        };
        let Some(runtime) = owner(marker, &id, inc)? else {
            clear(entry);
            return Ok(());
        };
        let payload = json!({"target":entry["target"],"presentation":entry["presentation"]});
        let bytes = serde_json::to_vec(&payload).map_err(|_| INVALID)?;
        // Reuse identical payloads; an existing record must still match byte-for-byte.
        let record = record_id(&bytes)?;
        if bytes.len() as u64 > MAX_LAYOUT_BYTES {
            return Err(INVALID.into());
        }
        if let Some(records) = records {
            write_immutable(records, &format!("plugin-{inc}-{record}.json"), &bytes)?;
        } else {
            match runtime.create_dir("presentation") {
                Ok(()) => crate::durable_storage::sync_directory(&runtime).map_err(|_| INVALID)?,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(_) => return Err(INVALID.into()),
            }
            let dir = child(&runtime, "presentation")?.ok_or(INVALID)?;
            write_immutable(&dir, &format!("{record}.json"), &bytes)?;
        }
        // A deleted owner must never be recreated by a delayed layout write.
        owner(marker, &id, inc)?.ok_or(INVALID)?;
        let reference = json!({"kind":"plugin","pluginId":id,"incarnation":inc,"recordId":record});
        entry["target"] = reference;
        entry["presentation"] = Value::Null;
        Ok(())
    })?;
    let pins = data["pinnedViews"].as_array_mut().ok_or(INVALID)?;
    let mut projected = vec![];
    for pin in pins.iter() {
        let view = pin.as_str().ok_or(INVALID)?;
        let Some(id) = plugin_id(view) else {
            projected.push(pin.clone());
            continue;
        };
        if let Some(inc) = expected.get(id)
            && owner(marker, id, inc)?.is_some()
        {
            projected.push(json!({"viewId":view,"incarnation":inc}));
        }
    }
    *pins = projected;
    Ok(())
}

fn referenced_records(
    data: &Value,
    keep: &mut std::collections::HashSet<String>,
) -> Result<(), String> {
    fn tab(tab: &Value, keep: &mut std::collections::HashSet<String>) -> Result<(), String> {
        for pane in tab["panes"].as_array().ok_or(INVALID)? {
            for entry in pane["navigation"]["entries"].as_array().ok_or(INVALID)? {
                let target = &entry["target"];
                if target["kind"] == "plugin" {
                    let incarnation = target["incarnation"].as_str().ok_or(INVALID)?;
                    let record = target["recordId"].as_str().ok_or(INVALID)?;
                    keep.insert(format!("plugin-{incarnation}-{record}.json"));
                }
            }
        }
        Ok(())
    }
    if let Some(tabs) = data.pointer("/layout/tabs") {
        for item in tabs.as_array().ok_or(INVALID)? {
            tab(item, keep)?;
        }
    }
    if let Some(tabs) = data.pointer("/layout/closedTabs") {
        for item in tabs.as_array().ok_or(INVALID)? {
            tab(&item["tab"], keep)?;
        }
    }
    Ok(())
}

pub(super) fn prune(records: &Dir, data: &Value) -> Result<(), String> {
    let mut keep = std::collections::HashSet::new();
    referenced_records(data, &mut keep)?;
    let mut candidates = vec![];
    for entry in records.entries().map_err(|_| INVALID)? {
        let entry = entry.map_err(|_| INVALID)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // Older local recovery snapshots can also retain immutable record references.
        if name.starts_with("layout-legacy-recovery-") && name.ends_with(".json") {
            let bytes = read(records, name, MAX_LAYOUT_BYTES)?.ok_or(INVALID)?;
            let recovery: super::Envelope = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
            referenced_records(&recovery.data, &mut keep)?;
        }
        let Some(stem) = name
            .strip_prefix("plugin-")
            .and_then(|name| name.strip_suffix(".json"))
        else {
            continue;
        };
        if stem.len() != 73 || !stem.is_ascii() || &stem[36..37] != "-" {
            continue;
        }
        let valid = [&stem[..36], &stem[37..]]
            .into_iter()
            .all(|id| uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id));
        if valid
            && records
                .symlink_metadata(name)
                .map_err(|_| INVALID)?
                .is_file()
        {
            candidates.push(name.to_owned());
        }
    }
    for name in candidates {
        if !keep.contains(&name) {
            records.remove_file(name).map_err(|_| INVALID)?;
        }
    }
    crate::durable_storage::sync_directory(records).map_err(|_| INVALID.into())
}

pub fn load(marker: &Dir, records: Option<&Dir>, data: &mut Value) -> Result<Incarnations, String> {
    let pins = data
        .get("pinnedViews")
        .and_then(Value::as_array)
        .ok_or(INVALID)?;
    if pins.iter().any(|pin| {
        !pin.is_string()
            && !pin.as_object().is_some_and(|object| {
                object.len() == 2
                    && pin["viewId"].as_str().and_then(plugin_id).is_some()
                    && pin["incarnation"].is_string()
            })
    }) {
        return Err(INVALID.into());
    }
    let mut incarnations = Incarnations::new();
    let mut remaining = MAX_LAYOUT_BYTES;
    entries(data, |entry| {
        if entry["target"]["kind"] == "plugin" {
            if let Some(payload) = resolve(marker, records, &entry["target"], &mut remaining)? {
                incarnations.insert(
                    entry["target"]["pluginId"]
                        .as_str()
                        .ok_or(INVALID)?
                        .to_owned(),
                    entry["target"]["incarnation"]
                        .as_str()
                        .ok_or(INVALID)?
                        .to_owned(),
                );
                entry["target"] = payload["target"].clone();
                entry["presentation"] = payload["presentation"].clone();
            } else {
                clear(entry);
            }
        } else if entry["target"]["viewId"]
            .as_str()
            .and_then(plugin_id)
            .is_some()
        {
            // Legacy state has no installation provenance; its source is archived before replacement.
            clear(entry);
        }
        Ok(())
    })?;
    let pins = data["pinnedViews"].as_array_mut().ok_or(INVALID)?;
    let mut projected = vec![];
    for pin in pins.iter() {
        if let Some(view) = pin.as_str() {
            if plugin_id(view).is_none() {
                projected.push(pin.clone());
            }
            continue;
        }
        let view = pin["viewId"].as_str().ok_or(INVALID)?;
        let id = plugin_id(view).ok_or(INVALID)?;
        let inc = pin["incarnation"].as_str().ok_or(INVALID)?;
        if owner(marker, id, inc)?.is_some() {
            incarnations.insert(id.to_owned(), inc.to_owned());
            projected.push(Value::String(view.to_owned()));
        }
    }
    *pins = projected;
    Ok(incarnations)
}
