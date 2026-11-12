use super::{HistoryEntry, INVALID, STORAGE, decode_entry, entry_identity};
use cap_std::fs::File;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    hash::{Hash, Hasher},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
};

pub(super) const HOT_POSITION_LIMIT: usize = 1024;
#[cfg(test)]
thread_local! {pub(super) static SOURCE_READS:std::cell::Cell<usize>=const {std::cell::Cell::new(0)};}
const BUCKETS: usize = 4096;
#[cfg(test)]
thread_local! {static CACHE_FAIL_AFTER:std::cell::Cell<Option<usize>>=const {std::cell::Cell::new(None)};}
#[cfg(test)]
pub(super) fn fail_cache_after(writes: usize) {
    CACHE_FAIL_AFTER.set(Some(writes));
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Position {
    pub offset: u64,
    pub length: u64,
    pub parent: Option<String>,
    pub messages: usize,
    pub events: usize,
    pub compaction: Option<String>,
    active_change: Option<ActiveChange>,
}
#[derive(Clone, Serialize, Deserialize)]
enum ActiveChange {
    Input {
        id: String,
        state: String,
        original: bool,
    },
    Question {
        id: String,
        kind: String,
    },
}
#[derive(Default)]
struct ActiveState {
    tip: Option<String>,
    valid: bool,
    inputs: HashMap<String, Vec<String>>,
    questions: HashMap<String, Vec<String>>,
}
#[derive(Default)]
pub(crate) struct HistoryIndex {
    pub(super) positions: HashMap<String, Position>,
    order: VecDeque<String>,
    disk: OffsetCache,
    pub(super) length: u64,
    pub(super) partial_length: u64,
    stamp: Option<FileStamp>,
    active: ActiveState,
    owner: Option<CacheOwner>,
    #[cfg(test)]
    pub(super) scanned_entries: usize,
}
#[derive(PartialEq)]
struct CacheOwner {
    scope: String,
    #[cfg(unix)]
    identity: (u64, u64),
}
#[derive(PartialEq)]
pub(super) struct FileStamp {
    size: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    identity: (u64, u64),
}
pub(super) fn file_stamp(file: &File) -> Result<FileStamp, String> {
    std_file_stamp(&file.try_clone().map_err(|_| STORAGE)?.into_std())
}
fn std_file_stamp(file: &std::fs::File) -> Result<FileStamp, String> {
    let metadata = file.metadata().map_err(|_| STORAGE)?;
    Ok(FileStamp {
        size: metadata.len(),
        modified: metadata.modified().map_err(|_| STORAGE)?,
        #[cfg(unix)]
        identity: {
            use std::os::unix::fs::MetadataExt;
            (metadata.dev(), metadata.ino())
        },
    })
}

#[derive(Serialize, Deserialize)]
struct Hint {
    previous: Option<u64>,
    key: String,
    id: String,
    position: Position,
}
pub(super) struct OffsetCache {
    file: Option<std::fs::File>,
    heads: Box<[Option<u64>]>,
    stamp: Option<FileStamp>,
}
impl Default for OffsetCache {
    fn default() -> Self {
        Self {
            file: None,
            heads: vec![None; BUCKETS].into_boxed_slice(),
            stamp: None,
        }
    }
}
struct PositionedReader {
    file: std::fs::File,
    offset: u64,
}
impl Read for PositionedReader {
    // Cloned handles share a cursor; nested lookups need independently positioned reads.
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        self.file.seek(SeekFrom::Start(self.offset))?;
        let count = self.file.read(bytes)?;
        self.offset += count as u64;
        Ok(count)
    }
}
struct Hints {
    file: std::fs::File,
    next: Option<u64>,
    key: String,
}
impl Iterator for Hints {
    type Item = Result<Hint, String>;
    fn next(&mut self) -> Option<Self::Item> {
        while let Some(offset) = self.next.take() {
            let file = match self.file.try_clone() {
                Ok(file) => file,
                Err(_) => return Some(Err(STORAGE.into())),
            };
            let mut reader = BufReader::new(PositionedReader { file, offset });
            let mut line = Vec::new();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => return Some(Err(STORAGE.into())),
                Ok(_) => (),
            };
            let hint: Hint = match serde_json::from_slice(&line) {
                Ok(hint) => hint,
                Err(_) => return Some(Err(STORAGE.into())),
            };
            if hint.previous.is_some_and(|previous| previous >= offset) {
                return Some(Err(STORAGE.into()));
            }
            self.next = hint.previous;
            if hint.key == self.key {
                return Some(Ok(hint));
            }
        }
        None
    }
}
impl OffsetCache {
    fn valid(&self) -> bool {
        match (&self.file, &self.stamp) {
            (Some(file), Some(stamp)) => {
                std_file_stamp(file).is_ok_and(|current| current == *stamp)
            }
            (None, None) => self.heads.iter().all(Option::is_none),
            _ => false,
        }
    }
    fn bucket(key: &str) -> usize {
        let mut hash = std::hash::DefaultHasher::new();
        key.hash(&mut hash);
        hash.finish() as usize % BUCKETS
    }
    pub(super) fn append(
        &mut self,
        key: String,
        id: &str,
        position: &Position,
    ) -> Result<(), String> {
        let bucket = Self::bucket(&key);
        if self.file.is_none() {
            self.file = Some(tempfile::tempfile().map_err(|_| STORAGE)?);
        }
        let file = self.file.as_mut().ok_or(STORAGE)?;
        let offset = file.seek(SeekFrom::End(0)).map_err(|_| STORAGE)?;
        #[cfg(test)]
        if let Some(left) = CACHE_FAIL_AFTER.get() {
            if left == 0 {
                CACHE_FAIL_AFTER.set(None);
                file.write_all(b"{").map_err(|_| STORAGE)?;
                return Err(STORAGE.into());
            }
            CACHE_FAIL_AFTER.set(Some(left - 1));
        }
        serde_json::to_writer(
            &mut *file,
            &Hint {
                previous: self.heads[bucket],
                key,
                id: id.into(),
                position: position.clone(),
            },
        )
        .map_err(|_| STORAGE)?;
        file.write_all(b"\n").map_err(|_| STORAGE)?;
        self.heads[bucket] = Some(offset);
        self.stamp = Some(std_file_stamp(file)?);
        Ok(())
    }
    fn hints(&self, key: String) -> Result<Option<Hints>, String> {
        self.file
            .as_ref()
            .map(|file| {
                Ok(Hints {
                    file: file.try_clone().map_err(|_| STORAGE)?,
                    next: self.heads[Self::bucket(&key)],
                    key,
                })
            })
            .transpose()
    }
    pub(super) fn first(&self, key: String) -> Result<Option<(String, Position)>, String> {
        let Some(mut hints) = self.hints(key)? else {
            return Ok(None);
        };
        hints
            .next()
            .transpose()
            .map(|hint| hint.map(|hint| (hint.id, hint.position)))
    }
    fn position(&self, id: &str) -> Result<Option<Position>, String> {
        let Some(mut hints) = self.hints(format!("id:{id}"))? else {
            return Ok(None);
        };
        hints
            .next()
            .transpose()
            .map(|hint| hint.map(|hint| hint.position))
    }
}
pub(super) fn read_entry(file: &File, offset: u64) -> Result<(HistoryEntry, u64), String> {
    #[cfg(test)]
    SOURCE_READS.set(SOURCE_READS.get() + 1);
    let reader = PositionedReader {
        file: file.try_clone().map_err(|_| STORAGE)?.into_std(),
        offset,
    };
    let mut reader = BufReader::new(reader);
    let mut bytes = Vec::new();
    let length = reader.read_until(b'\n', &mut bytes).map_err(|_| STORAGE)?;
    if length == 0 || bytes.last() != Some(&b'\n') {
        return Err(INVALID.into());
    }
    Ok((decode_entry(&bytes)?, length as u64))
}
fn active_change(entry: &HistoryEntry) -> Option<ActiveChange> {
    match entry.kind.as_str() {
        "message" => entry.data.get("input").and_then(|input| {
            Some(ActiveChange::Input {
                id: input["id"].as_str()?.into(),
                state: input["state"].as_str()?.into(),
                original: true,
            })
        }),
        "inputStatus" => Some(ActiveChange::Input {
            id: entry.data["inputId"].as_str()?.into(),
            state: entry.data["state"].as_str()?.into(),
            original: false,
        }),
        "event"
            if entry.data["type"]
                .as_str()
                .is_some_and(|kind| kind.starts_with("question_")) =>
        {
            let kind = entry.data["type"].as_str()?;
            let id = if kind == "question_presented" {
                entry.data["data"]["id"].as_str()?
            } else {
                entry.data["data"]["questionId"].as_str()?
            };
            Some(ActiveChange::Question {
                id: id.into(),
                kind: kind.into(),
            })
        }
        _ => None,
    }
}
fn action_id(entry: &HistoryEntry) -> Option<&str> {
    entry
        .data
        .get("actionId")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            (entry.kind == "event" && entry.data["type"] == "action_accepted")
                .then(|| entry.data["runId"].as_str())
                .flatten()
        })
}
impl HistoryIndex {
    #[cfg(test)]
    pub(super) fn remove_cache_file(&mut self) {
        self.disk.file = None;
    }
    #[cfg(test)]
    pub(super) fn evict_hot_positions(&mut self) {
        self.positions.clear();
        self.order.clear();
    }
    #[cfg(test)]
    pub(super) fn corrupt_cache_file(&mut self) {
        self.disk.file.as_mut().unwrap().set_len(1).unwrap();
    }
    #[cfg(test)]
    pub(super) fn retained_state(&self) -> (usize, usize, usize) {
        (
            self.positions.len(),
            self.active.inputs.len(),
            self.active.questions.len(),
        )
    }
    #[cfg(test)]
    pub(super) fn estimated_bytes(&self) -> usize {
        self.positions.capacity() * std::mem::size_of::<(String, Position)>()
            + self
                .positions
                .iter()
                .map(|(id, p)| {
                    id.capacity()
                        + p.parent.as_ref().map_or(0, String::capacity)
                        + p.compaction.as_ref().map_or(0, String::capacity)
                })
                .sum::<usize>()
            + self.order.capacity() * std::mem::size_of::<String>()
            + self.order.iter().map(String::capacity).sum::<usize>()
            + self.disk.heads.len() * std::mem::size_of::<Option<u64>>()
    }
    fn remember(&mut self, id: String, position: Position) {
        // Spare capacity lets eviction tombstones be reclaimed without growing the table.
        if self.positions.capacity() == 0 {
            self.positions.reserve(HOT_POSITION_LIMIT * 2);
        }
        if self.positions.contains_key(&id) {
            return;
        }
        if self.positions.len() == HOT_POSITION_LIMIT
            && let Some(old) = self.order.pop_front()
        {
            self.positions.remove(&old);
        }
        self.order.push_back(id.clone());
        self.positions.insert(id, position);
    }
    fn reset(&mut self) {
        let owner = self.owner.take();
        *self = Self::default();
        self.owner = owner;
    }
    pub(super) fn bind(&mut self, dir: &cap_std::fs::Dir, scope: &str) -> Result<(), String> {
        let metadata = dir
            .try_clone()
            .map_err(|_| STORAGE)?
            .into_std_file()
            .metadata()
            .map_err(|_| STORAGE)?;
        let owner = CacheOwner {
            scope: scope.into(),
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                (metadata.dev(), metadata.ino())
            },
        };
        if self.owner.as_ref() != Some(&owner) {
            self.reset();
            self.owner = Some(owner);
        }
        Ok(())
    }
    fn rebuild(&mut self, file: &File) -> Result<(), String> {
        self.reset();
        self.refresh(file)
    }
    pub(super) fn acknowledge(&mut self, file: &File) -> Result<(), String> {
        let stamp = file_stamp(file)?;
        if stamp.size != self.length {
            return Err(INVALID.into());
        }
        self.stamp = Some(stamp);
        Ok(())
    }
    pub(super) fn position(&mut self, file: &File, id: &str) -> Result<Option<Position>, String> {
        match self.position_once(file, id) {
            Ok(position) => Ok(position),
            Err(_) => {
                self.rebuild(file)?;
                self.position_once(file, id)
            }
        }
    }
    fn position_once(&mut self, file: &File, id: &str) -> Result<Option<Position>, String> {
        let position = match self.positions.get(id) {
            Some(position) => Some(position.clone()),
            None => self.disk.position(id)?,
        };
        let Some(position) = position else {
            return Ok(None);
        };
        let (entry, length) = read_entry(file, position.offset)?;
        if entry.id != id || entry.parent_id != position.parent || length != position.length {
            return Err(INVALID.into());
        }
        self.remember(id.into(), position.clone());
        Ok(Some(position))
    }
    pub(super) fn insert(
        &mut self,
        file: &File,
        entry: &HistoryEntry,
        offset: u64,
        length: u64,
    ) -> Result<(), String> {
        if entry.version != 1
            || !entry_identity(&entry.id)
            || self.position(file, &entry.id)?.is_some()
        {
            return Err(INVALID.into());
        }
        let parent = entry
            .parent_id
            .as_deref()
            .map(|id| self.position(file, id)?.ok_or_else(|| INVALID.to_owned()))
            .transpose()?;
        let messages =
            parent.as_ref().map_or(0, |p| p.messages) + usize::from(entry.kind == "message");
        let events = parent.as_ref().map_or(0, |p| p.events) + usize::from(entry.kind == "event");
        if entry.kind == "compaction" {
            let kept = entry.data["firstKeptEntryId"].as_str().ok_or(INVALID)?;
            if !entry.data["summary"].is_string()
                || (kept != entry.id
                    && !self.is_ancestor(file, entry.parent_id.as_deref(), kept)?)
            {
                return Err(INVALID.into());
            }
        }
        let compaction = if entry.kind == "compaction" {
            Some(entry.id.clone())
        } else {
            parent.and_then(|p| p.compaction)
        };
        let position = Position {
            offset,
            length,
            parent: entry.parent_id.clone(),
            messages,
            events,
            compaction,
            active_change: active_change(entry),
        };
        if let Some(action) = action_id(entry) {
            if !entry_identity(action) {
                return Err(INVALID.into());
            }
            if entry.kind == "action"
                && self
                    .find_action_id(file, entry.parent_id.as_deref(), action)?
                    .is_some()
            {
                return Err(super::CONFLICT.into());
            }
            self.disk
                .append(format!("action:{action}"), &entry.id, &position)?;
        }
        self.disk
            .append(format!("id:{}", entry.id), &entry.id, &position)?;
        self.remember(entry.id.clone(), position);
        Ok(())
    }
    pub(super) fn is_ancestor(
        &mut self,
        file: &File,
        tip: Option<&str>,
        id: &str,
    ) -> Result<bool, String> {
        let mut current = tip.map(str::to_owned);
        while let Some(tip) = current {
            if tip == id {
                return Ok(true);
            }
            current = self.position(file, &tip)?.ok_or(INVALID)?.parent;
        }
        Ok(false)
    }
    pub(super) fn find_action_id(
        &mut self,
        file: &File,
        tip: Option<&str>,
        action: &str,
    ) -> Result<Option<String>, String> {
        match self.find_action_once(file, tip, action) {
            Ok(id) => Ok(id),
            Err(_) => {
                self.rebuild(file)?;
                self.find_action_once(file, tip, action)
            }
        }
    }
    fn find_action_once(
        &mut self,
        file: &File,
        tip: Option<&str>,
        action: &str,
    ) -> Result<Option<String>, String> {
        let Some(hints) = self.disk.hints(format!("action:{action}"))? else {
            return Ok(None);
        };
        for hint in hints {
            let hint = hint?;
            let (entry, length) = read_entry(file, hint.position.offset)?;
            if entry.id != hint.id
                || entry.parent_id != hint.position.parent
                || length != hint.position.length
                || action_id(&entry) != Some(action)
            {
                return Err(INVALID.into());
            }
            if self.is_ancestor(file, tip, &hint.id)? {
                return Ok(Some(hint.id));
            }
        }
        Ok(None)
    }
    pub(super) fn input_state(
        &mut self,
        file: &File,
        tip: Option<&str>,
        input_id: &str,
    ) -> Result<Option<String>, String> {
        let mut current = tip.map(str::to_owned);
        while let Some(id) = current {
            let position = self.position(file, &id)?.ok_or(INVALID)?;
            if let Some(ActiveChange::Input {
                id: logical, state, ..
            }) = &position.active_change
                && logical == input_id
            {
                return Ok(Some(state.clone()));
            }
            current = position.parent;
        }
        Ok(None)
    }
    fn input_origin(
        &mut self,
        file: &File,
        tip: Option<&str>,
        input_id: &str,
    ) -> Result<Option<String>, String> {
        let mut current = tip.map(str::to_owned);
        while let Some(id) = current {
            let position = self.position(file, &id)?.ok_or(INVALID)?;
            if matches!(&position.active_change,Some(ActiveChange::Input{id:logical,original:true,..}) if logical==input_id)
            {
                return Ok(Some(id));
            }
            current = position.parent;
        }
        Ok(None)
    }
    pub(super) fn active_ids(
        &mut self,
        file: &File,
        tip: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let old_tip = self.active.tip.clone();
        let same_branch = match old_tip.as_deref() {
            Some(old) => self.is_ancestor(file, tip, old)?,
            None => true,
        };
        if !self.active.valid || !same_branch {
            self.active = ActiveState::default();
        }
        let stop = self.active.tip.clone();
        let mut current = tip.map(str::to_owned);
        let mut path = tempfile::tempfile().map_err(|_| STORAGE)?;
        let mut changes = 0u64;
        while current != stop {
            let Some(id) = current else { break };
            let position = self.position(file, &id)?.ok_or(INVALID)?;
            if position.active_change.is_some() {
                path.write_all(&position.offset.to_le_bytes())
                    .map_err(|_| STORAGE)?;
                changes += 1;
            }
            current = position.parent;
        }
        for i in (0..changes).rev() {
            path.seek(SeekFrom::Start(i * 8)).map_err(|_| STORAGE)?;
            let mut offset = [0; 8];
            path.read_exact(&mut offset).map_err(|_| STORAGE)?;
            let (entry, _) = read_entry(file, u64::from_le_bytes(offset))?;
            let physical = entry.id.clone();
            match active_change(&entry) {
                Some(ActiveChange::Input {
                    id,
                    state,
                    original,
                }) => {
                    if matches!(state.as_str(), "waiting" | "pending") {
                        if original {
                            self.active.inputs.insert(id, vec![physical]);
                        } else if let Some(origin) =
                            self.input_origin(file, Some(&physical), &id)?
                        {
                            self.active.inputs.insert(id, vec![origin, physical]);
                        }
                    } else {
                        self.active.inputs.remove(&id);
                    }
                }
                Some(ActiveChange::Question { id, kind }) => match kind.as_str() {
                    "question_presented" => {
                        self.active.questions.retain(|_, entries| entries.len() > 1);
                        self.active.questions.insert(id, vec![physical]);
                    }
                    "question_answered" => {
                        let presented = self
                            .active
                            .questions
                            .get(&id)
                            .and_then(|entries| entries.first())
                            .cloned();
                        let contextual = presented
                            .map(|presented| {
                                self.read(file, &presented)
                                    .map(|entry| entry.data["data"].get("context").is_some())
                            })
                            .transpose()?
                            .unwrap_or(false);
                        if contextual {
                            if let Some(entries) = self.active.questions.get_mut(&id) {
                                entries.truncate(1);
                                entries.push(physical);
                            }
                        } else {
                            self.active.questions.remove(&id);
                        }
                    }
                    "question_superseded" | "question_action_completed" => {
                        self.active.questions.remove(&id);
                    }
                    _ => (),
                },
                None => (),
            }
        }
        self.active.tip = tip.map(str::to_owned);
        self.active.valid = true;
        let ids: Vec<_> = self
            .active
            .inputs
            .values()
            .flatten()
            .chain(self.active.questions.values().flatten())
            .cloned()
            .collect();
        let mut ordered = Vec::with_capacity(ids.len());
        for id in ids {
            let position = self.position(file, &id)?.ok_or(INVALID)?;
            ordered.push((position.offset, id));
        }
        ordered.sort_by_key(|(offset, _)| *offset);
        Ok(ordered.into_iter().map(|(_, id)| id).collect())
    }
    pub(super) fn refresh(&mut self, file: &File) -> Result<(), String> {
        let stamp = file_stamp(file)?;
        if !self.disk.valid() {
            self.reset();
        }
        if self.stamp.as_ref() == Some(&stamp) {
            return Ok(());
        }
        if self.stamp.is_some() {
            self.reset();
        }
        if stamp.size < self.length {
            return Err(INVALID.into());
        }
        self.partial_length = 0;
        while self.length < stamp.size {
            let mut reader = BufReader::new(PositionedReader {
                file: file.try_clone().map_err(|_| STORAGE)?.into_std(),
                offset: self.length,
            });
            let mut line = Vec::new();
            let length = reader.read_until(b'\n', &mut line).map_err(|_| STORAGE)?;
            if line.last() != Some(&b'\n') {
                self.partial_length = line.len() as u64;
                break;
            }
            let entry = decode_entry(&line)?;
            self.insert(file, &entry, self.length, length as u64)?;
            self.length += length as u64;
            #[cfg(test)]
            {
                self.scanned_entries += 1;
            }
        }
        self.stamp = Some(stamp);
        Ok(())
    }
    pub(super) fn read(&mut self, file: &File, id: &str) -> Result<HistoryEntry, String> {
        let position = self.position(file, id)?.ok_or(INVALID)?;
        let (entry, length) = read_entry(file, position.offset)?;
        if entry.id != id || entry.parent_id != position.parent || length != position.length {
            return Err(INVALID.into());
        }
        Ok(entry)
    }
    pub(super) fn counts(
        &mut self,
        file: &File,
        tip: Option<&str>,
    ) -> Result<(usize, usize), String> {
        tip.map(|id| {
            self.position(file, id)?
                .map(|p| (p.messages, p.events))
                .ok_or_else(|| INVALID.to_owned())
        })
        .unwrap_or(Ok((0, 0)))
    }
}
