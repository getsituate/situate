use crate::{ai_storage::Storage, conversation_store::Development};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    io::{Read, Seek, SeekFrom, Write},
};

const INVALID: &str = "native.ai.conversation.versionInvalid";
const CONFLICT: &str = "native.ai.conversation.conflict";
const STORAGE: &str = "native.ai.storage.failed";
const DURABILITY: &str = "native.ai.conversation.durability";
#[cfg(test)]
#[derive(Clone, Copy)]
enum Fault {
    WriteAfter(usize),
    HistorySync,
    MetadataSync,
    MetadataRename,
    DirectorySync,
    PartialBackupSync,
}
#[cfg(test)]
thread_local! {static FAULT:std::cell::Cell<Option<Fault>>=const {std::cell::Cell::new(None)};}
#[cfg(test)]
fn fail_if(matches: impl FnOnce(Fault) -> bool) -> Result<(), &'static str> {
    if FAULT.get().is_some_and(matches) {
        FAULT.set(None);
        Err(DURABILITY)
    } else {
        Ok(())
    }
}
fn append_lines(output: &mut impl Write, lines: &[Vec<u8>]) -> Result<(), String> {
    for line in lines {
        #[cfg(test)]
        if let Some(Fault::WriteAfter(count)) = FAULT.get() {
            FAULT.set(None);
            output
                .write_all(&line[..count.min(line.len())])
                .map_err(|_| STORAGE)?;
            return Err(STORAGE.into());
        }
        output.write_all(line).map_err(|_| STORAGE)?;
    }
    Ok(())
}
pub const ACTIVE_HISTORY_LIMIT: usize = 256;
#[cfg(test)]
#[path = "conversation_history_tests.rs"]
mod tests;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub version: u8,
    pub id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub data: Value,
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, Value>,
}
impl HistoryEntry {
    pub fn new(
        id: impl Into<String>,
        parent_id: Option<String>,
        kind: impl Into<String>,
        data: Value,
    ) -> Self {
        Self {
            version: 1,
            id: id.into(),
            parent_id,
            kind: kind.into(),
            data,
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMetadata {
    pub version: u8,
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_input: Option<String>,
    pub revision: u64,
    pub selected_entry_id: Option<String>,
    #[serde(default)]
    pub message_count: usize,
    #[serde(default)]
    pub event_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_user_message_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub development: Option<Development>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_draft: Option<Value>,
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, Value>,
}
impl ConversationMetadata {
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            version: 3,
            id: id.into(),
            title: title.into(),
            title_input: None,
            revision: 0,
            selected_entry_id: None,
            message_count: 0,
            event_count: 0,
            last_user_message_at: None,
            development: None,
            legacy_draft: None,
            extra: BTreeMap::new(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub metadata: ConversationMetadata,
    pub entries: Vec<HistoryEntry>,
    pub next_before: Option<String>,
    pub message_offset: usize,
    pub event_offset: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationContext {
    pub metadata: ConversationMetadata,
    pub entries: Vec<HistoryEntry>,
    pub compaction: Option<HistoryEntry>,
    pub message_offset: usize,
    pub event_offset: usize,
    pub truncated: bool,
    pub next_before: Option<String>,
    pub active_entries: Vec<HistoryEntry>,
}

#[path = "conversation_history_index.rs"]
mod index;
pub(crate) use index::HistoryIndex;
#[path = "conversation_history_reader.rs"]
mod reader;
pub use reader::{ConversationHistoryReader, HistoryReadEntry};

fn cached_index<'a>(
    cache: &'a mut HashMap<String, HistoryIndex>,
    id: &str,
    dir: &Dir,
    scope: &str,
) -> Result<&'a mut HistoryIndex, String> {
    if !cache.contains_key(id)
        && cache.len() >= 8
        && let Some(old) = cache.keys().next().cloned()
    {
        cache.remove(&old);
    }
    let index = cache.entry(id.into()).or_default();
    index.bind(dir, scope)?;
    Ok(index)
}

pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_')
    {
        return Err("native.ai.conversation.invalidId".into());
    }
    Ok(())
}
fn entry_identity(id: &str) -> bool {
    crate::conversation_runtime::identity(id)
}
fn open_dir(parent: &Dir, name: &str, create: bool) -> Result<Option<Dir>, String> {
    if create {
        let mut builder = cap_std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use cap_std::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match parent.create_dir_with(name, &builder) {
            Ok(()) => {
                crate::durable_storage::sync_directory(parent).map_err(|_| DURABILITY)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(_) => return Err(STORAGE.into()),
        }
    }
    match cap_primitives::fs::open_dir_nofollow(
        &parent.try_clone().map_err(|_| STORAGE)?.into_std_file(),
        std::path::Path::new(name),
    ) {
        Ok(file) => Ok(Some(Dir::from_std_file(file))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => Ok(None),
        Err(_) => Err(STORAGE.into()),
    }
}
fn file(
    dir: &Dir,
    name: &str,
    write: bool,
    create: bool,
) -> Result<Option<cap_std::fs::File>, String> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(write)
        .create(create)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NONBLOCK);
    }
    match dir.open_with(name, &options) {
        Ok(file) if file.metadata().map_err(|_| STORAGE)?.is_file() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if write
                    && file
                        .try_clone()
                        .map_err(|_| STORAGE)?
                        .into_std()
                        .metadata()
                        .map_err(|_| STORAGE)?
                        .nlink()
                        != 1
                {
                    return Err(STORAGE.into());
                }
            }
            Ok(Some(file))
        }
        Ok(_) => Err(STORAGE.into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => Ok(None),
        Err(_) => Err(STORAGE.into()),
    }
}
fn metadata(dir: &Dir, id: &str) -> Result<Option<ConversationMetadata>, String> {
    let Some(mut file) = file(dir, "metadata.json", false, false)? else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|_| STORAGE)?;
    let value: ConversationMetadata = serde_json::from_value(
        crate::reference_storage_json::decode_metadata(&bytes).map_err(|_| INVALID)?,
    )
    .map_err(|_| INVALID)?;
    if value.version != 3 || value.id != id {
        return Err(INVALID.into());
    }
    let mut checked = value.clone();
    metadata_references(&mut checked, "validation", false)?;
    Ok(Some(value))
}
fn replace_metadata(dir: &Dir, value: &ConversationMetadata) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| INVALID)?;
    let temp = format!("metadata-{}.tmp", uuid::Uuid::new_v4());
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
    let mut output = dir.open_with(&temp, &options).map_err(|_| STORAGE)?;
    let result = (|| {
        output.write_all(&bytes).map_err(|_| STORAGE)?;
        #[cfg(test)]
        fail_if(|fault| matches!(fault, Fault::MetadataSync))?;
        output.sync_all().map_err(|_| DURABILITY)?;
        #[cfg(test)]
        fail_if(|fault| matches!(fault, Fault::MetadataRename))?;
        dir.rename(&temp, dir, "metadata.json")
            .map_err(|_| STORAGE)?;
        #[cfg(test)]
        fail_if(|fault| matches!(fault, Fault::DirectorySync))?;
        crate::durable_storage::sync_directory(dir).map_err(|_| DURABILITY)
    })();
    if result.is_err() {
        let _ = dir.remove_file(temp);
    }
    result.map_err(str::to_owned)
}
fn decode_entry(bytes: &[u8]) -> Result<HistoryEntry, String> {
    let entry: HistoryEntry = serde_json::from_value(
        crate::reference_storage_json::decode_history(bytes).map_err(|_| INVALID)?,
    )
    .map_err(|_| INVALID)?;
    let mut checked = entry.clone();
    entry_references(&mut checked, "validation", false)?;
    Ok(entry)
}
fn references(value: &mut Value, scope: &str, store: bool) -> Result<(), String> {
    let Some(values) = value.get_mut("references") else {
        return Ok(());
    };
    for value in values.as_array_mut().ok_or(INVALID)? {
        *value = if store {
            let reference = serde_json::from_value(value.clone()).map_err(|_| INVALID)?;
            serde_json::to_value(
                crate::reference_storage::LocalReference::store(reference, scope)
                    .map_err(|_| INVALID)?,
            )
            .map_err(|_| INVALID)?
        } else {
            let reference: crate::reference_storage::LocalReference =
                serde_json::from_value(value.clone()).map_err(|_| INVALID)?;
            serde_json::to_value(reference.bind(scope).map_err(|_| INVALID)?)
                .map_err(|_| INVALID)?
        };
    }
    Ok(())
}
fn entry_references(entry: &mut HistoryEntry, scope: &str, store: bool) -> Result<(), String> {
    match entry.kind.as_str() {
        "message" => {
            if let Some(input) = entry.data.get_mut("input") {
                references(input, scope, store)?;
            }
        }
        "run" => references(&mut entry.data, scope, store)?,
        _ => (),
    };
    Ok(())
}
fn metadata_references(
    value: &mut ConversationMetadata,
    scope: &str,
    store: bool,
) -> Result<(), String> {
    if let Some(draft) = &mut value.legacy_draft {
        references(draft, scope, store)?;
    }
    Ok(())
}
impl Storage {
    pub(crate) fn conversations_directory(&self, create: bool) -> Result<Option<Dir>, String> {
        open_dir(&self.dir, "conversations", create)
    }
    pub(crate) fn read_conversation_metadata_unlocked(
        &self,
        id: &str,
    ) -> Result<Option<ConversationMetadata>, String> {
        self.conversation_dir(id, false)?
            .map(|dir| metadata(&dir, id))
            .transpose()
            .map(Option::flatten)
    }
    fn validate_draft_attachments(&self, value: &ConversationMetadata) -> Result<(), String> {
        if let Some(draft) = &value.legacy_draft {
            self.validate_attachment_list(draft.get("attachments"))?;
        }
        Ok(())
    }
    fn validate_attachment_list(&self, value: Option<&Value>) -> Result<(), String> {
        if let Some(value) = value {
            for value in value.as_array().ok_or(INVALID)? {
                let reference: crate::attachment::AttachmentRef =
                    serde_json::from_value(value.clone()).map_err(|_| INVALID)?;
                if self.read_attachment(&reference.id)?.0 != reference {
                    return Err(INVALID.into());
                }
            }
        }
        Ok(())
    }
    fn validate_history_payload(&self, entry: &HistoryEntry) -> Result<(), String> {
        if entry.kind == "message" {
            crate::conversation::validate(&serde_json::json!([entry.data["message"]]))?;
            if let Some(input) = entry.data.get("input") {
                self.validate_attachment_list(input.get("attachments"))?;
                if !input["id"].as_str().is_some_and(entry_identity)
                    || !matches!(input["state"].as_str(), Some("waiting" | "pending"))
                {
                    return Err(INVALID.into());
                }
            }
            if let Some(blocks) = entry.data["message"]["content"].as_array() {
                for block in blocks {
                    if block["type"] == "image"
                        && let Some(id) = block["data"]
                            .as_str()
                            .and_then(|data| data.strip_prefix("attachment:"))
                    {
                        let (reference, _) = self.read_attachment(id)?;
                        if block["mimeType"] != reference.mime_type {
                            return Err(INVALID.into());
                        }
                    }
                }
            }
        }
        if entry.kind == "inputStatus"
            && (!entry.data["inputId"].as_str().is_some_and(entry_identity)
                || !matches!(
                    entry.data["state"].as_str(),
                    Some("waiting" | "pending" | "consumed" | "recalled" | "cancelled")
                ))
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    fn conversation_dir(&self, id: &str, create: bool) -> Result<Option<Dir>, String> {
        validate_id(id)?;
        let Some(root) = open_dir(&self.dir, "conversations", create)? else {
            return Ok(None);
        };
        open_dir(&root, id, create)
    }
    pub fn create_conversation_metadata(
        &self,
        value: &ConversationMetadata,
    ) -> Result<ConversationMetadata, String> {
        validate_id(&value.id)?;
        if value.version != 3
            || value.revision != 0
            || value.selected_entry_id.is_some()
            || value.message_count != 0
            || value.event_count != 0
        {
            return Err(INVALID.into());
        }
        let _lock = self.lock_named("conversations.lock")?;
        let dir = self.conversation_dir(&value.id, true)?.ok_or(STORAGE)?;
        if metadata(&dir, &value.id)?.is_some() {
            return Err(CONFLICT.into());
        }
        let history = file(&dir, "history.jsonl", true, true)?.ok_or(STORAGE)?;
        if history.metadata().map_err(|_| STORAGE)?.len() != 0 {
            return Err(CONFLICT.into());
        }
        history.sync_all().map_err(|_| DURABILITY)?;
        let mut stored = value.clone();
        metadata_references(&mut stored, &self.scope, true)?;
        self.validate_draft_attachments(value)?;
        replace_metadata(&dir, &stored)?;
        Ok(value.clone())
    }
    pub fn read_conversation_metadata(
        &self,
        id: &str,
    ) -> Result<Option<ConversationMetadata>, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let mut value = self.read_conversation_metadata_unlocked(id)?;
        if let Some(value) = &mut value {
            metadata_references(value, &self.scope, false)?;
        }
        Ok(value)
    }
    pub fn update_conversation_metadata(
        &self,
        value: &ConversationMetadata,
        expected_revision: u64,
    ) -> Result<ConversationMetadata, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let dir = self.conversation_dir(&value.id, false)?.ok_or(CONFLICT)?;
        let old = metadata(&dir, &value.id)?.ok_or(CONFLICT)?;
        let mut desired = value.clone();
        metadata_references(&mut desired, &self.scope, true)?;
        desired.revision = expected_revision.checked_add(1).ok_or(CONFLICT)?;
        if value.revision == expected_revision && old == desired {
            file(&dir, "metadata.json", false, false)?
                .ok_or(INVALID)?
                .sync_all()
                .map_err(|_| DURABILITY)?;
            crate::durable_storage::sync_directory(&dir).map_err(|_| DURABILITY)?;
            metadata_references(&mut desired, &self.scope, false)?;
            return Ok(desired);
        }
        if old.revision != expected_revision
            || value.revision != expected_revision
            || old.development != value.development
            || old.selected_entry_id != value.selected_entry_id
            || old.message_count != value.message_count
            || old.event_count != value.event_count
            || value.version != 3
        {
            return Err(CONFLICT.into());
        }
        let mut saved = value.clone();
        metadata_references(&mut saved, &self.scope, true)?;
        self.validate_draft_attachments(value)?;
        saved.revision = expected_revision.checked_add(1).ok_or(CONFLICT)?;
        replace_metadata(&dir, &saved)?;
        metadata_references(&mut saved, &self.scope, false)?;
        Ok(saved)
    }
    pub fn append_conversation_entries(
        &self,
        id: &str,
        expected_revision: u64,
        entries: &[HistoryEntry],
        selected_entry_id: Option<&str>,
    ) -> Result<ConversationMetadata, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let dir = self.conversation_dir(id, false)?.ok_or(CONFLICT)?;
        let mut value = metadata(&dir, id)?.ok_or(CONFLICT)?;
        let mut history = file(&dir, "history.jsonl", true, false)?.ok_or(INVALID)?;
        let mut cache = self.conversation_indexes.lock().map_err(|_| STORAGE)?;
        let index = cached_index(&mut cache, id, &self.dir, &self.scope)?;
        index.refresh(&history)?;
        if value.revision != expected_revision {
            if value.revision == expected_revision.checked_add(1).ok_or(CONFLICT)?
                && value.selected_entry_id.as_deref() == selected_entry_id
                && entries.iter().all(|entry| {
                    let mut expected = entry.clone();
                    entry_references(&mut expected, &self.scope, true).is_ok()
                        && index
                            .read(&history, &entry.id)
                            .is_ok_and(|stored| stored == expected)
                })
            {
                history.sync_all().map_err(|_| DURABILITY)?;
                crate::durable_storage::sync_directory(&dir).map_err(|_| DURABILITY)?;
                metadata_references(&mut value, &self.scope, false)?;
                return Ok(value);
            }
            return Err(CONFLICT.into());
        }
        let original_length = index.length;
        let result = (|| {
            if index.partial_length != 0 {
                let backup = format!("partial-{}.bin", uuid::Uuid::new_v4());
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
                let mut preserved = dir.open_with(&backup, &options).map_err(|_| STORAGE)?;
                history
                    .seek(SeekFrom::Start(index.length))
                    .map_err(|_| STORAGE)?;
                let copied = std::io::copy(
                    &mut std::io::Read::by_ref(&mut history).take(index.partial_length),
                    &mut preserved,
                )
                .map_err(|_| STORAGE)?;
                if copied != index.partial_length {
                    return Err(STORAGE.into());
                }
                #[cfg(test)]
                fail_if(|fault| matches!(fault, Fault::PartialBackupSync))?;
                preserved.sync_all().map_err(|_| DURABILITY)?;
                crate::durable_storage::sync_directory(&dir).map_err(|_| DURABILITY)?;
                history.set_len(original_length).map_err(|_| STORAGE)?;
                history.sync_all().map_err(|_| DURABILITY)?;
                index.partial_length = 0;
            }
            for entry in entries {
                self.validate_history_payload(entry)?;
                let mut stored = entry.clone();
                entry_references(&mut stored, &self.scope, true)?;
                if index.position(&history, &stored.id)?.is_some() {
                    if index.read(&history, &stored.id)? != stored {
                        return Err(CONFLICT.into());
                    }
                    continue;
                }
                let mut line = serde_json::to_vec(&stored).map_err(|_| INVALID)?;
                line.push(b'\n');
                let offset = index.length;
                index.insert(&history, &stored, offset, line.len() as u64)?;
                history.seek(SeekFrom::Start(offset)).map_err(|_| STORAGE)?;
                append_lines(&mut history, std::slice::from_ref(&line))?;
                index.length += line.len() as u64;
            }
            let (messages, events) = index.counts(&history, selected_entry_id)?;
            #[cfg(test)]
            fail_if(|fault| matches!(fault, Fault::HistorySync))?;
            history.sync_all().map_err(|_| DURABILITY)?;
            index.acknowledge(&history)?;
            value.revision = expected_revision.checked_add(1).ok_or(CONFLICT)?;
            value.selected_entry_id = selected_entry_id.map(str::to_owned);
            value.message_count = messages;
            value.event_count = events;
            for entry in entries {
                if entry.kind == "message"
                    && entry.data["message"]["role"] == "user"
                    && let Some(at) = entry.data["message"]["timestamp"].as_f64()
                {
                    value.last_user_message_at =
                        Some(value.last_user_message_at.map_or(at, |old| old.max(at)));
                }
            }
            replace_metadata(&dir, &value)?;
            metadata_references(&mut value, &self.scope, false)?;
            Ok(value)
        })();
        if result.is_err() {
            cache.remove(id);
        }
        result
    }
    pub fn find_conversation_input_state(
        &self,
        id: &str,
        input_id: &str,
    ) -> Result<Option<String>, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let Some(dir) = self.conversation_dir(id, false)? else {
            return Ok(None);
        };
        let value = metadata(&dir, id)?.ok_or(INVALID)?;
        let history = file(&dir, "history.jsonl", false, false)?.ok_or(INVALID)?;
        let mut cache = self.conversation_indexes.lock().map_err(|_| STORAGE)?;
        let index = cached_index(&mut cache, id, &self.dir, &self.scope)?;
        index.refresh(&history)?;
        index.input_state(&history, value.selected_entry_id.as_deref(), input_id)
    }
    pub fn read_conversation_entry(
        &self,
        id: &str,
        entry_id: &str,
    ) -> Result<Option<HistoryEntry>, String> {
        self.find_conversation_entry(id, entry_id)
    }
    pub fn is_conversation_ancestor(
        &self,
        id: &str,
        ancestor: &str,
        selected: &str,
    ) -> Result<bool, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let dir = self.conversation_dir(id, false)?.ok_or(CONFLICT)?;
        let history = file(&dir, "history.jsonl", false, false)?.ok_or(INVALID)?;
        let mut cache = self.conversation_indexes.lock().map_err(|_| STORAGE)?;
        let index = cached_index(&mut cache, id, &self.dir, &self.scope)?;
        index.refresh(&history)?;
        index.is_ancestor(&history, Some(selected), ancestor)
    }
    pub fn find_conversation_entry(
        &self,
        id: &str,
        entry_id: &str,
    ) -> Result<Option<HistoryEntry>, String> {
        self.lookup_history(id, entry_id, false)
    }
    pub fn find_conversation_action(
        &self,
        id: &str,
        action_id: &str,
    ) -> Result<Option<HistoryEntry>, String> {
        self.lookup_history(id, action_id, true)
    }
    fn lookup_history(
        &self,
        id: &str,
        key: &str,
        action: bool,
    ) -> Result<Option<HistoryEntry>, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let Some(dir) = self.conversation_dir(id, false)? else {
            return Ok(None);
        };
        let history = file(&dir, "history.jsonl", false, false)?.ok_or(INVALID)?;
        let mut cache = self.conversation_indexes.lock().map_err(|_| STORAGE)?;
        let index = cached_index(&mut cache, id, &self.dir, &self.scope)?;
        index.refresh(&history)?;
        let selected = metadata(&dir, id)?.ok_or(INVALID)?.selected_entry_id;
        let key = if action {
            index.find_action_id(&history, selected.as_deref(), key)?
        } else {
            index.position(&history, key)?.map(|_| key.to_owned())
        };
        key.as_deref()
            .map(|key| {
                let mut entry = index.read(&history, key)?;
                entry_references(&mut entry, &self.scope, false)?;
                if action && entry.kind == "event" && entry.data["type"] == "action_accepted" {
                    let action_id = entry.data["runId"].as_str().ok_or(INVALID)?.to_owned();
                    let normalized = entry.data["data"]["action"].clone();
                    entry.kind = "action".into();
                    entry.data = serde_json::json!({"actionId":action_id,"action":normalized});
                }
                Ok(entry)
            })
            .transpose()
    }
    pub fn read_conversation_history(
        &self,
        id: &str,
        before: Option<&str>,
        limit: usize,
    ) -> Result<HistoryPage, String> {
        if limit == 0 || limit > 1000 {
            return Err(INVALID.into());
        }
        let _lock = self.lock_named("conversations.lock")?;
        let dir = self.conversation_dir(id, false)?.ok_or(CONFLICT)?;
        let value = metadata(&dir, id)?.ok_or(CONFLICT)?;
        let history = file(&dir, "history.jsonl", false, false)?.ok_or(INVALID)?;
        let mut cache = self.conversation_indexes.lock().map_err(|_| STORAGE)?;
        let index = cached_index(&mut cache, id, &self.dir, &self.scope)?;
        index.refresh(&history)?;
        index.counts(&history, value.selected_entry_id.as_deref())?;
        let mut tip = match before {
            Some(id) => {
                if !index.is_ancestor(&history, value.selected_entry_id.as_deref(), id)? {
                    return Err(CONFLICT.into());
                }
                index.position(&history, id)?.ok_or(INVALID)?.parent
            }
            None => value.selected_entry_id.clone(),
        };
        let mut entries = Vec::new();
        while let Some(id) = tip.as_deref() {
            if entries.len() == limit {
                break;
            }
            let entry = index.read(&history, id)?;
            tip = entry.parent_id.clone();
            entries.push(entry);
        }
        let (message_offset, event_offset) = index.counts(&history, tip.as_deref())?;
        entries.reverse();
        let next_before = tip.and_then(|_| entries.first().map(|e| e.id.clone()));
        for entry in &mut entries {
            entry_references(entry, &self.scope, false)?;
        }
        let mut value = value;
        metadata_references(&mut value, &self.scope, false)?;
        Ok(HistoryPage {
            metadata: value,
            entries,
            next_before,
            message_offset,
            event_offset,
        })
    }
    pub fn read_conversation_context(
        &self,
        id: &str,
    ) -> Result<Option<ConversationContext>, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let Some(dir) = self.conversation_dir(id, false)? else {
            return Ok(None);
        };
        let Some(value) = metadata(&dir, id)? else {
            return Ok(None);
        };
        let history = file(&dir, "history.jsonl", false, false)?.ok_or(INVALID)?;
        let mut cache = self.conversation_indexes.lock().map_err(|_| STORAGE)?;
        let index = cached_index(&mut cache, id, &self.dir, &self.scope)?;
        index.refresh(&history)?;
        index.counts(&history, value.selected_entry_id.as_deref())?;
        let compaction_id = match value.selected_entry_id.as_deref() {
            Some(tip) => index.position(&history, tip)?.ok_or(INVALID)?.compaction,
            None => None,
        };
        let compaction = compaction_id
            .as_deref()
            .map(|id| index.read(&history, id))
            .transpose()?;
        let kept = compaction
            .as_ref()
            .and_then(|e| e.data["firstKeptEntryId"].as_str());
        let mut tip = value.selected_entry_id.clone();
        let mut entries = Vec::new();
        let mut reached = false;
        while let Some(current) = tip.as_deref() {
            if entries.len() == ACTIVE_HISTORY_LIMIT {
                break;
            }
            let entry = index.read(&history, current)?;
            let stop = kept == Some(current);
            tip = entry.parent_id.clone();
            if entry.kind != "compaction" {
                entries.push(entry);
            }
            if stop {
                reached = true;
                break;
            }
        }
        let truncated = tip.is_some() && !reached;
        let (message_offset, event_offset) = index.counts(&history, tip.as_deref())?;
        entries.reverse();
        let next_before = tip.and_then(|_| {
            entries
                .first()
                .map(|e| e.id.clone())
                .or_else(|| compaction.as_ref().map(|e| e.id.clone()))
        });
        let mut active_entries = index
            .active_ids(&history, value.selected_entry_id.as_deref())?
            .iter()
            .map(|id| index.read(&history, id))
            .collect::<Result<Vec<_>, _>>()?;
        for entry in entries.iter_mut().chain(active_entries.iter_mut()) {
            entry_references(entry, &self.scope, false)?;
        }
        let mut value = value;
        metadata_references(&mut value, &self.scope, false)?;
        Ok(Some(ConversationContext {
            metadata: value,
            entries,
            compaction,
            message_offset,
            event_offset,
            truncated,
            next_before,
            active_entries,
        }))
    }
}
