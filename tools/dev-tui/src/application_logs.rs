#[cfg(test)]
#[path = "application_logs_tests.rs"]
mod tests;

use crate::text;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub const MANIFEST_ENV: &str = "SITUATE_DEV_DIAGNOSTICS_MANIFEST";
const LINE_BYTES: usize = 32 * 1024;
const BUFFER_BYTES: usize = 2 * 1024 * 1024;
const RECORDS: usize = 3000;
const POLL_BYTES: usize = 256 * 1024;
const FILES: usize = 64;
const LEVELS: [&str; 5] = ["trace", "debug", "info", "warn", "error"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    directory: PathBuf,
    session_id: String,
    status: String,
}

#[derive(Clone, Deserialize)]
pub struct Context {
    pub trace_id: String,
    pub span_id: String,
    pub initiator: String,
    pub parent_span_id: Option<String>,
}

#[derive(Clone, Deserialize)]
pub struct Record {
    schema_version: u32,
    pub timestamp_ms: u64,
    pub level: String,
    pub category: String,
    pub event: String,
    pub origin: String,
    pub session_id: String,
    pub context: Option<Context>,
    #[serde(default)]
    attributes: Map<String, Value>,
    #[serde(skip)]
    bytes: usize,
}
impl Record {
    pub fn line(&self) -> String {
        let context = self.context.as_ref().map_or_else(String::new, |c| {
            let parent = c
                .parent_span_id
                .as_ref()
                .map_or_else(String::new, |id| format!(" parent={id}"));
            format!(
                " trace={} span={}{} {}",
                c.trace_id, c.span_id, parent, c.initiator
            )
        });
        let attributes = self
            .attributes
            .iter()
            .map(|(key, value)| {
                format!(
                    " {key}={}",
                    value
                        .as_str()
                        .map_or_else(|| value.to_string(), str::to_string)
                )
            })
            .collect::<String>();
        safe_text(&format!(
            "{:02}:{:02}:{:02}.{:03}Z {} {} {} {}{}{}",
            self.timestamp_ms / 3_600_000 % 24,
            self.timestamp_ms / 60_000 % 60,
            self.timestamp_ms / 1000 % 60,
            self.timestamp_ms % 1000,
            self.level,
            self.category,
            self.event,
            self.origin,
            attributes,
            context
        ))
    }
}

fn safe_text(value: &str) -> String {
    crate::process::clean(value.as_bytes())
        .chars()
        .filter(|c| !matches!(*c, '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
        .collect()
}
fn attribute_rules() -> &'static Value {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    &CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../client/contracts/diagnostics.json"))
            .expect("valid diagnostic catalog")
    })["attributes"]
}
fn reviewed_scalar(value: &Value, rule: &Value) -> bool {
    if let Some(allowed) = rule.as_array() {
        return value
            .as_str()
            .is_some_and(|s| token(s, 32) && allowed.iter().any(|v| v.as_str() == Some(s)));
    }
    value.as_f64().is_some_and(|n| {
        n.is_finite()
            && rule["min"].as_f64().is_some_and(|min| n >= min)
            && rule["max"].as_f64().is_some_and(|max| n <= max)
            && (rule["integer"] != true || n.fract() == 0.0)
    })
}
fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit() && !b.is_ascii_uppercase()
            }
        })
}
fn token(value: &str, limit: usize) -> bool {
    !value.is_empty()
        && value.len() <= limit
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

#[derive(Default)]
struct Cursor {
    identity: (u64, u64),
    offset: u64,
    partial: Vec<u8>,
    oversized: bool,
    checkpoint: Vec<u8>,
    modified: Option<std::time::SystemTime>,
}

pub struct ApplicationLogs {
    launch: tempfile::TempDir,
    directory: Option<PathBuf>,
    pub session: Option<String>,
    pub status: &'static str,
    cursors: BTreeMap<PathBuf, Cursor>,
    pub records: VecDeque<Record>,
    bytes: usize,
    pub omitted: usize,
    pub unsupported: usize,
    pub evicted: usize,
    pub paused: bool,
    pub level: usize,
    pub category: Option<String>,
    pub trace: Option<String>,
}
impl ApplicationLogs {
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            launch: tempfile::Builder::new()
                .prefix("situate-dev-logs-")
                .permissions(fs::Permissions::from_mode(0o700))
                .tempdir()?,
            directory: None,
            session: None,
            status: text::APPLICATION_WAITING,
            cursors: BTreeMap::new(),
            records: VecDeque::new(),
            bytes: 0,
            omitted: 0,
            unsupported: 0,
            evicted: 0,
            paused: false,
            level: 0,
            category: None,
            trace: None,
        })
    }
    pub fn manifest_path(&self) -> PathBuf {
        self.launch.path().join("manifest.json")
    }
    pub fn poll(&mut self) {
        {
            let result = read_bounded(&self.manifest_path(), 4096).and_then(|bytes| {
                serde_json::from_slice::<Manifest>(&bytes).map_err(io::Error::other)
            });
            let manifest = match result {
                Ok(m)
                    if m.version == 1
                        && (m.directory.is_absolute()
                            || (m.status == "unavailable"
                                && m.directory.as_os_str().is_empty()))
                        && uuid(&m.session_id)
                        && matches!(m.status.as_str(), "ready" | "unavailable") =>
                {
                    m
                }
                Ok(_) => {
                    self.status = text::APPLICATION_INVALID;
                    return;
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    self.status = text::APPLICATION_WAITING;
                    return;
                }
                Err(_) => {
                    self.status = text::APPLICATION_DISCOVERY_UNAVAILABLE;
                    return;
                }
            };
            if self
                .session
                .as_ref()
                .is_some_and(|id| id != &manifest.session_id)
            {
                self.records.clear();
                self.cursors.clear();
                self.bytes = 0;
                self.category = None;
                self.trace = None;
            }
            self.session = Some(manifest.session_id);
            if manifest.status == "unavailable" {
                self.status = text::APPLICATION_UNAVAILABLE;
                return;
            }
            self.directory = Some(manifest.directory);
        }
        if self.paused {
            return;
        }
        if self.read_segments().is_err() {
            self.status = text::APPLICATION_FILES_UNAVAILABLE;
        } else if self.records.is_empty() {
            self.status = text::APPLICATION_RECORDS_WAITING;
        } else {
            self.status = text::APPLICATION_FOLLOWING;
        }
    }
    fn read_segments(&mut self) -> io::Result<()> {
        let mut paths = Vec::new();
        for (index, entry) in fs::read_dir(self.directory.as_ref().unwrap())?
            .take(4097)
            .enumerate()
        {
            if index == 4096 {
                return Err(io::Error::other("too many directory entries"));
            }
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.len() == 34
                && name.starts_with("segment-")
                && name.ends_with(".jsonl")
                && name.as_bytes()[8..28].iter().all(|b| b.is_ascii_digit())
                && entry.file_type()?.is_file()
            {
                paths.push(entry.path());
            }
        }
        paths.sort();
        if paths.len() > FILES {
            return Err(io::Error::other("too many diagnostic segments"));
        }
        self.cursors.retain(|path, cursor| {
            let keep = paths.contains(path);
            if !keep && (!cursor.partial.is_empty() || cursor.oversized) {
                self.omitted = self.omitted.saturating_add(1);
            }
            keep
        });
        let mut remaining = POLL_BYTES;
        for path in paths {
            if remaining == 0 {
                break;
            }
            let mut file = open_read(&path)?;
            let meta = file.metadata()?;
            let identity = (meta.dev(), meta.ino());
            let mut cursor = self.cursors.remove(&path).unwrap_or_default();
            let modified = meta.modified().ok();
            let mut changed = cursor.identity != identity
                || meta.len() < cursor.offset
                || (cursor.offset > 0
                    && meta.len() == cursor.offset
                    && modified != cursor.modified);
            if !changed && !cursor.checkpoint.is_empty() {
                file.seek(SeekFrom::Start(
                    cursor.offset - cursor.checkpoint.len() as u64,
                ))?;
                let mut check = vec![0; cursor.checkpoint.len()];
                changed = file.read_exact(&mut check).is_err() || check != cursor.checkpoint;
            }
            if changed {
                if !cursor.partial.is_empty() || cursor.oversized {
                    self.omitted = self.omitted.saturating_add(1);
                }
                cursor = Cursor {
                    identity,
                    ..Cursor::default()
                };
            }
            file.seek(SeekFrom::Start(cursor.offset))?;
            let mut bytes = vec![0; remaining.min(16 * 1024)];
            while cursor.offset < meta.len() {
                let length = remaining
                    .min(bytes.len())
                    .min((meta.len() - cursor.offset) as usize);
                let n = file.read(&mut bytes[..length])?;
                if n == 0 {
                    break;
                }
                remaining -= n;
                cursor.offset += n as u64;
                for &byte in &bytes[..n] {
                    if byte == b'\n' {
                        if cursor.oversized {
                            self.omitted = self.omitted.saturating_add(1);
                        } else {
                            self.admit(&cursor.partial);
                        }
                        cursor.partial.clear();
                        cursor.oversized = false;
                    } else if !cursor.oversized {
                        if cursor.partial.len() == LINE_BYTES {
                            cursor.partial.clear();
                            cursor.oversized = true;
                        } else {
                            cursor.partial.push(byte);
                        }
                    }
                }
                if remaining == 0 {
                    break;
                }
            }
            let length = cursor.offset.min(32) as usize;
            file.seek(SeekFrom::Start(cursor.offset - length as u64))?;
            cursor.checkpoint.resize(length, 0);
            file.read_exact(&mut cursor.checkpoint)?;
            cursor.modified = modified;
            self.cursors.insert(path, cursor);
        }
        Ok(())
    }
    fn admit(&mut self, bytes: &[u8]) {
        #[derive(Deserialize)]
        struct Version {
            schema_version: u32,
        }
        if serde_json::from_slice::<Version>(bytes).is_ok_and(|v| v.schema_version != 1) {
            self.unsupported = self.unsupported.saturating_add(1);
            return;
        }
        let Ok(mut record) = serde_json::from_slice::<Record>(bytes) else {
            self.omitted = self.omitted.saturating_add(1);
            return;
        };
        if record.schema_version != 1 {
            self.unsupported = self.unsupported.saturating_add(1);
            return;
        }
        if !uuid(&record.session_id)
            || !LEVELS.contains(&record.level.as_str())
            || !token(&record.category, 16)
            || !token(&record.event, 32)
            || !matches!(record.origin.as_str(), "native" | "frontend" | "plugin")
            || record.context.as_ref().is_some_and(|c| {
                !uuid(&c.trace_id)
                    || !uuid(&c.span_id)
                    || c.parent_span_id.as_ref().is_some_and(|id| !uuid(id))
                    || !matches!(c.initiator.as_str(), "user" | "agent" | "background")
            })
        {
            self.omitted = self.omitted.saturating_add(1);
            return;
        }
        if self.session.as_ref() != Some(&record.session_id) {
            return;
        }
        let attribute_count = record.attributes.len();
        let mut admitted = 0;
        record.attributes.retain(|key, value| {
            let safe =
                admitted < 9 && token(key, 16) && reviewed_scalar(value, &attribute_rules()[key]);
            if safe {
                admitted += 1;
            }
            safe
        });
        if record.attributes.len() != attribute_count {
            self.omitted = self.omitted.saturating_add(1);
        }
        record.bytes = bytes.len();
        while self.records.len() >= RECORDS || self.bytes + record.bytes > BUFFER_BYTES {
            if let Some(old) = self.records.pop_front() {
                self.bytes -= old.bytes;
                self.evicted = self.evicted.saturating_add(1);
            } else {
                break;
            }
        }
        self.bytes += record.bytes;
        self.records.push_back(record);
    }
    pub fn visible(&self) -> Vec<&Record> {
        self.records
            .iter()
            .filter(|r| {
                LEVELS.iter().position(|l| *l == r.level).unwrap_or(0) >= self.level
                    && self.category.as_ref().is_none_or(|c| c == &r.category)
                    && self
                        .trace
                        .as_ref()
                        .is_none_or(|t| r.context.as_ref().is_some_and(|c| &c.trace_id == t))
            })
            .collect()
    }
    pub fn cycle_level(&mut self) {
        self.level = (self.level + 1) % LEVELS.len();
    }
    pub fn level_label(&self) -> &'static str {
        LEVELS[self.level]
    }
    pub fn cycle_category(&mut self) {
        let mut values: Vec<_> = self.records.iter().map(|r| r.category.clone()).collect();
        values.sort();
        values.dedup();
        self.category = next_value(&values, self.category.as_ref());
    }
    pub fn cycle_trace(&mut self) {
        let mut values: Vec<_> = self
            .records
            .iter()
            .filter_map(|r| r.context.as_ref().map(|c| c.trace_id.clone()))
            .collect();
        values.sort();
        values.dedup();
        self.trace = next_value(&values, self.trace.as_ref());
    }
}
fn next_value(values: &[String], current: Option<&String>) -> Option<String> {
    let index = current
        .and_then(|c| values.iter().position(|v| v == c))
        .map_or(0, |i| i + 1);
    values.get(index).cloned()
}
fn open_read(path: &Path) -> io::Result<File> {
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("not a regular file"));
    }
    Ok(file)
}
fn read_bounded(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    open_read(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::other("oversized discovery metadata"));
    }
    Ok(bytes)
}
