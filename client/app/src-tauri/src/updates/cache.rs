use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const ERROR: &str = "native.updates.cacheFailed";

#[derive(Clone, Serialize, Deserialize)]
pub struct Record {
    pub version: String,
    pub release: Value,
    slot: String,
}

pub struct Cache {
    root: PathBuf,
    _lock: File,
}
impl Cache {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|_| ERROR)?;
        let metadata = fs::symlink_metadata(&root).map_err(|_| ERROR)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(ERROR.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(|_| ERROR)?;
            let lock = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(root.join("owner.lock"))
                .map_err(|_| ERROR)?;
            lock.try_lock().map_err(|_| "native.updates.busy")?;
            Ok(Self { root, _lock: lock })
        }
        #[cfg(not(unix))]
        {
            let lock = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(root.join("owner.lock"))
                .map_err(|_| ERROR)?;
            lock.try_lock().map_err(|_| "native.updates.busy")?;
            Ok(Self { root, _lock: lock })
        }
    }
    pub fn last_check(&self) -> Option<u64> {
        fs::read(self.root.join("check.json"))
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
    }
    pub fn save_check(&self, time: u64) -> Result<(), String> {
        self.atomic("check.json", &time)
    }
    pub fn pending(&self) -> Result<Option<Value>, String> {
        match fs::read(self.root.join("download.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| ERROR.into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(ERROR.into()),
        }
    }
    pub fn save_pending(&self, release: &Value) -> Result<(), String> {
        self.atomic("download.json", release)
    }
    pub fn clear_pending(&self) -> Result<(), String> {
        self.remove("download.json")
    }
    pub fn record(&self) -> Result<Option<Record>, String> {
        let bytes = match fs::read(self.root.join("verified.json")) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ERROR.into()),
        };
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
        if !["a.package", "b.package"].contains(&record.slot.as_str()) {
            return Err(ERROR.into());
        }
        Ok(Some(record))
    }
    pub fn read(&self, record: &Record) -> Result<Vec<u8>, String> {
        if !["a.package", "b.package"].contains(&record.slot.as_str()) {
            return Err(ERROR.into());
        }
        let path = self.root.join(&record.slot);
        if !fs::symlink_metadata(&path).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink()) {
            return Err(ERROR.into());
        }
        fs::read(path).map_err(|_| ERROR.into())
    }
    pub fn retain(&self, version: String, release: Value, bytes: &[u8]) -> Result<(), String> {
        let previous = self.record()?;
        let slot = if previous.as_ref().is_some_and(|r| r.slot == "a.package") {
            "b.package"
        } else {
            "a.package"
        };
        let record = Record {
            version,
            release,
            slot: slot.into(),
        };
        // Bytes have already been verified. Publish the pointer only after the candidate is durable.
        self.atomic_bytes(slot, bytes)?;
        self.atomic("verified.json", &record)?;
        self.clean_candidates(Some(&record))
    }
    pub fn clean_candidates(&self, retained: Option<&Record>) -> Result<(), String> {
        for name in ["a.package", "b.package", "candidate"] {
            if retained.is_none_or(|r| r.slot != name) {
                self.remove(name)?;
            }
        }
        Ok(())
    }
    pub fn clear(&self) -> Result<(), String> {
        self.remove("verified.json")?;
        self.clean_candidates(None)
    }
    pub fn interrupted(&self) -> bool {
        self.root.join("installing.json").exists()
    }
    pub fn mark_installing(&self, version: &str) -> Result<(), String> {
        self.atomic("installing.json", &version)
    }
    pub fn clear_installing(&self) -> Result<(), String> {
        self.remove("installing.json")
    }
    fn remove(&self, name: &str) -> Result<(), String> {
        match fs::remove_file(self.root.join(name)) {
            Ok(()) => File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| ERROR.into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(ERROR.into()),
        }
    }
    fn atomic(&self, name: &str, value: &impl Serialize) -> Result<(), String> {
        self.atomic_bytes(name, &serde_json::to_vec(value).map_err(|_| ERROR)?)
    }
    fn atomic_bytes(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        let candidate = self.root.join("candidate");
        #[cfg(unix)]
        let mut file = {
            use std::os::unix::fs::OpenOptionsExt;
            OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&candidate)
                .map_err(|_| ERROR)?
        };
        #[cfg(not(unix))]
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&candidate)
            .map_err(|_| ERROR)?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| ERROR)?;
        fs::rename(candidate, self.root.join(name)).map_err(|_| ERROR)?;
        File::open(&self.root)
            .and_then(|f| f.sync_all())
            .map_err(|_| ERROR.into())
    }
}

pub fn bundle_path(executable: &Path) -> Result<PathBuf, String> {
    executable
        .ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .map(Path::to_path_buf)
        .ok_or_else(|| "native.updates.installFailed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_survives_restart_and_excludes_another_owner() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path().join("updates")).unwrap();
        assert!(Cache::open(dir.path().join("updates")).is_err());
        cache.save_check(1234).unwrap();
        cache
            .retain(
                "1.0.0".into(),
                serde_json::json!({"version":"1.0.0"}),
                b"first",
            )
            .unwrap();
        let record = cache.record().unwrap().unwrap();
        assert_eq!(cache.read(&record).unwrap(), b"first");
        drop(cache);
        let cache = Cache::open(dir.path().join("updates")).unwrap();
        assert_eq!(cache.last_check(), Some(1234));
        assert_eq!(
            cache.read(&cache.record().unwrap().unwrap()).unwrap(),
            b"first"
        );
        cache
            .retain(
                "2.0.0".into(),
                serde_json::json!({"version":"2.0.0"}),
                b"second",
            )
            .unwrap();
        assert!(!cache.root.join(record.slot).exists());
        assert_eq!(
            cache.read(&cache.record().unwrap().unwrap()).unwrap(),
            b"second"
        );
        cache.mark_installing("2.0.0").unwrap();
        assert!(cache.interrupted());
        cache.clear().unwrap();
        assert!(cache.record().unwrap().is_none());
        cache.clear_installing().unwrap();
        assert!(!cache.interrupted());
    }
    #[test]
    fn uncommitted_candidate_does_not_replace_retained_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path().into()).unwrap();
        cache
            .retain("1.0.0".into(), Value::Null, b"verified")
            .unwrap();
        fs::write(dir.path().join("b.package"), b"incomplete").unwrap();
        let record = cache.record().unwrap().unwrap();
        cache.clean_candidates(Some(&record)).unwrap();
        assert_eq!(cache.read(&record).unwrap(), b"verified");
        assert!(!dir.path().join("b.package").exists());
    }
    #[test]
    fn failed_candidate_write_preserves_verified_package_and_success_time() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path().into()).unwrap();
        cache.save_check(9876).unwrap();
        cache
            .retain("1.0.0".into(), Value::Null, b"verified")
            .unwrap();
        fs::create_dir(dir.path().join("candidate")).unwrap();
        assert!(
            cache
                .retain("2.0.0".into(), Value::Null, b"replacement")
                .is_err()
        );
        assert_eq!(cache.record().unwrap().unwrap().version, "1.0.0");
        assert_eq!(
            cache.read(&cache.record().unwrap().unwrap()).unwrap(),
            b"verified"
        );
        assert_eq!(cache.last_check(), Some(9876));
    }
    #[test]
    fn metadata_cannot_select_arbitrary_paths() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path().into()).unwrap();
        fs::write(
            dir.path().join("verified.json"),
            br#"{"version":"9.0.0","release":null,"slot":"../private"}"#,
        )
        .unwrap();
        assert!(cache.record().is_err());
    }
}
