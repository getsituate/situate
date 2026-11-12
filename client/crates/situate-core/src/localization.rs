use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    path::{Component, Path},
};

const FILE: &str = "localization.json";
const STORAGE: &str = "native.localization.storage";
const INVALID: &str = "native.localization.invalid";
const LIMIT: u64 = 65_536;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    De,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum TimeFormat {
    #[serde(rename = "12")]
    Twelve,
    #[serde(rename = "24")]
    TwentyFour,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DateFormat {
    DmyDot,
    DmySlash,
    Mdy,
    Ymd,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NumberFormat {
    DotComma,
    CommaDot,
    DotSpace,
    CommaSpace,
    DotApostrophe,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Formats {
    pub time: TimeFormat,
    pub date: DateFormat,
    pub number: NumberFormat,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Preferences {
    pub language: Language,
    pub formats: Formats,
}
impl Preferences {
    pub fn initial(
        language: &str,
        time: Option<TimeFormat>,
        date: Option<DateFormat>,
        number: Option<NumberFormat>,
    ) -> Self {
        let language = if language
            .split(['-', '_'])
            .next()
            .is_some_and(|l| l.eq_ignore_ascii_case("de"))
        {
            Language::De
        } else {
            Language::En
        };
        let german = language == Language::De;
        Self {
            language,
            formats: Formats {
                time: time.unwrap_or(if german {
                    TimeFormat::TwentyFour
                } else {
                    TimeFormat::Twelve
                }),
                date: date.unwrap_or(if german {
                    DateFormat::DmyDot
                } else {
                    DateFormat::Mdy
                }),
                number: number.unwrap_or(if german {
                    NumberFormat::CommaDot
                } else {
                    NumberFormat::DotComma
                }),
            },
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
            .open_with("localization.lock", &options)
            .map_err(|_| STORAGE)?
            .into_std();
        if !file.metadata().map_err(|_| STORAGE)?.is_file() {
            return Err(STORAGE.into());
        }
        file.try_lock().map_err(|_| "native.localization.busy")?;
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
    pub fn snapshot(&self, defaults: &Preferences, writable: bool) -> Result<Preferences, String> {
        let original = self.bytes()?;
        let (_, preferences, migrated) = decode(original.as_deref(), defaults)?;
        if !migrated || !writable {
            return Ok(preferences);
        }
        let _lock = self.lock()?;
        let original = self.bytes()?;
        let (document, preferences, migrated) = decode(original.as_deref(), defaults)?;
        if migrated {
            self.save(&document, original.as_deref())?;
        }
        Ok(preferences)
    }
    pub fn update(
        &self,
        defaults: &Preferences,
        preferences: &Preferences,
        expected: &Preferences,
    ) -> Result<(), String> {
        let _lock = self.lock()?;
        let original = self.bytes()?;
        let (mut document, current, _) = decode(original.as_deref(), defaults)?;
        if &current != expected {
            return Err("native.localization.changed".into());
        }
        document["language"] = json!(preferences.language);
        for field in ["time", "date", "number"] {
            document["formats"][field] = json!(preferences.formats)[field].clone();
        }
        self.save(&document, original.as_deref())
    }
    fn save(&self, document: &Value, expected: Option<&[u8]>) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(document).map_err(|_| STORAGE)?;
        if bytes.len() as u64 > LIMIT {
            return Err(INVALID.into());
        }
        let temp = format!("localization-{}.tmp", uuid::Uuid::new_v4());
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
            file.write_all(&bytes).map_err(|_| STORAGE)?;
            file.sync_all().map_err(|_| STORAGE)?;
            if self.bytes()?.as_deref() != expected {
                return Err("native.localization.changed".into());
            }
            self.dir
                .rename(&temp, &self.dir, FILE)
                .map_err(|_| STORAGE)?;
            crate::durable_storage::sync_directory(&self.dir)
                .map_err(|_| "native.localization.durability")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = self.dir.remove_file(&temp);
        }
        result
    }
}

pub fn decode(
    bytes: Option<&[u8]>,
    defaults: &Preferences,
) -> Result<(Value, Preferences, bool), String> {
    let mut document = match bytes {
        Some(bytes) => serde_json::from_slice::<Value>(bytes).map_err(|_| INVALID)?,
        None => json!({"version": 1}),
    };
    if document.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(INVALID.into());
    }
    let before = document.clone();
    let object = document.as_object_mut().ok_or(INVALID)?;
    object.entry("language").or_insert(json!(defaults.language));
    object.entry("formats").or_insert(json!({}));
    let formats = object
        .get_mut("formats")
        .and_then(Value::as_object_mut)
        .ok_or(INVALID)?;
    let fallback = json!(defaults.formats);
    for field in ["time", "date", "number"] {
        formats.entry(field).or_insert(fallback[field].clone());
    }
    let preferences = serde_json::from_value(document.clone()).map_err(|_| INVALID)?;
    let migrated = bytes.is_none() || document != before;
    Ok((document, preferences, migrated))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn workspace() -> tempfile::TempDir {
        let directory = std::env::temp_dir().canonicalize().unwrap();
        let root = tempfile::tempdir_in(directory).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        root
    }
    #[test]
    fn independent_device_fields_and_language_fallback() {
        let p = Preferences::initial(
            "de-CH",
            Some(TimeFormat::Twelve),
            None,
            Some(NumberFormat::DotApostrophe),
        );
        assert_eq!(
            p,
            Preferences {
                language: Language::De,
                formats: Formats {
                    time: TimeFormat::Twelve,
                    date: DateFormat::DmyDot,
                    number: NumberFormat::DotApostrophe
                }
            }
        );
        assert_eq!(
            Preferences::initial("fr-FR", None, None, None).language,
            Language::En
        );
    }
    #[test]
    fn initialization_confirms_durability_and_survives_reopen() {
        let root = workspace();
        let defaults = Preferences::initial("en", None, None, None);
        let store = Storage::open(root.path()).unwrap();
        assert_eq!(store.snapshot(&defaults, true).unwrap(), defaults);
        drop(store);

        let document: Value = serde_json::from_slice(
            &std::fs::read(root.path().join(".situate/localization.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            document,
            json!({"version":1,"language":"en","formats":{"time":"12","date":"mdy","number":"dot-comma"}})
        );
        let reopened = Storage::open(root.path()).unwrap();
        assert_eq!(
            reopened
                .snapshot(&Preferences::initial("de", None, None, None), true)
                .unwrap(),
            defaults
        );
    }

    #[test]
    fn update_confirms_durability_and_survives_reopen() {
        let root = workspace();
        let path = root.path().join(".situate/localization.json");
        std::fs::write(&path, br#"{"version":1,"language":"en","formats":{"time":"12","date":"mdy","number":"dot-comma"},"custom":"retained"}"#).unwrap();
        let original = Preferences::initial("en", None, None, None);
        let updated = Preferences {
            language: Language::De,
            formats: Formats {
                time: TimeFormat::TwentyFour,
                date: DateFormat::Ymd,
                number: NumberFormat::DotApostrophe,
            },
        };
        let store = Storage::open(root.path()).unwrap();
        store.update(&original, &updated, &original).unwrap();
        drop(store);

        let document: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            document,
            json!({"version":1,"language":"de","formats":{"time":"24","date":"ymd","number":"dot-apostrophe"},"custom":"retained"})
        );
        let reopened = Storage::open(root.path()).unwrap();
        assert_eq!(reopened.snapshot(&original, true).unwrap(), updated);
    }

    #[test]
    fn migration_persists_once_and_preserves_unrelated_fields() {
        let root = workspace();
        let path = root.path().join(".situate/localization.json");
        std::fs::write(&path, br#"{"version":1,"language":"de","custom":{"keep":true},"formats":{"time":"24","custom":7}}"#).unwrap();
        let store = Storage::open(root.path()).unwrap();
        let defaults = Preferences::initial("en", None, None, None);
        let mut p = store.snapshot(&defaults, true).unwrap();
        assert_eq!(p.language, Language::De);
        assert_eq!(p.formats.date, DateFormat::Mdy);
        assert_eq!(p.formats.time, TimeFormat::TwentyFour);
        let expected = p.clone();
        p.language = Language::En;
        p.formats.number = NumberFormat::CommaSpace;
        store.update(&defaults, &p, &expected).unwrap();
        assert_eq!(
            store
                .snapshot(&Preferences::initial("de", None, None, None), true)
                .unwrap(),
            p
        );
        let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["custom"]["keep"], true);
        assert_eq!(value["formats"]["custom"], 7);
    }
    #[test]
    fn read_only_missing_preferences_do_not_write_anything() {
        let root = workspace();
        let defaults = Preferences::initial("de", None, None, None);
        assert_eq!(
            Storage::open(root.path())
                .unwrap()
                .snapshot(&defaults, false)
                .unwrap(),
            defaults
        );
        assert_eq!(
            std::fs::read_dir(root.path().join(".situate"))
                .unwrap()
                .count(),
            0
        );
    }
    #[test]
    fn corrupt_and_unsupported_settings_are_never_overwritten() {
        let root = workspace();
        let path = root.path().join(".situate/localization.json");
        let defaults = Preferences::initial("en", None, None, None);
        for bytes in [
            "{broken",
            "{}",
            "{\"version\":2}",
            "{\"version\":1,\"language\":\"fr\"}",
            "{\"version\":1,\"formats\":{\"time\":\"25\"}}",
        ] {
            std::fs::write(&path, bytes).unwrap();
            let store = Storage::open(root.path()).unwrap();
            assert!(store.snapshot(&defaults, true).is_err());
            assert!(store.update(&defaults, &defaults, &defaults).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn external_replacements_are_read_without_cached_preferences() {
        let root = workspace();
        let store = Storage::open(root.path()).unwrap();
        let defaults = Preferences::initial("en", None, None, None);
        store.snapshot(&defaults, true).unwrap();
        std::fs::write(root.path().join(".situate/localization.json"), br#"{"version":1,"language":"de","formats":{"time":"24","date":"ymd","number":"dot-apostrophe"}}"#).unwrap();
        let p = store.snapshot(&defaults, false).unwrap();
        assert_eq!(p.language, Language::De);
        assert_eq!(p.formats.date, DateFormat::Ymd);
    }
    #[test]
    fn stale_updates_preserve_received_changes() {
        let root = workspace();
        let store = Storage::open(root.path()).unwrap();
        let initial = Preferences::initial("en", None, None, None);
        store.snapshot(&initial, true).unwrap();
        let mut received = initial.clone();
        received.formats.time = TimeFormat::TwentyFour;
        store.update(&initial, &received, &initial).unwrap();
        let before = store.bytes().unwrap();
        let mut stale = initial.clone();
        stale.language = Language::De;
        assert_eq!(
            store.update(&initial, &stale, &initial).unwrap_err(),
            "native.localization.changed"
        );
        assert_eq!(store.bytes().unwrap(), before);
        assert_eq!(store.snapshot(&initial, false).unwrap(), received);
    }
    #[cfg(unix)]
    #[test]
    fn read_only_local_settings_are_read_without_a_lock_or_migration() {
        use std::os::unix::fs::PermissionsExt;
        let root = workspace();
        let directory = root.path().join(".situate");
        let path = directory.join("localization.json");
        let defaults = Preferences::initial("en", None, None, None);
        std::fs::write(&path, br#"{"version":1,"language":"de"}"#).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o500)).unwrap();
        let store = Storage::open(root.path()).unwrap();
        assert!(!store.writable());
        assert_eq!(
            store
                .snapshot(&defaults, store.writable())
                .unwrap()
                .language,
            Language::De
        );
        assert!(!directory.join("localization.lock").exists());
        assert_eq!(
            std::fs::read(&path).unwrap(),
            br#"{"version":1,"language":"de"}"#
        );
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        store.snapshot(&defaults, true).unwrap();
        std::fs::remove_file(directory.join("localization.lock")).unwrap();
        store.snapshot(&defaults, true).unwrap();
        assert!(!directory.join("localization.lock").exists());
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_and_non_regular_files_are_rejected() {
        use std::os::unix::fs::symlink;
        let root = workspace();
        let external = tempfile::tempdir().unwrap();
        let path = root.path().join(".situate/localization.json");
        symlink(external.path().join("settings"), &path).unwrap();
        let store = Storage::open(root.path()).unwrap();
        assert!(
            store
                .snapshot(&Preferences::initial("en", None, None, None), true)
                .is_err()
        );
        assert!(!external.path().join("settings").exists());
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(store.bytes().is_err());
    }
}
