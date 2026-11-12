use super::index::{FileStamp, OffsetCache, file_stamp, read_entry};
use super::{
    CONFLICT, ConversationMetadata, HistoryEntry, INVALID, STORAGE, cached_index, entry_references,
    file, metadata, metadata_references,
};
use crate::ai_storage::Storage;
use cap_std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

#[cfg(test)]
#[path = "conversation_history_reader_tests.rs"]
mod tests;

const RECORD_BYTES: u64 = 17;
const INPUT_CONSUMED: u8 = 1;
const LATEST_RUN: u8 = 2;
const HAS_INPUT: u8 = 4;

pub struct HistoryReadEntry {
    pub entry: HistoryEntry,
    /// Latest selected-path status; only meaningful for messages with input metadata.
    pub input_consumed: bool,
    /// Whether this is the selected path's last patch for its logical run ID.
    pub latest_run: bool,
}

/// A selected-path snapshot. No store lock is retained while entries are consumed.
/// Call `validate` before acknowledging output assembled from this reader.
pub struct ConversationHistoryReader<'a> {
    storage: &'a Storage,
    metadata: ConversationMetadata,
    history: File,
    generation: FileStamp,
    offsets: std::fs::File,
    records: u64,
    next: u64,
}
impl ConversationHistoryReader<'_> {
    pub fn metadata(&self) -> &ConversationMetadata {
        &self.metadata
    }
    fn validate_generation(&self) -> Result<(), String> {
        if file_stamp(&self.history)? != self.generation {
            return Err(CONFLICT.into());
        }
        Ok(())
    }
    pub fn rewind(&mut self) -> Result<(), String> {
        self.validate_generation()?;
        self.next = 0;
        Ok(())
    }
    pub fn next_entry(&mut self) -> Result<Option<HistoryReadEntry>, String> {
        self.validate_generation()?;
        if self.next == self.records {
            return Ok(None);
        }
        self.offsets
            .seek(SeekFrom::Start(
                (self.records - self.next - 1) * RECORD_BYTES,
            ))
            .map_err(|_| STORAGE)?;
        let mut record = [0; RECORD_BYTES as usize];
        self.offsets.read_exact(&mut record).map_err(|_| STORAGE)?;
        let offset = u64::from_le_bytes(record[..8].try_into().map_err(|_| INVALID)?);
        let length = u64::from_le_bytes(record[8..16].try_into().map_err(|_| INVALID)?);
        let (mut entry, actual_length) = read_entry(&self.history, offset)?;
        if actual_length != length {
            return Err(INVALID.into());
        }
        entry_references(&mut entry, &self.storage.scope, false)?;
        self.next += 1;
        Ok(Some(HistoryReadEntry {
            entry,
            input_consumed: record[16] & INPUT_CONSUMED != 0,
            latest_run: record[16] & LATEST_RUN != 0,
        }))
    }
    pub fn validate(&self) -> Result<(), String> {
        self.validate_generation()?;
        let _lock = self.storage.lock_named("conversations.lock")?;
        let dir = self
            .storage
            .conversation_dir(&self.metadata.id, false)?
            .ok_or(CONFLICT)?;
        let current = metadata(&dir, &self.metadata.id)?.ok_or(CONFLICT)?;
        let history = file(&dir, "history.jsonl", false, false)?.ok_or(INVALID)?;
        if current.revision != self.metadata.revision || file_stamp(&history)? != self.generation {
            return Err(CONFLICT.into());
        }
        Ok(())
    }
}
fn latest_entry(
    latest: &OffsetCache,
    key: String,
    history: &File,
) -> Result<Option<HistoryEntry>, String> {
    latest
        .first(key)?
        .map(|(id, hint)| {
            let (entry, length) = read_entry(history, hint.offset)?;
            if entry.id != id || entry.parent_id != hint.parent || length != hint.length {
                return Err(INVALID.into());
            }
            Ok(entry)
        })
        .transpose()
}
fn key(kind: &str, id: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(id)
        .map(|id| format!("{kind}:{id}"))
        .map_err(|_| INVALID.into())
}
impl Storage {
    pub fn conversation_history_reader(
        &self,
        id: &str,
        revision: Option<u64>,
    ) -> Result<ConversationHistoryReader<'_>, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let dir = self
            .conversation_dir(id, false)?
            .ok_or("native.ai.conversation.invalidId")?;
        let mut metadata = metadata(&dir, id)?.ok_or("native.ai.conversation.invalidId")?;
        if revision.is_some_and(|expected| expected != metadata.revision) {
            return Err(CONFLICT.into());
        }
        let history = file(&dir, "history.jsonl", false, false)?.ok_or(INVALID)?;
        let mut cache = self.conversation_indexes.lock().map_err(|_| STORAGE)?;
        let index = cached_index(&mut cache, id, &self.dir, &self.scope)?;
        index.refresh(&history)?;
        let generation = file_stamp(&history)?;
        let mut offsets = tempfile::tempfile().map_err(|_| STORAGE)?;
        let mut records = 0;
        let mut latest = OffsetCache::default();
        let mut tip = metadata.selected_entry_id.clone();
        while let Some(id) = tip {
            let position = index.position(&history, &id)?.ok_or(INVALID)?;
            let entry = index.read(&history, &id)?;
            let mut flags = 0;
            match entry.kind.as_str() {
                "inputStatus" if entry.data["state"].is_string() => {
                    let key = key("input", &entry.data["inputId"])?;
                    if let Some(status) = latest_entry(&latest, key.clone(), &history)? {
                        if status.kind != "inputStatus"
                            || status.data["inputId"] != entry.data["inputId"]
                        {
                            return Err(INVALID.into());
                        }
                    } else {
                        latest.append(key, &id, &position)?;
                    }
                }
                "message" if entry.data.get("input").is_some() => {
                    flags |= HAS_INPUT;
                }
                "run" => {
                    let key = key("run", &entry.data["id"])?;
                    if let Some(run) = latest_entry(&latest, key.clone(), &history)? {
                        if run.kind != "run" || run.data["id"] != entry.data["id"] {
                            return Err(INVALID.into());
                        }
                    } else {
                        flags |= LATEST_RUN;
                        latest.append(key, &id, &position)?;
                    }
                }
                _ => (),
            }
            offsets
                .write_all(&position.offset.to_le_bytes())
                .map_err(|_| STORAGE)?;
            offsets
                .write_all(&position.length.to_le_bytes())
                .map_err(|_| STORAGE)?;
            offsets.write_all(&[flags]).map_err(|_| STORAGE)?;
            records += 1;
            tip = entry.parent_id;
        }
        // Reused logical input IDs can have a latest status before a later original.
        offsets.seek(SeekFrom::Start(0)).map_err(|_| STORAGE)?;
        for record_index in 0..records {
            let mut record = [0; RECORD_BYTES as usize];
            offsets.read_exact(&mut record).map_err(|_| STORAGE)?;
            if record[16] & HAS_INPUT == 0 {
                continue;
            }
            let offset = u64::from_le_bytes(record[..8].try_into().map_err(|_| INVALID)?);
            let length = u64::from_le_bytes(record[8..16].try_into().map_err(|_| INVALID)?);
            let (entry, actual) = read_entry(&history, offset)?;
            if actual != length || entry.kind != "message" {
                return Err(INVALID.into());
            }
            let input = entry.data.get("input").ok_or(INVALID)?;
            let state = if let Some(status) =
                latest_entry(&latest, key("input", &input["id"])?, &history)?
            {
                if status.kind != "inputStatus" || status.data["inputId"] != input["id"] {
                    return Err(INVALID.into());
                }
                status.data["state"].as_str().map(str::to_owned)
            } else {
                None
            };
            if state.as_deref().or(input["state"].as_str()) == Some("consumed") {
                record[16] |= INPUT_CONSUMED;
            }
            offsets
                .seek(SeekFrom::Start(record_index * RECORD_BYTES + 16))
                .map_err(|_| STORAGE)?;
            offsets.write_all(&record[16..]).map_err(|_| STORAGE)?;
        }
        if file_stamp(&history)? != generation {
            return Err(CONFLICT.into());
        }
        metadata_references(&mut metadata, &self.scope, false)?;
        Ok(ConversationHistoryReader {
            storage: self,
            metadata,
            history,
            generation,
            offsets,
            records,
            next: 0,
        })
    }
}
