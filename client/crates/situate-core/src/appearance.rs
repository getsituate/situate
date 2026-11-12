use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1collisiondetection::Sha1CD;
use std::{
    io::{Read, Write},
    path::{Component, Path},
};

#[cfg(test)]
mod tests;

const FILE: &str = "appearance.json";
const STORAGE: &str = "native.appearance.storage";
const INVALID: &str = "native.appearance.invalid";
const LIMIT: u64 = 65_536;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Accent {
    Violet,
    Cobalt,
    Sky,
    Tangerine,
    Peach,
    Lemon,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Snapshot {
    pub accent: Accent,
    pub writable: bool,
    pub revision: Option<String>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            accent: Accent::Violet,
            writable: false,
            revision: None,
        }
    }
}

pub struct Storage {
    dir: Dir,
}
impl Storage {
    pub fn open(root: &Path) -> Result<Self, String> {
        if !root.is_absolute() {
            return Err(STORAGE.into());
        }
        let mut components = root.components();
        let mut anchor = std::path::PathBuf::new();
        if let Some(Component::Prefix(prefix)) = components.clone().next() {
            anchor.push(prefix.as_os_str());
            components.next();
        }
        if components.next() != Some(Component::RootDir) {
            return Err(STORAGE.into());
        }
        anchor.push(std::path::MAIN_SEPARATOR.to_string());
        let mut dir = Dir::open_ambient_dir(anchor, ambient_authority()).map_err(|_| STORAGE)?;
        for component in components.chain([Component::Normal(std::ffi::OsStr::new(".situate"))]) {
            let Component::Normal(name) = component else {
                return Err(STORAGE.into());
            };
            dir = cap_primitives::fs::open_dir_nofollow(&dir.into_std_file(), Path::new(name))
                .map(Dir::from_std_file)
                .map_err(|_| STORAGE)?;
        }
        Ok(Self { dir })
    }
    pub fn bytes(&self) -> Result<Option<Vec<u8>>, String> {
        match self.dir.symlink_metadata(FILE) {
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => return Err(STORAGE.into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(STORAGE.into()),
        }
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NONBLOCK);
        }
        let file = match self.dir.open_with(FILE, &options) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(STORAGE.into()),
        };
        if !file.metadata().map_err(|_| STORAGE)?.is_file() {
            return Err(STORAGE.into());
        }
        let mut bytes = Vec::new();
        file.take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| STORAGE)?;
        if bytes.len() as u64 > LIMIT {
            return Err(INVALID.into());
        }
        Ok(Some(bytes))
    }
    fn lock(&self) -> Result<std::fs::File, String> {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .follow(FollowSymlinks::No);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NONBLOCK);
        }
        let file = self
            .dir
            .open_with("appearance.lock", &options)
            .map_err(|_| STORAGE)?
            .into_std();
        if !file.metadata().map_err(|_| STORAGE)?.is_file() {
            return Err(STORAGE.into());
        }
        file.try_lock().map_err(|_| "native.appearance.busy")?;
        Ok(file)
    }
    pub fn writable(&self) -> bool {
        let directory = self
            .dir
            .dir_metadata()
            .is_ok_and(|m| !m.permissions().readonly());
        let file = match self.dir.symlink_metadata(FILE) {
            Ok(m) => m.is_file() && !m.permissions().readonly(),
            Err(e) => e.kind() == std::io::ErrorKind::NotFound,
        };
        directory && file
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let (_, mut snapshot) = decode(self.bytes()?.as_deref())?;
        snapshot.writable = self.writable();
        Ok(snapshot)
    }
    pub fn update(
        &self,
        accent: Accent,
        expected_revision: Option<&str>,
    ) -> Result<Snapshot, String> {
        if !self.writable() {
            return Err("native.appearance.readOnly".into());
        }
        let _lock = self.lock()?;
        let original = self.bytes()?;
        let (mut document, current) = decode(original.as_deref())?;
        if current.revision.as_deref() != expected_revision {
            return Err("native.appearance.changed".into());
        }
        document["accent"] = json!(accent);
        document["generation"] = json!(uuid::Uuid::new_v4().to_string());
        let bytes = serde_json::to_vec_pretty(&document).map_err(|_| STORAGE)?;
        let (_, mut saved) = decode(Some(&bytes))?;
        self.save(&bytes, original.as_deref())?;
        saved.writable = self.writable();
        Ok(saved)
    }
    fn save(&self, bytes: &[u8], expected: Option<&[u8]>) -> Result<(), String> {
        if bytes.len() as u64 > LIMIT {
            return Err(INVALID.into());
        }
        let temp = format!("appearance-{}.tmp", uuid::Uuid::new_v4());
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
        let mut file = self.dir.open_with(&temp, &options).map_err(|_| STORAGE)?;
        let result = (|| {
            file.write_all(bytes).map_err(|_| STORAGE)?;
            file.sync_all().map_err(|_| STORAGE)?;
            if self.bytes()?.as_deref() != expected {
                return Err("native.appearance.changed".into());
            }
            self.dir
                .rename(&temp, &self.dir, FILE)
                .map_err(|_| STORAGE)?;
            crate::durable_storage::sync_directory(&self.dir)
                .map_err(|_| "native.appearance.durability")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = self.dir.remove_file(&temp);
        }
        result
    }
}

pub fn decode(bytes: Option<&[u8]>) -> Result<(Value, Snapshot), String> {
    let Some(bytes) = bytes else {
        return Ok((json!({"version":1,"accent":"violet"}), Snapshot::default()));
    };
    if bytes.len() as u64 > LIMIT {
        return Err(INVALID.into());
    }
    let document: Value = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if document.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(INVALID.into());
    }
    let accent = serde_json::from_value(document["accent"].clone()).map_err(|_| INVALID)?;
    let mut hash = Sha1CD::default();
    hash.update(bytes);
    let digest = hash.finalize_cd().map_err(|_| INVALID)?;
    let revision = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok((
        document,
        Snapshot {
            accent,
            writable: false,
            revision: Some(revision),
        },
    ))
}
