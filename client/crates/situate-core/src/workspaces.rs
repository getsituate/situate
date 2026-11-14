use cap_std::{ambient_authority, fs::Dir};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Location {
    pub id: String,
    pub name: String,
    pub display: String,
    pub kind: String,
    pub handle: String,
}

pub fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name == "." || name == ".." {
        return Err("native.workspace.name.required".into());
    }
    if name
        .chars()
        .any(|c| c.is_control() || "/\\<>:\"|?*".contains(c))
        || name.ends_with(['.', ' '])
        || name.len() > 240
    {
        return Err("native.workspace.name.invalid".into());
    }
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&base.as_str())
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("native.workspace.name.reserved".into());
    }
    Ok(())
}

pub fn location(path: &Path) -> Result<Location, String> {
    let path = path
        .canonicalize()
        .map_err(|_| "native.workspace.folder.accessFailed")?;
    fs::read_dir(&path).map_err(|_| "native.workspace.folder.readFailed")?;
    let handle = path
        .to_str()
        .ok_or("native.workspace.folder.nameInvalid")?
        .to_owned();
    Ok(Location {
        id: format!("path:{handle}"),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| handle.clone()),
        display: handle.clone(),
        kind: "path".into(),
        handle,
    })
}

pub fn inspect(path: &Path) -> Result<Location, String> {
    let result = location(path)?;
    let marker = Path::new(&result.handle).join(".situate");
    if !fs::metadata(&marker).is_ok_and(|m| m.is_dir()) {
        return Err("native.workspace.folder.notWorkspace".into());
    }
    fs::read_dir(marker).map_err(|_| "native.workspace.marker.readFailed")?;
    if fs::metadata(&result.handle)
        .map_err(|_| "native.workspace.folder.unavailable")?
        .permissions()
        .readonly()
    {
        return Err("native.workspace.folder.readOnly".into());
    }
    Ok(result)
}

pub fn preflight(parent: &Path, name: &str) -> Result<String, String> {
    validate_name(name)?;
    let parent = location(parent)?;
    let dir = Dir::open_ambient_dir(&parent.handle, ambient_authority())
        .map_err(|_| "native.workspace.folder.unavailable")?;
    check_target(&dir, name)?;
    Ok(Path::new(&parent.handle)
        .join(name)
        .to_string_lossy()
        .into_owned())
}

fn check_target(dir: &Dir, name: &str) -> Result<(), String> {
    match dir.symlink_metadata(name) {
        Ok(_) => return Err("native.workspace.folder.exists".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {
            return Err("native.workspace.create.checkAccessFailed".into());
        }
    }
    if dir
        .dir_metadata()
        .map_err(|_| "native.workspace.folder.unavailable")?
        .permissions()
        .readonly()
    {
        return Err("native.workspace.parent.readOnly".into());
    }
    Ok(())
}

enum InitialMetadata {
    Identity,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    Onboarding,
}

/// Publishes identity and initial progress together. Failure may leave a partial
/// child directory, which must not be reused or automatically removed.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn create_for_onboarding(parent: &Path, name: &str) -> Result<Location, String> {
    create_initialized(parent, name, InitialMetadata::Onboarding)
}

pub fn create(parent: &Path, name: &str) -> Result<Location, String> {
    create_initialized(parent, name, InitialMetadata::Identity)
}

fn create_initialized(
    parent: &Path,
    name: &str,
    metadata: InitialMetadata,
) -> Result<Location, String> {
    validate_name(name)?;
    let parent = location(parent)?;
    let preview = Path::new(&parent.handle)
        .join(name)
        .to_string_lossy()
        .into_owned();
    // Keep operations relative to an opened parent, even if its pathname is replaced.
    let dir = Dir::open_ambient_dir(&parent.handle, ambient_authority())
        .map_err(|_| "native.workspace.folder.unavailable")?;
    check_target(&dir, name)?;
    dir.create_dir(name).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            "native.workspace.folder.exists".into()
        } else {
            "native.workspace.create.failed".to_owned()
        }
    })?;
    let child = open_child_directory(&dir, name)
        .map_err(|_| partial_creation(&preview, "native.workspace.create.openUnsafe"))?;
    finish_new_directory(&dir, &child, name, &preview, metadata)
}

fn open_child_directory(dir: &Dir, name: &str) -> std::io::Result<Dir> {
    cap_primitives::fs::open_dir_nofollow(&dir.try_clone()?.into_std_file(), Path::new(name))
        .map(Dir::from_std_file)
}

fn same_directory(left: &Dir, right: &Dir) -> std::io::Result<bool> {
    Ok(
        same_file::Handle::from_file(left.try_clone()?.into_std_file())?
            == same_file::Handle::from_file(right.try_clone()?.into_std_file())?,
    )
}

fn check_created_identity(
    dir: &Dir,
    child: &Dir,
    name: &str,
    preview: &str,
) -> std::io::Result<()> {
    let current = open_child_directory(dir, name)?;
    let parent = Dir::open_ambient_dir(Path::new(preview).parent().unwrap(), ambient_authority())?;
    if !same_directory(dir, &parent)? || !same_directory(child, &current)? {
        return Err(std::io::Error::other(
            "native.workspace.create.locationChanged",
        ));
    }
    Ok(())
}

fn partial_creation(preview: &str, detail: &str) -> String {
    crate::messages::error(
        "native.workspace.create.partial",
        serde_json::json!({"path":preview, "error":detail}),
    )
}

fn check_directory_entry(dir: &Dir, name: &str, held: &Dir) -> std::io::Result<()> {
    if !same_directory(held, &open_child_directory(dir, name)?)? {
        return Err(std::io::Error::other(
            "native.workspace.create.locationChanged",
        ));
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn prepare_initial_metadata(child: &Dir, onboarding: bool) -> std::io::Result<(String, Dir)> {
    #[cfg(test)]
    onboarding_tests::checkpoint(onboarding_tests::Checkpoint::Empty, child)?;
    let name = format!(".situate-{}.tmp", uuid::Uuid::new_v4());
    child.create_dir(&name)?;
    let marker = open_child_directory(child, &name)?;
    #[cfg(test)]
    onboarding_tests::checkpoint(onboarding_tests::Checkpoint::Staging, child)?;
    crate::workspace_identity::initialize_marker(&marker)?;
    #[cfg(test)]
    onboarding_tests::checkpoint(onboarding_tests::Checkpoint::Identity, child)?;
    if onboarding {
        crate::onboarding::initialize_marker(&marker)?;
    }
    situate_migrations::initialize_fresh(&marker, crate::application_version())
        .map_err(std::io::Error::other)?;
    #[cfg(test)]
    onboarding_tests::checkpoint(onboarding_tests::Checkpoint::Progress, child)?;
    #[cfg(test)]
    onboarding_tests::checkpoint(onboarding_tests::Checkpoint::StagingSync, child)?;
    crate::durable_storage::sync_directory(&marker)?;
    #[cfg(test)]
    onboarding_tests::checkpoint(onboarding_tests::Checkpoint::Prepared, child)?;
    Ok((name, marker))
}

fn finish_new_directory(
    dir: &Dir,
    child: &Dir,
    name: &str,
    preview: &str,
    metadata: InitialMetadata,
) -> Result<Location, String> {
    let partial = |detail: &str| partial_creation(preview, detail);
    let verify = || {
        check_created_identity(dir, child, name, preview)
            .map_err(|_| partial("native.workspace.create.locationChanged"))
    };
    verify()?;
    // mkdir cannot return a handle atomically. Reject nonempty replacements acquired
    // before the no-follow open; replacements after it cannot redirect marker writes.
    if child
        .entries()
        .map_err(|_| partial("native.workspace.create.readFailed"))?
        .next()
        .is_some()
    {
        return Err(partial("native.workspace.create.markerNonempty"));
    }
    let marker: Option<Dir> = match metadata {
        InitialMetadata::Identity => {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let (stage, marker) = prepare_initial_metadata(child, false)
                    .map_err(|_| partial("native.workspace.create.markerFailed"))?;
                verify()?;
                check_directory_entry(child, &stage, &marker)
                    .map_err(|_| partial("native.workspace.create.locationChanged"))?;
                crate::durable_storage::rename_noreplace(child, &stage, child, ".situate")
                    .map_err(|_| partial("native.workspace.create.markerFailed"))?;
                Some(marker)
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            {
                child
                    .create_dir(".situate")
                    .and_then(|_| crate::workspace_identity::initialize(child))
                    .map_err(|_| partial("native.workspace.create.markerFailed"))?;
                None
            }
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        InitialMetadata::Onboarding => {
            let (stage, marker) = prepare_initial_metadata(child, true)
                .map_err(|_| partial("native.workspace.create.markerFailed"))?;
            verify()?;
            check_directory_entry(child, &stage, &marker)
                .map_err(|_| partial("native.workspace.create.locationChanged"))?;
            // Publish identity and progress together; a bare marker is a legacy workspace.
            crate::durable_storage::rename_noreplace(child, &stage, child, ".situate")
                .map_err(|_| partial("native.workspace.create.markerFailed"))?;
            #[cfg(test)]
            onboarding_tests::checkpoint(onboarding_tests::Checkpoint::Published, child)
                .map_err(|_| partial("native.workspace.create.markerFailed"))?;
            Some(marker)
        }
    };
    #[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
    if marker.is_some() {
        onboarding_tests::checkpoint(onboarding_tests::Checkpoint::ChildSync, child)
            .map_err(|_| partial("native.workspace.create.markerFailed"))?;
    }
    crate::durable_storage::sync_directory(child)
        .map_err(|_| partial("native.workspace.create.markerFailed"))?;
    #[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
    if marker.is_some() {
        onboarding_tests::checkpoint(onboarding_tests::Checkpoint::ParentSync, child)
            .map_err(|_| partial("native.workspace.create.markerFailed"))?;
    }
    crate::durable_storage::sync_directory(dir)
        .map_err(|_| partial("native.workspace.create.markerFailed"))?;
    #[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
    if marker.is_some() {
        onboarding_tests::checkpoint(onboarding_tests::Checkpoint::Synced, child)
            .map_err(|_| partial("native.workspace.create.markerFailed"))?;
    }
    let result =
        inspect(Path::new(preview)).map_err(|_| partial("native.workspace.create.reopenFailed"))?;
    verify()?;
    if let Some(marker) = marker {
        check_directory_entry(child, ".situate", &marker)
            .map_err(|_| partial("native.workspace.create.locationChanged"))?;
    }
    Ok(result)
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
#[path = "workspaces_onboarding_tests.rs"]
pub(crate) mod onboarding_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_names_without_renaming() {
        for name in [
            "", " ", ".", "..", "../a", "a/b", "a\\b", "a\0b", "CON.txt", "LPT9", "name.", "name ",
        ] {
            assert!(validate_name(name).is_err(), "{name:?}");
        }
        for name in ["Garden notes", "Café notes 🌻", "com10", ".notes"] {
            assert!(validate_name(name).is_ok());
        }
    }
    #[test]
    fn creates_only_new_child_and_portable_metadata() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("keep"), "unchanged").unwrap();
        let result = create(temp.path(), "Garden").unwrap();
        assert_eq!(fs::read_dir(&result.handle).unwrap().count(), 1);
        assert_eq!(
            fs::read_dir(Path::new(&result.handle).join(".situate"))
                .unwrap()
                .count(),
            if cfg!(any(target_os = "macos", target_os = "linux")) {
                2
            } else {
                1
            }
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("keep")).unwrap(),
            "unchanged"
        );
        assert!(!temp.path().join(".situate").exists());
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let metadata: serde_json::Value = serde_json::from_slice(
                &fs::read(Path::new(&result.handle).join(".situate/migrations.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(
                metadata,
                serde_json::json!({"minimumAppVersion":"0.1.6","lastAppliedMigration":2})
            );
        }
    }
    #[test]
    fn rejects_ordinary_folders_marker_files_and_collisions() {
        let temp = tempfile::tempdir().unwrap();
        assert!(inspect(temp.path()).is_err());
        fs::write(temp.path().join(".situate"), "").unwrap();
        assert!(inspect(temp.path()).is_err());
        fs::write(temp.path().join("file"), "keep").unwrap();
        fs::create_dir(temp.path().join("directory")).unwrap();
        for name in ["file", "directory"] {
            assert_eq!(
                create(temp.path(), name).unwrap_err(),
                "native.workspace.folder.exists"
            );
        }
        assert_eq!(
            fs::read_to_string(temp.path().join("file")).unwrap(),
            "keep"
        );
    }
    #[cfg(unix)]
    #[test]
    fn rejects_even_dangling_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("missing", temp.path().join("link")).unwrap();
        assert_eq!(
            create(temp.path(), "link").unwrap_err(),
            "native.workspace.folder.exists"
        );
    }
    #[test]
    fn marker_failure_preserves_and_identifies_the_partial_directory() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Garden");
        fs::create_dir(&path).unwrap();
        fs::write(path.join(".situate"), "keep").unwrap();
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        let child = open_child_directory(&dir, "Garden").unwrap();
        let error = finish_new_directory(
            &dir,
            &child,
            "Garden",
            path.to_str().unwrap(),
            InitialMetadata::Identity,
        )
        .unwrap_err();
        let payload: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(payload["key"], "native.workspace.create.partial");
        assert_eq!(payload["params"]["path"], path.to_str().unwrap());
        assert_eq!(
            payload["params"]["error"],
            "native.workspace.create.markerNonempty"
        );
        assert_eq!(fs::read_to_string(path.join(".situate")).unwrap(), "keep");
        assert_eq!(
            create(temp.path(), "Garden").unwrap_err(),
            "native.workspace.folder.exists"
        );
    }
    #[test]
    fn child_replacement_cannot_initialize_another_directory() {
        for populated in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("Garden");
            fs::create_dir(&path).unwrap();
            let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
            let child = open_child_directory(&dir, "Garden").unwrap();
            #[cfg(windows)]
            {
                let replacement = temp.path().join("replacement");
                fs::create_dir(&replacement).unwrap();
                if populated {
                    fs::write(replacement.join("keep"), "unchanged").unwrap();
                }
                assert_eq!(
                    fs::rename(&path, temp.path().join("moved"))
                        .unwrap_err()
                        .raw_os_error(),
                    Some(32)
                );
                assert!(!temp.path().join("moved").exists());
                check_created_identity(&dir, &child, "Garden", path.to_str().unwrap()).unwrap();
                finish_new_directory(
                    &dir,
                    &child,
                    "Garden",
                    path.to_str().unwrap(),
                    InitialMetadata::Identity,
                )
                .unwrap();
                assert!(path.join(".situate").is_dir());
                assert_eq!(fs::read_dir(&path).unwrap().count(), 1);
                assert_eq!(
                    fs::read_dir(&replacement).unwrap().count(),
                    usize::from(populated)
                );
                assert!(!replacement.join(".situate").exists());
                if populated {
                    assert_eq!(
                        fs::read_to_string(replacement.join("keep")).unwrap(),
                        "unchanged"
                    );
                }
            }
            #[cfg(not(windows))]
            {
                fs::rename(&path, temp.path().join("moved")).unwrap();
                fs::create_dir(&path).unwrap();
                if populated {
                    fs::write(path.join("keep"), "unchanged").unwrap();
                }
                let error = finish_new_directory(
                    &dir,
                    &child,
                    "Garden",
                    path.to_str().unwrap(),
                    InitialMetadata::Identity,
                )
                .unwrap_err();
                let payload: serde_json::Value = serde_json::from_str(&error).unwrap();
                assert_eq!(
                    payload["params"]["error"],
                    "native.workspace.create.locationChanged"
                );
                assert!(!path.join(".situate").exists());
                assert!(!temp.path().join("moved/.situate").exists());
                if populated {
                    assert_eq!(fs::read_to_string(path.join("keep")).unwrap(), "unchanged");
                }
            }
        }
    }

    #[test]
    fn parent_and_late_child_replacement_cannot_redirect_initialization() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path().join("parent");
        fs::create_dir(&parent).unwrap();
        let path = parent.join("Garden");
        fs::create_dir(&path).unwrap();
        let dir = Dir::open_ambient_dir(&parent, ambient_authority()).unwrap();
        let child = open_child_directory(&dir, "Garden").unwrap();
        #[cfg(windows)]
        {
            let outside = temp.path().join("outside");
            fs::create_dir(&outside).unwrap();
            fs::write(outside.join("keep"), "unchanged").unwrap();
            assert_eq!(
                fs::rename(&parent, temp.path().join("moved"))
                    .unwrap_err()
                    .raw_os_error(),
                Some(32)
            );
            assert!(!temp.path().join("moved").exists());
            check_created_identity(&dir, &child, "Garden", path.to_str().unwrap()).unwrap();
            finish_new_directory(
                &dir,
                &child,
                "Garden",
                path.to_str().unwrap(),
                InitialMetadata::Identity,
            )
            .unwrap();
            assert_eq!(
                fs::rename(&path, parent.join("moved-child"))
                    .unwrap_err()
                    .raw_os_error(),
                Some(32)
            );
            check_created_identity(&dir, &child, "Garden", path.to_str().unwrap()).unwrap();
            assert!(!parent.join("moved-child").exists());
            assert!(path.join(".situate").is_dir());
            assert_eq!(fs::read_dir(&path).unwrap().count(), 1);
            assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
            assert_eq!(
                fs::read_to_string(outside.join("keep")).unwrap(),
                "unchanged"
            );
            assert!(!outside.join(".situate").exists());
        }
        #[cfg(not(windows))]
        {
            fs::rename(&parent, temp.path().join("moved")).unwrap();
            fs::create_dir(&parent).unwrap();
            assert!(
                finish_new_directory(
                    &dir,
                    &child,
                    "Garden",
                    path.to_str().unwrap(),
                    InitialMetadata::Identity
                )
                .is_err()
            );
            assert!(!temp.path().join("moved/Garden/.situate").exists());
            assert!(!parent.join("Garden").exists());
            fs::remove_dir(&parent).unwrap();
            fs::rename(temp.path().join("moved"), &parent).unwrap();
            finish_new_directory(
                &dir,
                &child,
                "Garden",
                path.to_str().unwrap(),
                InitialMetadata::Identity,
            )
            .unwrap();
            fs::rename(&path, parent.join("moved-child")).unwrap();
            fs::create_dir(&path).unwrap();
            assert!(
                check_created_identity(&dir, &child, "Garden", path.to_str().unwrap()).is_err()
            );
            assert!(!path.join(".situate").exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn no_follow_open_rejects_a_child_replaced_by_a_symlink() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("existing")).unwrap();
        std::os::unix::fs::symlink("existing", temp.path().join("Garden")).unwrap();
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        assert!(open_child_directory(&dir, "Garden").is_err());
        assert!(!temp.path().join("existing/.situate").exists());
    }

    #[cfg(unix)]
    #[test]
    fn read_only_parent_fails_without_creating_a_target() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let result = create(temp.path(), "Garden");
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(result.unwrap_err(), "native.workspace.parent.readOnly");
        assert!(!temp.path().join("Garden").exists());
    }
    #[test]
    fn exclusive_creation_survives_race_after_preflight() {
        let temp = tempfile::tempdir().unwrap();
        preflight(temp.path(), "Garden").unwrap();
        let outcomes = std::thread::scope(|s| {
            let first = s.spawn(|| create(temp.path(), "Garden"));
            let second = s.spawn(|| create(temp.path(), "Garden"));
            [first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1);
        assert!(inspect(&temp.path().join("Garden")).is_ok());
    }
}
