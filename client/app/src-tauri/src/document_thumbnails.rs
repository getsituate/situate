use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime},
};
use tauri::{Emitter, Manager};

const BUDGET: u64 = 128 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;
const MAX_IMAGE: u64 = 256 * 1024;
const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const UNAVAILABLE: &str = "native.plugins.unavailable";

#[derive(Default)]
pub(crate) struct Thumbnails(Mutex<Option<Cache>>);

struct Cache {
    directory: PathBuf,
    _lock: File,
    entries: HashMap<String, Entry>,
    scopes: HashMap<String, String>,
    size: u64,
    epoch: u64,
    budget: u64,
}

struct Entry {
    bytes: u64,
    used: SystemTime,
}

fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value))[..32].to_owned()
}

fn plugin_prefix(workspace: &str, plugin: &str) -> String {
    format!("{}-{}-", hash(workspace), hash(plugin))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Source {
    plugin_id: String,
    incarnation: String,
    instance_id: String,
    scope_id: String,
}

impl Source {
    fn prefix(&self, workspace: &str) -> String {
        format!(
            "{}{}-",
            plugin_prefix(workspace, &self.plugin_id),
            hash(&format!(
                "{}:{}:{}",
                hash(&self.incarnation),
                hash(&self.instance_id),
                hash(&self.scope_id)
            )),
        )
    }

    fn document(&self, workspace: &str, id: &str) -> String {
        format!("{}{}-", self.prefix(workspace), hash(id))
    }

    fn key(&self, workspace: &str, id: &str, revision: &str) -> String {
        format!("{}{}.jpg", self.document(workspace, id), hash(revision))
    }

    fn valid(&self) -> bool {
        valid(&self.plugin_id, 64)
            && valid(&self.incarnation, 128)
            && valid(&self.instance_id, 4096)
            && valid(&self.scope_id, 4096)
    }
}

fn valid(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    Reconcile {
        source: Source,
    },
    Lookup {
        source: Source,
        id: String,
        revision: String,
    },
    Store {
        source: Source,
        id: String,
        revision: String,
        epoch: String,
        jpeg: String,
    },
    Forget {
        source: Source,
        id: String,
    },
}

#[derive(Serialize)]
pub(crate) struct Lookup {
    epoch: String,
    jpeg: Option<String>,
}

impl Cache {
    fn open(directory: PathBuf, budget: u64, now: SystemTime) -> io::Result<Self> {
        fs::create_dir_all(&directory)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.with_extension("lock"))?;
        lock.try_lock().map_err(io::Error::other)?;
        let mut cache = Self {
            directory,
            _lock: lock,
            entries: HashMap::new(),
            scopes: HashMap::new(),
            size: 0,
            epoch: 0,
            budget,
        };
        for item in fs::read_dir(&cache.directory)? {
            let item = item?;
            let kind = item.file_type()?;
            if kind.is_dir() {
                continue;
            }
            let name = item.file_name().into_string().unwrap_or_default();
            let valid_name = name.strip_suffix(".jpg").is_some_and(|key| {
                key.split('-').count() == 5
                    && key
                        .split('-')
                        .all(|part| part.len() == 32 && part.bytes().all(|b| b.is_ascii_hexdigit()))
            });
            if kind.is_file() && valid_name {
                let metadata = item.metadata()?;
                if metadata.len() > MAX_IMAGE {
                    fs::remove_file(item.path())?;
                    continue;
                }
                cache.size += metadata.len();
                cache.entries.insert(
                    name,
                    Entry {
                        bytes: metadata.len(),
                        used: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    },
                );
            } else {
                fs::remove_file(item.path())?;
            }
        }
        cache.trim(now, 0)?;
        Ok(cache)
    }

    fn remove(&mut self, key: &str) -> io::Result<()> {
        match fs::remove_file(self.directory.join(key)) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
        if let Some(entry) = self.entries.remove(key) {
            self.size -= entry.bytes;
        }
        Ok(())
    }

    fn trim(&mut self, now: SystemTime, incoming: u64) -> io::Result<()> {
        let count = self.entries.len() + usize::from(incoming != 0);
        let mut entries = self
            .entries
            .iter()
            .map(|(key, entry)| (entry.used, key.clone()))
            .collect::<Vec<_>>();
        entries.sort_unstable();
        for (index, (used, key)) in entries.into_iter().enumerate() {
            if self.size + incoming <= self.budget
                && count - index <= MAX_ENTRIES
                && !expired(used, now)
            {
                break;
            }
            self.remove(&key)?;
        }
        Ok(())
    }

    fn reconcile(&mut self, workspace: &str, source: &Source) -> io::Result<()> {
        let plugin = plugin_prefix(workspace, &source.plugin_id);
        let current = source.prefix(workspace);
        if self.scopes.get(&plugin) == Some(&current) {
            return Ok(());
        }
        self.forget(|key| key.starts_with(&plugin) && !key.starts_with(&current))?;
        if self.scopes.len() >= MAX_ENTRIES {
            self.scopes.clear();
        }
        self.scopes.insert(plugin, current);
        Ok(())
    }

    fn retain_sources<'a>(
        &mut self,
        scope: &str,
        enabled: impl Iterator<Item = &'a str>,
    ) -> io::Result<()> {
        let workspace = format!("{}-", hash(scope));
        let enabled: HashSet<_> = enabled.map(hash).collect();
        let removed = |key: &str| {
            key.starts_with(&workspace)
                && key
                    .split('-')
                    .nth(1)
                    .is_some_and(|plugin| !enabled.contains(plugin))
        };
        let before = self.scopes.len();
        self.scopes.retain(|key, _| !removed(key));
        if self.scopes.len() != before || self.entries.keys().any(|key| removed(key)) {
            self.forget(removed)?;
        }
        Ok(())
    }

    fn active(&self, workspace: &str, source: &Source) -> bool {
        self.scopes
            .get(&plugin_prefix(workspace, &source.plugin_id))
            == Some(&source.prefix(workspace))
    }

    fn forget(&mut self, matches: impl Fn(&str) -> bool) -> io::Result<()> {
        self.epoch += 1;
        let mut result = Ok(());
        for key in self
            .entries
            .keys()
            .filter(|key| matches(key))
            .cloned()
            .collect::<Vec<_>>()
        {
            if let Err(error) = self.remove(&key) {
                result = Err(error);
            }
        }
        result
    }

    fn lookup(&mut self, key: &str, now: SystemTime) -> io::Result<Lookup> {
        let mut reply = Lookup {
            epoch: self.epoch.to_string(),
            jpeg: None,
        };
        let Some(entry) = self.entries.get_mut(key) else {
            return Ok(reply);
        };
        if !expired(entry.used, now)
            && entry.bytes <= MAX_IMAGE
            && let Ok(file) = OpenOptions::new()
                .read(true)
                .write(true)
                .open(self.directory.join(key))
        {
            let mut bytes = Vec::new();
            (&file).take(MAX_IMAGE + 1).read_to_end(&mut bytes)?;
            if is_jpeg(&bytes) {
                // Windows requires write access to update the last-use timestamp.
                file.set_modified(now)?;
                entry.used = now;
                reply.jpeg = Some(STANDARD.encode(bytes));
                return Ok(reply);
            }
        }
        self.remove(key)?;
        Ok(reply)
    }

    fn store(&mut self, key: String, epoch: &str, bytes: &[u8], now: SystemTime) -> io::Result<()> {
        if epoch != self.epoch.to_string() || !is_jpeg(bytes) || bytes.len() as u64 > self.budget {
            return Ok(());
        }
        self.remove(&key)?;
        self.trim(now, bytes.len() as u64)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        temporary.write_all(bytes)?;
        temporary.as_file().set_modified(now)?;
        temporary.persist(self.directory.join(&key))?;
        self.entries.insert(
            key,
            Entry {
                bytes: bytes.len() as u64,
                used: now,
            },
        );
        self.size += bytes.len() as u64;
        Ok(())
    }
}

fn expired(used: SystemTime, now: SystemTime) -> bool {
    now.duration_since(used).unwrap_or_default() >= RETENTION
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.len() as u64 <= MAX_IMAGE
        && bytes.starts_with(&[0xff, 0xd8, 0xff])
        && bytes.ends_with(&[0xff, 0xd9])
}

impl Thumbnails {
    fn with<T>(
        &self,
        app: &tauri::AppHandle,
        f: impl FnOnce(&mut Cache) -> io::Result<T>,
    ) -> Result<T, String> {
        let mut state = self.0.lock().map_err(|_| UNAVAILABLE)?;
        if state.is_none() {
            let path = app.path().app_cache_dir().map_err(|_| UNAVAILABLE)?;
            *state = Some(
                Cache::open(
                    path.join("document-thumbnails-v1"),
                    BUDGET,
                    SystemTime::now(),
                )
                .map_err(|_| UNAVAILABLE)?,
            );
        }
        f(state.as_mut().ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE.into())
    }
}

pub(crate) fn setup(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app.state::<Thumbnails>().with(&app, |_| Ok(()));
    });
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Invalidation<'a> {
    scope: &'a str,
    plugin_id: &'a str,
    document: Option<DocumentInvalidation<'a>>,
}

#[derive(Clone, Serialize)]
struct DocumentInvalidation<'a> {
    source: &'a Source,
    id: &'a str,
}

fn notify(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    plugin_id: &str,
    document: Option<DocumentInvalidation<'_>>,
) {
    let _ = app.emit_to(
        window,
        "document-thumbnails-invalidated",
        Invalidation {
            scope,
            plugin_id,
            document,
        },
    );
}

pub(crate) fn retain_sources(
    app: &tauri::AppHandle,
    scope: &str,
    listing: &situate_core::plugins::runtime::Listing,
) {
    if let Some(state) = app.try_state::<Thumbnails>() {
        let _ = state.with(app, |cache| {
            cache.retain_sources(
                scope,
                listing
                    .plugins
                    .iter()
                    .filter(|plugin| plugin.enabled)
                    .map(|plugin| plugin.id.as_str()),
            )
        });
    }
}

pub(crate) fn forget_source(app: &tauri::AppHandle, window: &str, scope: &str, plugin_id: &str) {
    if let Some(state) = app.try_state::<Thumbnails>() {
        let prefix = plugin_prefix(scope, plugin_id);
        let affected = state.with(app, |cache| {
            let affected = cache.scopes.remove(&prefix).is_some()
                || cache.entries.keys().any(|key| key.starts_with(&prefix));
            if affected {
                cache.forget(|key| key.starts_with(&prefix))?;
            }
            Ok(affected)
        });
        if affected != Ok(false) {
            notify(app, window, scope, plugin_id, None);
        }
    }
}

#[tauri::command]
pub(crate) async fn document_thumbnail(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: Request,
) -> Result<Option<Lookup>, String> {
    let window = window.label().to_owned();
    let session = crate::workspaces::authorization_session(&app, &window, &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_authorization_session(&app, &window, &session, |_| {
            let state = app.state::<Thumbnails>();
            let source = match &request {
                Request::Reconcile { source }
                | Request::Lookup { source, .. }
                | Request::Store { source, .. }
                | Request::Forget { source, .. } => source,
            };
            if !source.valid() {
                return Err(UNAVAILABLE.into());
            }
            let now = SystemTime::now();
            state.with(&app, |cache| {
                match request {
                    Request::Reconcile { source } => {
                        cache.reconcile(&scope, &source)?;
                    }
                    Request::Lookup {
                        source,
                        id,
                        revision,
                    } if valid(&id, 4096)
                        && valid(&revision, 4105)
                        && cache.active(&scope, &source) =>
                    {
                        return cache
                            .lookup(&source.key(&scope, &id, &revision), now)
                            .map(Some);
                    }
                    Request::Store {
                        source,
                        id,
                        revision,
                        epoch,
                        jpeg,
                    } if valid(&id, 4096)
                        && valid(&revision, 4105)
                        && cache.active(&scope, &source)
                        && jpeg.len() <= (MAX_IMAGE as usize).div_ceil(3) * 4 =>
                    {
                        if let Ok(bytes) = STANDARD.decode(jpeg) {
                            cache.store(source.key(&scope, &id, &revision), &epoch, &bytes, now)?;
                        }
                    }
                    Request::Forget { source, id } if valid(&id, 4096) => {
                        let prefix = source.document(&scope, &id);
                        let result = cache.forget(|key| key.starts_with(&prefix));
                        notify(
                            &app,
                            &window,
                            &scope,
                            &source.plugin_id,
                            Some(DocumentInvalidation {
                                source: &source,
                                id: &id,
                            }),
                        );
                        result?;
                    }
                    _ => return Err(io::Error::from(io::ErrorKind::InvalidInput)),
                }
                Ok(None)
            })
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const IMAGE: &[u8] = &[0xff, 0xd8, 0xff, 0x42, 0xff, 0xd9];

    fn source() -> Source {
        Source {
            plugin_id: "source".into(),
            incarnation: "installed".into(),
            instance_id: "account".into(),
            scope_id: "scope".into(),
        }
    }

    #[test]
    fn reopens_previews_and_evicts_the_least_recently_used_across_workspaces() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("cache");
        let now = SystemTime::now();
        let later = now + Duration::from_secs(10);
        let mut cache = Cache::open(dir.clone(), 12, now).unwrap();
        let first = source().key("one", "42", "r1");
        let second = source().key("two", "42", "r1");
        let third = source().key("three", "42", "r1");
        cache.store(first.clone(), "0", IMAGE, now).unwrap();
        cache.store(second.clone(), "0", IMAGE, later).unwrap();
        drop(cache);
        let mut cache = Cache::open(dir.clone(), 12, later).unwrap();
        assert_eq!(
            cache
                .lookup(&first, later + Duration::from_secs(1))
                .unwrap()
                .jpeg,
            Some("/9j/Qv/Z".into())
        );
        assert!(
            cache
                .lookup(&source().key("one", "42", "r2"), later)
                .unwrap()
                .jpeg
                .is_none()
        );
        cache
            .store(third.clone(), "0", IMAGE, later + Duration::from_secs(2))
            .unwrap();
        assert!(dir.join(first).is_file());
        assert!(!dir.join(second).exists());
        assert!(dir.join(third).is_file());
        assert_eq!(cache.size, 12);
    }

    #[test]
    fn new_scope_and_removed_source_purge_only_the_affected_workspace() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("cache");
        let now = SystemTime::now();
        let mut cache = Cache::open(dir.clone(), BUDGET, now).unwrap();
        let mut source = source();
        cache.reconcile("one", &source).unwrap();
        cache.reconcile("two", &source).unwrap();
        let old_scope = source.key("one", "42", "r1");
        let other_workspace = source.key("two", "42", "r1");
        let epoch = cache.lookup(&old_scope, now).unwrap().epoch;
        cache.store(old_scope.clone(), &epoch, IMAGE, now).unwrap();
        cache
            .store(other_workspace.clone(), &epoch, IMAGE, now)
            .unwrap();
        source.scope_id = "restricted".into();
        cache.reconcile("one", &source).unwrap();
        cache.store(old_scope.clone(), &epoch, IMAGE, now).unwrap();
        assert!(!dir.join(old_scope).exists());
        assert!(dir.join(other_workspace).is_file());
        let key = source.key("one", "42", "r1");
        let epoch = cache.lookup(&key, now).unwrap().epoch;
        cache.store(key.clone(), &epoch, IMAGE, now).unwrap();
        cache.retain_sources("one", std::iter::empty()).unwrap();
        assert!(!cache.active("one", &source));
        assert!(!dir.join(key).exists());
    }

    #[test]
    fn startup_clears_expired_and_interrupted_writes_and_forget_fences_stale_stores() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("cache");
        let now = SystemTime::now();
        let mut cache = Cache::open(dir.clone(), BUDGET, now).unwrap();
        let source = source();
        let key = source.key("one", "42", "r1");
        let other = source.key("two", "42", "r1");
        cache.store(key.clone(), "0", IMAGE, now).unwrap();
        cache.store(other.clone(), "0", IMAGE, now).unwrap();
        let epoch = cache.lookup(&key, now).unwrap().epoch;
        cache
            .forget(|key| key.starts_with(&source.document("one", "42")))
            .unwrap();
        cache.store(key.clone(), &epoch, IMAGE, now).unwrap();
        assert!(!dir.join(key).exists());
        assert!(dir.join(other).is_file());
        drop(cache);
        fs::write(dir.join(".tmp-incomplete"), IMAGE).unwrap();
        Cache::open(dir.clone(), BUDGET, now + RETENTION).unwrap();
        assert_eq!(fs::read_dir(dir).unwrap().count(), 0);
    }
}
