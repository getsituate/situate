use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use chacha20poly1305::{
    XChaCha20Poly1305,
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Component, Path},
};
use zeroize::Zeroizing;

#[path = "ai_connections.rs"]
pub mod connections;

const FILE: &str = "ai-connection.json";
const ERROR: &str = "native.ai.storage.failed";
const LOCKED: &str = "native.ai.storage.locked";

pub trait KeyStore {
    fn get(&self, account: &str) -> Result<Vec<u8>, String>;
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u8,
    key_id: String,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

/// Shares rebuildable lookup hints without retaining workspace access or execution state.
#[derive(Clone, Default)]
pub struct ConversationCache {
    indexes: std::sync::Arc<
        std::sync::Mutex<
            std::collections::HashMap<String, crate::conversation_history::HistoryIndex>,
        >,
    >,
}

pub struct Storage {
    pub(crate) dir: Dir,
    pub(crate) scope: String,
    pub(crate) conversation_indexes: std::sync::Arc<
        std::sync::Mutex<
            std::collections::HashMap<String, crate::conversation_history::HistoryIndex>,
        >,
    >,
    location: std::path::PathBuf,
    device: Option<Box<Storage>>,
    access_guard: Option<Box<dyn Send + Sync>>,
}

#[derive(Debug)]
pub struct StorageLock(pub(crate) std::fs::File);
impl Drop for StorageLock {
    fn drop(&mut self) {
        // Closing alone leaves flock held by unrelated forked children until exec.
        // Release ownership explicitly before closing the shared file description.
        let _ = self.0.unlock();
    }
}
impl Storage {
    pub fn open(path: &Path, scope: &str) -> Result<Self, String> {
        let (root, components) = storage_root(path)?;
        let mut dir = Dir::open_ambient_dir(root, ambient_authority()).map_err(|_| ERROR)?;
        for component in components.chain([Component::Normal(std::ffi::OsStr::new(".situate"))]) {
            match component {
                Component::Normal(name) => {
                    dir = cap_primitives::fs::open_dir_nofollow(
                        &dir.into_std_file(),
                        Path::new(name),
                    )
                    .map(Dir::from_std_file)
                    .map_err(|_| ERROR)?;
                }
                _ => return Err(ERROR.into()),
            }
        }
        Ok(Self {
            dir,
            scope: scope.into(),
            conversation_indexes: Default::default(),
            location: path.to_owned(),
            device: None,
            access_guard: None,
        })
    }
    pub fn with_conversation_cache(mut self, cache: ConversationCache) -> Self {
        self.conversation_indexes = cache.indexes;
        self
    }
    pub fn with_access_guard(mut self, guard: impl Send + Sync + 'static) -> Self {
        self.access_guard = Some(Box::new(guard));
        self
    }
    /// Hold the returned file across credential read, provider refresh and durable save.
    /// Contention fails rather than replaying a rotating token from a stale read.
    pub fn lock_credentials(&self) -> Result<StorageLock, String> {
        match &self.device {
            Some(_) => self.lock_device_credentials(),
            None => self.lock_named("ai-connection.lock"),
        }
    }
    fn lock_file(&self, name: &str) -> Result<std::fs::File, String> {
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
            .open_with(name, &options)
            .map_err(|_| ERROR)?
            .into_std();
        if !file.metadata().map_err(|_| ERROR)?.is_file() {
            return Err(ERROR.into());
        }
        Ok(file)
    }
    pub(crate) fn lock_named(&self, name: &str) -> Result<StorageLock, String> {
        let file = self.lock_file(name)?;
        file.try_lock()
            .map_err(|_| "native.ai.storage.busy".to_owned())?;
        Ok(StorageLock(file))
    }
    pub(crate) fn lock_named_shared(&self, name: &str) -> Result<StorageLock, String> {
        let file = self.lock_file(name)?;
        file.try_lock_shared()
            .map_err(|_| "native.ai.storage.busy".to_owned())?;
        Ok(StorageLock(file))
    }
    pub fn read_model(&self) -> Result<Option<Vec<u8>>, String> {
        if self.device.is_some() {
            return self.read_workspace_preference("chat-model", 4096);
        }
        self.read_named("chat-model.json", 4096)
    }
    pub fn save_model(&self, data: &[u8]) -> Result<(), String> {
        if data.len() > 4096 {
            return Err("native.ai.model.preferenceTooLarge".into());
        }
        if self.device.is_some() {
            return self.save_workspace_preference("chat-model", data);
        }
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let id: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        if !self.replace("chat-model.json", &format!("chat-model-{id}.tmp"), data)? {
            return Err("native.ai.model.durability".into());
        }
        Ok(())
    }
    fn read_file(&self) -> Result<Option<Vec<u8>>, String> {
        self.read_named(FILE, 262_144)
    }
    pub fn read_settings(&self) -> Result<Option<Vec<u8>>, String> {
        if self.device.is_some() {
            return self.read_workspace_preference("ai-settings", 65_536);
        }
        self.read_named("ai-settings.json", 64 * 1024)
    }

    pub fn save_settings(&self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > 64 * 1024 {
            return Err("native.ai.storage.failed".into());
        }
        if self.device.is_some() {
            return self.save_workspace_preference("ai-settings", bytes);
        }
        let _lock = self.lock_named("ai-settings.lock")?;
        if !self.replace("ai-settings.json", "ai-settings.tmp", bytes)? {
            return Err("native.ai.conversation.durability".into());
        }
        Ok(())
    }

    pub(crate) fn read_named(&self, name: &str, limit: u64) -> Result<Option<Vec<u8>>, String> {
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NONBLOCK);
        }
        let file = match self.dir.open_with(name, &options) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ERROR.into()),
        };
        if !file.metadata().map_err(|_| ERROR)?.is_file() {
            return Err(ERROR.into());
        }
        let mut bytes = Vec::new();
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ERROR)?;
        if bytes.len() as u64 > limit {
            return Err(ERROR.into());
        }
        Ok(Some(bytes))
    }
    pub fn load(&self, keys: &impl KeyStore) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        if self.device.is_some() {
            return self.load_selected_connection(keys);
        }
        let Some(bytes) = self.read_file()? else {
            return Ok(None);
        };
        let envelope: Envelope = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
        if envelope.version != 1 || envelope.nonce.len() != 24 || envelope.key_id.len() != 48 {
            return Err(ERROR.into());
        }
        let key = Zeroizing::new(
            keys.get(&self.account(&envelope.key_id))
                .map_err(|_| LOCKED)?,
        );
        let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| LOCKED)?;
        cipher
            .decrypt(
                envelope.nonce.as_slice().into(),
                Payload {
                    msg: &envelope.ciphertext,
                    aad: self.scope.as_bytes(),
                },
            )
            .map(Zeroizing::new)
            .map(Some)
            .map_err(|_| LOCKED.into())
    }
    fn account(&self, id: &str) -> String {
        format!("{}:{id}", self.scope)
    }
    pub fn save(&self, keys: &impl KeyStore, data: &[u8]) -> Result<(), String> {
        if self.device.is_some() {
            return self.refresh_selected_connection(keys, data);
        }
        if data.len() > 65_536 {
            return Err(ERROR.into());
        }
        // A fresh key keeps a failed replacement from invalidating the previous envelope.
        let old = self
            .read_file()?
            .and_then(|bytes| serde_json::from_slice::<Envelope>(&bytes).ok());
        let key = Zeroizing::new(XChaCha20Poly1305::generate_key(&mut OsRng).to_vec());
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let key_id: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        if let Err(error) = keys.set(&self.account(&key_id), &key) {
            let _ = keys.delete(&self.account(&key_id));
            return Err(error);
        }
        let recovered = keys.get(&self.account(&key_id)).map(Zeroizing::new);
        if !recovered.is_ok_and(|value| *value == *key) {
            let _ = keys.delete(&self.account(&key_id));
            return Err(LOCKED.into());
        }
        let ciphertext = XChaCha20Poly1305::new_from_slice(&key)
            .map_err(|_| ERROR)?
            .encrypt(
                &nonce,
                Payload {
                    msg: data,
                    aad: self.scope.as_bytes(),
                },
            )
            .map_err(|_| ERROR)?;
        let bytes = serde_json::to_vec(&Envelope {
            version: 1,
            key_id: key_id.clone(),
            nonce: nonce.to_vec(),
            ciphertext,
        })
        .map_err(|_| ERROR)?;
        let result = self.replace(FILE, &format!("ai-{key_id}.tmp"), &bytes);
        if result.is_err() {
            let _ = keys.delete(&self.account(&key_id));
        } else if result == Ok(true)
            && let Some(old) = old
        {
            let _ = keys.delete(&self.account(&old.key_id));
        }
        match result {
            Ok(true) => Ok(()),
            Ok(false) => Err("native.ai.access.durability".into()),
            Err(error) => Err(error),
        }
    }
    pub fn remove(&self, keys: &impl KeyStore) -> Result<(), String> {
        if self.device.is_some() {
            return self.remove_connection(keys, None);
        }
        let old = self
            .read_file()?
            .and_then(|bytes| serde_json::from_slice::<Envelope>(&bytes).ok());
        match self.dir.remove_file(FILE) {
            Ok(()) => {
                if self.sync_directory()
                    && let Some(old) = old
                {
                    let _ = keys.delete(&self.account(&old.key_id));
                }
                Ok(())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(ERROR.into()),
        }
    }
    pub(crate) fn sync_directory(&self) -> bool {
        crate::durable_storage::sync_directory(&self.dir).is_ok()
    }
    pub(crate) fn replace(&self, name: &str, temp: &str, bytes: &[u8]) -> Result<bool, String> {
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
        let mut file = self.dir.open_with(temp, &options).map_err(|_| ERROR)?;
        let result = (|| {
            file.write_all(bytes)?;
            file.sync_all()?;
            self.dir.rename(temp, &self.dir, name)
        })();
        if result.is_err() {
            let _ = self.dir.remove_file(temp);
        }
        // A failed directory sync is after the rename commit: never delete its new key.
        result
            .map(|_| self.sync_directory())
            .map_err(|_| ERROR.into())
    }
}

fn storage_root(path: &Path) -> Result<(std::path::PathBuf, std::path::Components<'_>), String> {
    if !path.is_absolute() {
        return Err(ERROR.into());
    }
    let mut components = path.components();
    let mut root = std::path::PathBuf::new();
    #[cfg(windows)]
    let implicit_unc_root = {
        use std::path::Prefix;
        let Some(Component::Prefix(prefix)) = components.next() else {
            return Err(ERROR.into());
        };
        match prefix.kind() {
            Prefix::Disk(_)
            | Prefix::VerbatimDisk(_)
            | Prefix::UNC(_, _)
            | Prefix::VerbatimUNC(_, _) => root.push(prefix.as_os_str()),
            _ => return Err(ERROR.into()),
        }
        matches!(prefix.kind(), Prefix::VerbatimUNC(_, _))
    };
    #[cfg(not(windows))]
    let implicit_unc_root = false;
    match components.clone().next() {
        Some(Component::RootDir) => {
            components.next();
        }
        // A bare verbatim UNC share is absolute but has no RootDir component.
        None if implicit_unc_root => {}
        _ => return Err(ERROR.into()),
    }
    root.push(std::path::MAIN_SEPARATOR_STR);
    Ok((root, components))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};
    #[derive(Default)]
    struct Keys(RefCell<HashMap<String, Vec<u8>>>);
    impl KeyStore for Keys {
        fn get(&self, id: &str) -> Result<Vec<u8>, String> {
            self.0.borrow().get(id).cloned().ok_or("locked".into())
        }
        fn set(&self, id: &str, key: &[u8]) -> Result<(), String> {
            self.0.borrow_mut().insert(id.into(), key.into());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(id);
            Ok(())
        }
    }
    struct Unavailable;
    impl KeyStore for Unavailable {
        fn get(&self, _: &str) -> Result<Vec<u8>, String> {
            Err("unavailable".into())
        }
        fn set(&self, _: &str, _: &[u8]) -> Result<(), String> {
            Err("unavailable".into())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Err("unavailable".into())
        }
    }
    fn workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".situate")).unwrap();
        dir
    }
    #[test]
    fn encrypts_reopens_and_requires_separate_workspace_key() {
        let dir = workspace();
        let path = dir.path().canonicalize().unwrap();
        let keys = Keys::default();
        Storage::open(&path, "one")
            .unwrap()
            .save(&keys, b"private-token")
            .unwrap();
        let saved = std::fs::read(path.join(".situate").join(FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&saved).contains("private-token"));
        assert_eq!(
            &**Storage::open(&path, "one")
                .unwrap()
                .load(&keys)
                .unwrap()
                .as_ref()
                .unwrap(),
            b"private-token"
        );
        assert!(Storage::open(&path, "two").unwrap().load(&keys).is_err());
        assert!(
            Storage::open(&path, "one")
                .unwrap()
                .load(&Keys::default())
                .is_err()
        );
    }
    #[cfg(unix)]
    #[test]
    fn atomic_saves_keep_the_open_marker_after_rename_and_symlink_replacement() {
        let directory = workspace();
        let other = workspace();
        let path = directory.path().canonicalize().unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let keys = Keys::default();
        storage.save(&keys, b"old").unwrap();
        std::fs::rename(path.join(".situate"), path.join("moved")).unwrap();
        std::os::unix::fs::symlink(other.path().join(".situate"), path.join(".situate")).unwrap();

        storage.save(&keys, b"replacement").unwrap();
        storage.create_conversation("chat", "").unwrap();
        storage.save_model(br#"{"model":"one"}"#).unwrap();
        assert_eq!(
            &**storage.load(&keys).unwrap().as_ref().unwrap(),
            b"replacement"
        );
        assert_eq!(keys.0.borrow().len(), 1);
        assert_eq!(
            storage.read_conversation("chat").unwrap().unwrap().messages,
            serde_json::json!([])
        );
        assert_eq!(
            storage.read_model().unwrap().unwrap(),
            br#"{"model":"one"}"#
        );
        for name in [
            FILE,
            "conversations/chat/metadata.json",
            "conversations/chat/history.jsonl",
            "chat-model.json",
        ] {
            assert!(path.join("moved").join(name).is_file());
            assert!(!other.path().join(".situate").join(name).exists());
        }
        assert!(Storage::open(&path, "one").is_err());
        storage.remove(&keys).unwrap();
        assert!(keys.0.borrow().is_empty());
        assert!(!path.join("moved").join(FILE).exists());
    }

    #[cfg(windows)]
    #[test]
    fn unc_roots_parse_without_accessing_a_network_share() {
        for (input, expected_root, expected_tail) in [
            (r"\\server\share", r"\\server\share\", ""),
            (r"\\server\share\", r"\\server\share\", ""),
            (r"\\?\UNC\server\share", r"\\?\UNC\server\share\", ""),
            (r"\\?\UNC\server\share\", r"\\?\UNC\server\share\", ""),
            (r"\\server\share\folder", r"\\server\share\", "folder"),
            (
                r"\\?\UNC\server\share\folder",
                r"\\?\UNC\server\share\",
                "folder",
            ),
        ] {
            let (root, tail) = storage_root(Path::new(input)).unwrap();
            assert_eq!(
                root.as_os_str(),
                std::ffi::OsStr::new(expected_root),
                "{input}"
            );
            assert_eq!(tail.as_path(), Path::new(expected_tail), "{input}");
        }
        for input in [
            r"C:relative",
            r"\root-relative",
            r"\\.\C:\workspace",
            r"\\?\C:",
        ] {
            assert!(storage_root(Path::new(input)).is_err(), "{input}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn drive_and_verbatim_paths_reopen_the_same_storage() {
        let directory = workspace();
        let verbatim = directory.path().canonicalize().unwrap();
        let drive =
            std::path::PathBuf::from(verbatim.to_str().unwrap().strip_prefix(r"\\?\").unwrap());
        let keys = Keys::default();
        Storage::open(&drive, "one")
            .unwrap()
            .save(&keys, b"token")
            .unwrap();
        let reopened = Storage::open(&verbatim, "one").unwrap();
        assert_eq!(&**reopened.load(&keys).unwrap().as_ref().unwrap(), b"token");
        reopened.create_conversation("chat", "").unwrap();
        reopened.save_model(b"{}").unwrap();
        assert_eq!(
            Storage::open(&drive, "one")
                .unwrap()
                .read_conversation("chat")
                .unwrap()
                .unwrap()
                .messages,
            serde_json::json!([])
        );
        assert!(Storage::open(Path::new(r"C:relative"), "one").is_err());
        assert!(Storage::open(Path::new(r"\root-relative"), "one").is_err());
        assert!(Storage::open(Path::new(r"\\.\C:\workspace"), "one").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_rejected_and_do_not_redirect_held_storage() {
        let directory = workspace();
        let other = workspace();
        let path = directory.path().canonicalize().unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let keys = Keys::default();
        storage.save(&keys, b"old").unwrap();
        assert_eq!(
            std::fs::rename(path.join(".situate"), path.join("moved"))
                .unwrap_err()
                .raw_os_error(),
            Some(32)
        );
        assert!(!path.join("moved").exists());
        std::fs::create_dir(path.join("redirected")).unwrap();
        for (link, target) in [
            (
                path.join("redirected/.situate"),
                other.path().join(".situate"),
            ),
            (path.join("alias"), other.path().to_path_buf()),
        ] {
            let output = std::process::Command::new("cmd")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(&link)
                .arg(&target)
                .output()
                .unwrap();
            assert!(output.status.success(), "{output:?}");
        }
        assert!(Storage::open(&path.join("redirected"), "one").is_err());
        assert!(Storage::open(&path.join("alias"), "one").is_err());
        storage.save(&keys, b"replacement").unwrap();
        storage.create_conversation("chat", "").unwrap();
        storage.save_model(b"{}").unwrap();
        assert_eq!(
            &**storage.load(&keys).unwrap().as_ref().unwrap(),
            b"replacement"
        );
        for name in [
            FILE,
            "conversations/chat/metadata.json",
            "conversations/chat/history.jsonl",
            "chat-model.json",
        ] {
            assert!(path.join(".situate").join(name).is_file());
            assert!(!other.path().join(".situate").join(name).exists());
        }
        storage.remove(&keys).unwrap();
        assert!(keys.0.borrow().is_empty());
        std::fs::remove_dir(path.join("redirected/.situate")).unwrap();
        std::fs::remove_dir(path.join("alias")).unwrap();
    }

    #[test]
    fn failed_key_storage_preserves_old_connection() {
        let dir = workspace();
        let path = dir.path().canonicalize().unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let keys = Keys::default();
        storage.save(&keys, b"old").unwrap();
        assert!(storage.save(&Unavailable, b"replacement").is_err());
        assert_eq!(&**storage.load(&keys).unwrap().as_ref().unwrap(), b"old");
        storage.save(&keys, b"replacement").unwrap();
        assert_eq!(keys.0.borrow().len(), 1);
        storage.remove(&keys).unwrap();
        assert!(keys.0.borrow().is_empty());
        assert!(storage.load(&keys).unwrap().is_none());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_directories_and_credential_files() {
        let dir = workspace();
        let other = workspace();
        let path = dir.path().canonicalize().unwrap();
        std::os::unix::fs::symlink(other.path(), path.join("alias")).unwrap();
        assert!(Storage::open(&path.join("alias"), "one").is_err());
        std::os::unix::fs::symlink(
            other.path().join("missing"),
            path.join(".situate").join(FILE),
        )
        .unwrap();
        assert!(
            Storage::open(&path, "one")
                .unwrap()
                .load(&Keys::default())
                .is_err()
        );
    }
    #[cfg(unix)]
    #[test]
    fn fifo_is_rejected_without_waiting_for_a_writer() {
        use std::os::unix::ffi::OsStrExt;
        let dir = workspace();
        let path = dir.path().canonicalize().unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        std::fs::create_dir_all(path.join(".situate/conversations/chat")).unwrap();
        for name in [FILE, "conversations/chat/metadata.json", "chat-model.json"] {
            let name =
                std::ffi::CString::new(path.join(".situate").join(name).as_os_str().as_bytes())
                    .unwrap();
            assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        }
        assert!(storage.load(&Keys::default()).is_err());
        assert!(storage.read_conversation("chat").is_err());
        assert!(storage.read_model().is_err());
    }
    #[test]
    fn model_metadata_is_bounded_atomic_and_separate_from_chat_and_credentials() {
        let directory = workspace();
        let path = directory.path().canonicalize().unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let keys = Keys::default();
        storage.save(&keys, b"synthetic-credential").unwrap();
        let encrypted = std::fs::read(path.join(".situate").join(FILE)).unwrap();
        storage.create_conversation("chat", "").unwrap();
        assert!(storage.read_model().unwrap().is_none());
        storage.save_model(br#"{"model":"one"}"#).unwrap();
        storage.save_model(br#"{"model":"two"}"#).unwrap();
        assert!(storage.save_model(&vec![0; 4097]).is_err());
        assert_eq!(
            storage.read_model().unwrap().unwrap(),
            br#"{"model":"two"}"#
        );
        assert_eq!(
            storage.read_conversation("chat").unwrap().unwrap().messages,
            serde_json::json!([])
        );
        assert_eq!(
            std::fs::read(path.join(".situate").join(FILE)).unwrap(),
            encrypted
        );
        assert_eq!(
            &**storage.load(&keys).unwrap().as_ref().unwrap(),
            b"synthetic-credential"
        );
        std::fs::write(path.join(".situate/chat-model.json"), vec![0; 4097]).unwrap();
        assert!(storage.read_model().is_err());
    }
    #[cfg(unix)]
    #[test]
    fn model_metadata_never_follows_a_symlink_and_can_replace_invalid_local_metadata() {
        let directory = workspace();
        let path = directory.path().canonicalize().unwrap();
        let external = path.join("external");
        std::fs::write(&external, b"external contents").unwrap();
        let preference = path.join(".situate/chat-model.json");
        std::os::unix::fs::symlink(&external, &preference).unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        assert!(storage.read_model().is_err());
        storage.save_model(b"{}").unwrap();
        assert_eq!(storage.read_model().unwrap().unwrap(), b"{}");
        assert_eq!(std::fs::read(external).unwrap(), b"external contents");
    }
    #[test]
    fn credential_lock_serializes_rotating_refresh_and_reload_without_cross_workspace_mutation() {
        let one = workspace();
        let two = workspace();
        let path = one.path().canonicalize().unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let competing = Storage::open(&path, "one").unwrap();
        let other = Storage::open(&two.path().canonicalize().unwrap(), "two").unwrap();
        let keys = Keys::default();
        storage
            .save(&keys, br#"{"refresh":"old","expires":0}"#)
            .unwrap();
        other.save(&keys, b"other-workspace").unwrap();
        let first = storage.lock_credentials().unwrap();
        assert!(competing.lock_credentials().is_err());
        let other_lock = other.lock_credentials().unwrap();
        storage
            .save(&keys, br#"{"refresh":"rotated","expires":999999}"#)
            .unwrap();
        drop(first);
        let second = competing.lock_credentials().unwrap();
        assert_eq!(
            &**competing.load(&keys).unwrap().as_ref().unwrap(),
            br#"{"refresh":"rotated","expires":999999}"#
        );
        assert_eq!(
            &**other.load(&keys).unwrap().as_ref().unwrap(),
            b"other-workspace"
        );
        drop((second, other_lock));
    }
    #[cfg(unix)]
    #[test]
    fn owner_drop_unlocks_while_an_unrelated_fork_still_holds_the_descriptor() {
        use std::io::{Read, Write};
        use std::os::fd::AsRawFd;
        use std::os::unix::{net::UnixStream, process::CommandExt};
        use std::process::Command;
        use std::time::Duration;

        let directory = workspace();
        let storage = Storage::open(&directory.path().canonicalize().unwrap(), "one").unwrap();
        for name in ["ai-connection.lock", "conversations.lock"] {
            let lock = storage.lock_named(name).unwrap();
            let (mut parent, child) = UnixStream::pair().unwrap();
            parent
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            child
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let worker = std::thread::spawn(move || {
                let fd = child.as_raw_fd();
                let mut command = Command::new("/bin/sh");
                command.args(["-c", ":"]);
                // Only async-signal-safe syscalls run between fork and exec.
                unsafe {
                    command.pre_exec(move || {
                        let mut byte = 1u8;
                        if libc::write(fd, (&byte as *const u8).cast(), 1) != 1
                            || libc::read(fd, (&mut byte as *mut u8).cast(), 1) != 1
                        {
                            return Err(std::io::Error::last_os_error());
                        }
                        Ok(())
                    });
                }
                let result = command.spawn();
                drop(child);
                result.unwrap().wait().unwrap()
            });
            let mut ready = [0];
            parent.read_exact(&mut ready).unwrap();
            let while_owned = storage.lock_named(name);
            drop(lock);
            let after_drop = storage.lock_named(name);
            parent.write_all(&[1]).unwrap();
            assert!(worker.join().unwrap().success());
            assert!(
                while_owned.is_err(),
                "the owner must retain cross-process exclusion"
            );
            assert!(
                after_drop.is_ok(),
                "an unrelated child must not extend the owner's lock: {:?}",
                after_drop.err()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn credential_lock_rejects_symlinks_and_non_regular_files() {
        let directory = workspace();
        let path = directory.path().canonicalize().unwrap();
        let lock = path.join(".situate/ai-connection.lock");
        std::os::unix::fs::symlink(path.join("outside"), &lock).unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        assert!(storage.lock_credentials().is_err());
        std::fs::remove_file(&lock).unwrap();
        std::fs::create_dir(&lock).unwrap();
        assert!(storage.lock_credentials().is_err());
    }
    #[test]
    fn modified_ciphertext_is_not_accepted() {
        let dir = workspace();
        let path = dir.path().canonicalize().unwrap();
        let keys = Keys::default();
        let storage = Storage::open(&path, "one").unwrap();
        storage.save(&keys, b"token").unwrap();
        let file = path.join(".situate").join(FILE);
        let mut envelope: Envelope =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        envelope.ciphertext[0] ^= 1;
        std::fs::write(file, serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(storage.load(&keys).is_err());
    }
}
