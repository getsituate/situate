use super::{child, optional_child, valid_id};
use crate::content::{self, ContentStore, SaveOutcome, TextVersion};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{ambient_authority, fs::Dir};
use std::io::Read;
use std::{
    io,
    path::{Path, PathBuf},
};

const ERROR: &str = "native.plugins.hostFailed";
const INVALID: &str = "native.plugins.invalidPath";
const LIMIT: u64 = 1_048_576;

#[derive(Clone, Copy)]
pub enum Area {
    Config,
    Data,
}
impl Area {
    fn directory(self) -> &'static str {
        match self {
            Self::Config => "config",
            Self::Data => "data",
        }
    }
}
fn workspace(path: &Path) -> Result<Dir, String> {
    if !path.is_absolute() {
        return Err(INVALID.into());
    }
    let mut ancestors: Vec<_> = path.ancestors().collect();
    let mut dir = Dir::open_ambient_dir(ancestors.pop().ok_or(INVALID)?, ambient_authority())
        .map_err(|_| ERROR)?;
    for path in ancestors.into_iter().rev() {
        let name = path.file_name().and_then(|s| s.to_str()).ok_or(INVALID)?;
        dir = child(&dir, name).map_err(|_| INVALID)?;
    }
    Ok(dir)
}
fn ensure(parent: &Dir, name: &str) -> Result<Dir, String> {
    match parent.create_dir(name) {
        Ok(()) => parent
            .try_clone()
            .map_err(|_| ERROR)?
            .into_std_file()
            .sync_all()
            .map_err(|_| ERROR)?,
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
        Err(_) => return Err(ERROR.into()),
    }
    child(parent, name).map_err(|_| INVALID.into())
}
fn location(root: &Path, plugin: &str, area: Area) -> PathBuf {
    root.join(".situate/plugins")
        .join(plugin)
        .join(area.directory())
}
fn open(root: &Path, plugin: &str, area: Area, create: bool) -> Result<Dir, String> {
    if !valid_id(plugin) {
        return Err(INVALID.into());
    }
    let marker = child(&workspace(root)?, ".situate").map_err(|_| INVALID)?;
    let inventory = child(&marker, "plugins").map_err(|_| ERROR)?;
    let plugin_dir = child(&inventory, plugin).map_err(|_| ERROR)?;
    if let Some(dir) = optional_child(&plugin_dir, area.directory()).map_err(|_| INVALID)? {
        let marker = child(&dir, ".situate").map_err(|_| ERROR)?;
        child(&marker, "history.git").map_err(|_| ERROR)?;
        return Ok(dir);
    }
    if !create {
        return Err(ERROR.into());
    }
    // An interrupted bootstrap remains damaged; existing areas never recreate missing history.
    plugin_dir.create_dir(area.directory()).map_err(|_| ERROR)?;
    let dir = child(&plugin_dir, area.directory()).map_err(|_| ERROR)?;
    ensure(&dir, ".situate")?;
    drop(ContentStore::open(&location(root, plugin, area)).map_err(|_| ERROR)?);
    plugin_dir
        .try_clone()
        .map_err(|_| ERROR)?
        .into_std_file()
        .sync_all()
        .map_err(|_| ERROR)?;
    Ok(dir)
}
pub fn read(root: &Path, plugin: &str, area: Area, path: &str) -> Result<TextVersion, String> {
    content::validate_portable_path(path).map_err(|_| INVALID)?;
    let dir = open(root, plugin, area, false)?;
    let parts: Vec<_> = path.split('/').collect();
    let mut parent = dir;
    for part in &parts[..parts.len() - 1] {
        parent = child(&parent, part).map_err(|_| INVALID)?;
    }
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = parent
        .open_with(parts.last().ok_or(INVALID)?, &options)
        .map_err(|_| ERROR)?;
    if !file.metadata().map_err(|_| ERROR)?.is_file() {
        return Err(INVALID.into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ERROR)?;
    if bytes.len() as u64 > LIMIT {
        return Err("native.plugins.tooLarge".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| ERROR)?;
    let revision = content::revision_for_text(&text).map_err(|_| ERROR)?;
    Ok(TextVersion { text, revision })
}
pub fn write(
    root: &Path,
    plugin: &str,
    area: Area,
    path: &str,
    text: &str,
    expected: Option<&str>,
) -> Result<SaveOutcome, String> {
    content::validate_portable_path(path).map_err(|_| INVALID)?;
    if text.len() as u64 > LIMIT {
        return Err("native.plugins.tooLarge".into());
    }
    let dir = open(root, plugin, area, true)?;
    let mut store = ContentStore::open(&location(root, plugin, area)).map_err(|_| ERROR)?;
    let parts: Vec<_> = path.split('/').collect();
    let mut parent = dir;
    for (index, part) in parts[..parts.len() - 1].iter().enumerate() {
        if optional_child(&parent, part)
            .map_err(|_| INVALID)?
            .is_none()
        {
            store
                .create_folder(&parts[..=index].join("/"))
                .map_err(|_| ERROR)?;
        }
        parent = child(&parent, part).map_err(|_| INVALID)?;
    }
    store
        .agent_write(path, expected, text)
        .map_err(|_| ERROR.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> tempfile::TempDir {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir_all(root.path().join(".situate/plugins/one")).unwrap();
        std::fs::create_dir(root.path().join(".situate/plugins/two")).unwrap();
        root
    }
    #[test]
    fn areas_plugins_and_workspaces_have_independent_history_and_stale_writes_fail() {
        let a = root();
        let b = root();
        for (root, plugin, area, text) in [
            (a.path(), "one", Area::Config, "config"),
            (a.path(), "one", Area::Data, "data"),
            (a.path(), "two", Area::Config, "other"),
            (b.path(), "one", Area::Config, "workspace"),
        ] {
            write(root, plugin, area, "nested/state.json", text, None).unwrap();
            assert_eq!(
                read(root, plugin, area, "nested/state.json").unwrap().text,
                text
            );
        }
        let first = read(a.path(), "one", Area::Config, "nested/state.json").unwrap();
        write(
            a.path(),
            "one",
            Area::Config,
            "nested/state.json",
            "updated",
            Some(&first.revision),
        )
        .unwrap();
        assert!(
            write(
                a.path(),
                "one",
                Area::Config,
                "nested/state.json",
                "stale",
                Some(&first.revision)
            )
            .is_err()
        );
        assert_eq!(
            read(a.path(), "one", Area::Config, "nested/state.json")
                .unwrap()
                .text,
            "updated"
        );
        assert!(
            a.path()
                .join(".situate/plugins/one/config/.situate/history.git")
                .is_dir()
        );
        assert!(!a.path().join("Plugin Data").exists());
        assert!(!a.path().join(".situate/plugins/one/code").exists());
    }
    #[test]
    fn existing_missing_or_corrupt_history_is_never_reset() {
        for missing in [false, true] {
            let root = root();
            write(
                root.path(),
                "one",
                Area::Data,
                "state.json",
                "original",
                None,
            )
            .unwrap();
            let area = location(root.path(), "one", Area::Data);
            let history = area.join(".situate/history.git");
            if missing {
                std::fs::remove_dir_all(&history).unwrap();
            } else {
                std::fs::write(history.join("HEAD"), "corrupt").unwrap();
            }
            assert!(write(root.path(), "one", Area::Data, "new.json", "new", None).is_err());
            assert_eq!(
                std::fs::read_to_string(area.join("state.json")).unwrap(),
                "original"
            );
            assert!(!area.join("new.json").exists());
            if missing {
                assert!(!history.exists());
            } else {
                assert_eq!(
                    std::fs::read_to_string(history.join("HEAD")).unwrap(),
                    "corrupt"
                );
            }
        }
    }
    #[cfg(unix)]
    #[test]
    fn symlink_bootstrap_boundaries_cannot_write_outside() {
        for boundary in [
            ".situate/plugins",
            ".situate/plugins/one",
            ".situate/plugins/one/data",
        ] {
            let outside = root();
            let root = root();
            let path = root.path().join(boundary);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            if path.is_dir() {
                std::fs::remove_dir_all(&path).unwrap();
            }
            std::os::unix::fs::symlink(outside.path(), path).unwrap();
            assert!(write(root.path(), "one", Area::Data, "state.json", "new", None).is_err());
            assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 1);
        }
    }
}
