use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use serde::Deserialize;
use std::{
    io::{self, Read, Write},
    path::Path,
};
use uuid::{Uuid, Variant, Version};

const FILE: &str = "workspace.json";
const MAX_BYTES: u64 = 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    version: u32,
    id: String,
}

pub fn validate(bytes: &[u8]) -> Option<String> {
    if bytes.len() > MAX_BYTES as usize || bytes.contains(&b'\\') {
        return None;
    }
    let metadata: Metadata = serde_json::from_slice(bytes).ok()?;
    let id = Uuid::parse_str(&metadata.id).ok()?;
    (metadata.version == 1
        && id.get_version() == Some(Version::Random)
        && id.get_variant() == Variant::RFC4122
        && id.to_string() == metadata.id)
        .then_some(metadata.id)
}

fn root(path: &Path) -> io::Result<Dir> {
    let parent = Dir::open_ambient_dir(
        path.parent().ok_or_else(|| io::Error::other("root"))?,
        ambient_authority(),
    )?;
    parent.open_dir_nofollow(path.file_name().ok_or_else(|| io::Error::other("root"))?)
}

fn read_marker(marker: &Dir) -> io::Result<Option<String>> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_fs_ext::OpenOptionsSyncExt;
        options.nonblock(true);
    }
    let file = marker.open_with(FILE, &options)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    Ok(validate(&bytes))
}

/// Reads bounded, validated metadata without initializing or repairing it.
pub fn read(path: &Path) -> Option<String> {
    read_marker(&root(path).ok()?.open_dir_nofollow(".situate").ok()?)
        .ok()
        .flatten()
}

/// Initializes missing metadata at admission only. Unavailable or invalid identity
/// must not prevent the caller from opening the workspace.
pub fn admit(path: &Path) -> Option<String> {
    admit_root(&root(path).ok()?).ok().flatten()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn initialize(root: &Dir) -> io::Result<String> {
    initialize_marker(&root.open_dir_nofollow(".situate")?)
}

pub(crate) fn initialize_marker(marker: &Dir) -> io::Result<String> {
    if marker.entries()?.next().is_some() {
        return Err(io::Error::other("marker nonempty"));
    }
    admit_marker(marker)?.ok_or_else(|| io::Error::other("identity unavailable"))
}

fn admit_root(root: &Dir) -> io::Result<Option<String>> {
    let marker = root.open_dir_nofollow(".situate")?;
    if root.dir_metadata()?.permissions().readonly() {
        return read_marker(&marker);
    }
    admit_marker(&marker)
}

fn admit_marker(marker: &Dir) -> io::Result<Option<String>> {
    match marker.symlink_metadata(FILE) {
        Ok(_) => return read_marker(marker),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    if marker.dir_metadata()?.permissions().readonly() {
        return Ok(None);
    }
    let id = Uuid::new_v4().to_string();
    let temporary = format!(".workspace-{}.tmp", Uuid::new_v4());
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    let mut file = marker.open_with(&temporary, &options)?;
    let result = (|| {
        writeln!(file, "{{\"version\":1,\"id\":\"{id}\"}}")?;
        file.sync_all()?;
        // Publish the complete document exclusively; concurrent admissions read the winner.
        match marker.hard_link(&temporary, marker, FILE) {
            Ok(()) => crate::durable_storage::sync_directory(marker)?,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        read_marker(marker)
    })();
    drop(file);
    let _ = marker.remove_file(&temporary);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn legacy() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join(".situate")).unwrap();
        root
    }

    #[test]
    fn creation_reopen_rename_copy_and_independence() {
        let root = tempfile::tempdir().unwrap();
        let first = crate::workspaces::create(root.path(), "First").unwrap();
        let second = crate::workspaces::create(root.path(), "Second").unwrap();
        let id = read(Path::new(&first.handle)).unwrap();
        assert_ne!(Some(id.clone()), read(Path::new(&second.handle)));
        assert_eq!(admit(Path::new(&first.handle)), Some(id.clone()));
        fs::rename(&first.handle, root.path().join("Renamed")).unwrap();
        assert_eq!(read(&root.path().join("Renamed")), Some(id.clone()));
        let copy = legacy();
        fs::copy(
            root.path().join("Renamed/.situate/workspace.json"),
            copy.path().join(".situate/workspace.json"),
        )
        .unwrap();
        assert_eq!(admit(copy.path()), Some(id));
        assert_ne!(
            crate::workspaces::inspect(copy.path()).unwrap().id,
            first.id
        );
        let metadata: serde_json::Value =
            serde_json::from_slice(&fs::read(copy.path().join(".situate/workspace.json")).unwrap())
                .unwrap();
        assert_eq!(metadata.as_object().unwrap().len(), 2);
        assert_eq!(metadata["version"], 1);
    }

    #[test]
    fn read_does_not_migrate_and_concurrent_admissions_converge() {
        let root = legacy();
        assert_eq!(read(root.path()), None);
        assert_eq!(
            fs::read_dir(root.path().join(".situate")).unwrap().count(),
            0
        );
        let barrier = std::sync::Barrier::new(16);
        let identities = std::thread::scope(|scope| {
            let threads: Vec<_> = (0..16)
                .map(|_| {
                    scope.spawn(|| {
                        barrier.wait();
                        admit(root.path()).unwrap()
                    })
                })
                .collect();
            threads
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert!(identities.iter().all(|id| id == &identities[0]));
        let independent_legacy = legacy();
        assert_ne!(
            admit(independent_legacy.path()),
            Some(identities[0].clone())
        );
        assert_eq!(
            fs::read_dir(root.path().join(".situate")).unwrap().count(),
            1
        );
    }

    #[test]
    fn invalid_metadata_is_preserved_without_repair() {
        for bytes in [b"".to_vec(), b"private sentinel".to_vec(), vec![b' '; 1025], br#"{"version":1,"id":"00000000-0000-0000-0000-000000000000"}"#.to_vec(), br#"{"version":2,"id":"1d44dd21-3194-42cc-bb00-a2a8e77456ca"}"#.to_vec(), br#"{"version":1,"id":"1d44dd21-3194-42cc-bb00-a2a8e77456ca","device":"private sentinel"}"#.to_vec()] {
            let root = legacy();
            let path = root.path().join(".situate/workspace.json");
            fs::write(&path, &bytes).unwrap();
            assert_eq!(admit(root.path()), None);
            assert_eq!(fs::read(path).unwrap(), bytes);
            assert!(crate::workspaces::inspect(root.path()).is_ok());
        }
    }

    #[test]
    fn conflicting_fields_noncanonical_ids_and_nonfiles_are_unavailable() {
        let root = legacy();
        let file = root.path().join(".situate/workspace.json");
        for document in [
            r#"{"version":1,"id":"1d44dd21-3194-42cc-bb00-a2a8e77456ca","id":"fbc2d8d1-9f5d-420e-8e32-46f69f7ff762"}"#,
            r#"{"version":1.0,"id":"1d44dd21-3194-42cc-bb00-a2a8e77456ca"}"#,
            r#"{"version":1,"id":"1D44DD21-3194-42CC-BB00-A2A8E77456CA"}"#,
            r#"{"version":1,"id":"1d44dd21-3194-12cc-bb00-a2a8e77456ca"}"#,
        ] {
            fs::write(&file, document).unwrap();
            assert_eq!(admit(root.path()), None);
            assert_eq!(fs::read_to_string(&file).unwrap(), document);
        }
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        assert_eq!(admit(root.path()), None);
        assert!(file.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn read_only_workspace_can_read_but_does_not_initialize_identity() {
        use std::os::unix::fs::PermissionsExt;
        let root = legacy();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o500)).unwrap();
        assert_eq!(admit(root.path()), None);
        assert!(!root.path().join(".situate/workspace.json").exists());
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let id = admit(root.path()).unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o500)).unwrap();
        assert_eq!(admit(root.path()), Some(id));
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_and_read_only_metadata_are_not_changed() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let root = legacy();
        let outside = legacy();
        let file = root.path().join(".situate/workspace.json");
        symlink(outside.path().join("missing"), &file).unwrap();
        assert_eq!(admit(root.path()), None);
        assert!(!outside.path().join("missing").exists());
        fs::remove_file(&file).unwrap();
        fs::set_permissions(
            root.path().join(".situate"),
            fs::Permissions::from_mode(0o500),
        )
        .unwrap();
        assert_eq!(admit(root.path()), None);
        assert!(!file.exists());
        fs::set_permissions(
            root.path().join(".situate"),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        fs::remove_dir(root.path().join(".situate")).unwrap();
        symlink(
            outside.path().join(".situate"),
            root.path().join(".situate"),
        )
        .unwrap();
        assert_eq!(admit(root.path()), None);
        assert!(!outside.path().join(".situate/workspace.json").exists());
    }
}
