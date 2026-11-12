use situate_core::diagnostics::{
    Collector, Destination, DestinationFilter, DestinationRegistration, FileDestination,
    HostIdentity,
};
use std::{
    fs,
    io::{self, Write},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
};

#[derive(Clone)]
pub(super) struct Manifest {
    path: PathBuf,
}
impl Manifest {
    pub(super) fn from_env() -> Option<Self> {
        Self::at(std::env::var_os("SITUATE_DEV_DIAGNOSTICS_MANIFEST")?.into()).ok()
    }
    fn at(path: PathBuf) -> io::Result<Self> {
        let parent = path
            .parent()
            .filter(|_| path.is_absolute())
            .ok_or(io::ErrorKind::InvalidInput)?;
        let metadata = fs::symlink_metadata(parent)?;
        if !metadata.is_dir()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o077 != 0
        {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        match fs::symlink_metadata(&path) {
            Ok(metadata)
                if !metadata.is_file()
                    || metadata.uid() != unsafe { libc::geteuid() }
                    || metadata.permissions().mode() & 0o077 != 0 =>
            {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        Ok(Self { path })
    }
    pub(super) fn publish(&self, directory: &str, session_id: &str, ready: bool) {
        if self.write(directory, session_id, ready).is_err() {
            let _ = fs::remove_file(&self.path);
        }
    }
    fn write(&self, directory: &str, session_id: &str, ready: bool) -> io::Result<()> {
        let parent = self.path.parent().ok_or(io::ErrorKind::InvalidInput)?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
        serde_json::to_writer(
            &mut file,
            &serde_json::json!({
                "version": 1,
                "directory": directory,
                "session_id": session_id,
                "status": if ready { "ready" } else { "unavailable" },
            }),
        )?;
        file.flush()?;
        file.persist(&self.path).map_err(|error| error.error)?;
        Ok(())
    }
}

struct DiscoveredFile {
    directory: PathBuf,
    session_id: String,
    manifest: Manifest,
    writer: Option<FileDestination>,
}
impl DiscoveredFile {
    fn open(&mut self) -> bool {
        self.writer = FileDestination::open(&self.directory).ok();
        self.manifest.publish(
            &self.directory.to_string_lossy(),
            &self.session_id,
            self.writer.is_some(),
        );
        self.writer.is_some()
    }
    fn observe_io(&mut self, result: io::Result<()>) -> io::Result<()> {
        if result.is_err() {
            self.writer = None;
            self.manifest
                .publish(&self.directory.to_string_lossy(), &self.session_id, false);
        }
        result
    }
}
impl Destination for DiscoveredFile {
    fn write(&mut self, record: &[u8]) -> io::Result<()> {
        let result = self
            .writer
            .as_mut()
            .ok_or(io::ErrorKind::NotConnected)?
            .write(record);
        self.observe_io(result)
    }
    fn flush(&mut self) -> io::Result<()> {
        let result = self.writer.as_mut().map_or(Ok(()), Destination::flush);
        self.observe_io(result)
    }
    fn recover(&mut self) -> bool {
        self.open()
    }
}

pub(super) fn start(
    directory: &Path,
    identity: HostIdentity,
    manifest: Manifest,
) -> io::Result<Collector> {
    let failure_manifest = manifest.clone();
    let session_id = identity.session_id.clone();
    let mut destination = DiscoveredFile {
        directory: directory.into(),
        session_id: identity.session_id.clone(),
        manifest,
        writer: None,
    };
    destination.open();
    Collector::with_destinations(
        identity,
        vec![DestinationRegistration {
            destination: Box::new(destination),
            filter: DestinationFilter::default(),
        }],
    )
    .inspect_err(|_| failure_manifest.publish(&directory.to_string_lossy(), &session_id, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use uuid::Uuid;

    fn private_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        root
    }
    #[test]
    fn manifest_requires_an_absolute_private_owned_parent_and_regular_private_target() {
        let root = private_root();
        let canonical = root.path().canonicalize().unwrap();
        assert!(Manifest::at(PathBuf::from("relative.json")).is_err());
        let path = canonical.join("launch.json");
        assert!(Manifest::at(path.clone()).is_ok());
        fs::write(&path, b"{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(Manifest::at(path.clone()).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(Manifest::at(path.clone()).is_ok());
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(Manifest::at(path.clone()).is_err());
        fs::remove_dir(&path).unwrap();
        fs::set_permissions(&canonical, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(Manifest::at(path.clone()).is_err());
        fs::set_permissions(&canonical, fs::Permissions::from_mode(0o700)).unwrap();
        std::os::unix::fs::symlink("missing", &path).unwrap();
        assert!(Manifest::at(path).is_err());
        let alias = canonical.join("alias");
        std::os::unix::fs::symlink(&canonical, &alias).unwrap();
        assert!(Manifest::at(alias.join("launch.json")).is_err());
    }
    #[test]
    fn publication_is_private_and_replaces_complete_json_with_exact_launch_identity() {
        let root = private_root();
        let path = root.path().canonicalize().unwrap().join("launch.json");
        let manifest = Manifest::at(path.clone()).unwrap();
        let session = Uuid::new_v4().to_string();
        for (directory, ready) in [
            ("", false),
            ("/synthetic/logs", true),
            ("/synthetic/logs", false),
        ] {
            manifest.write(directory, &session, ready).unwrap();
            let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(
                value,
                json!({"version":1,"directory":directory,"session_id":session,"status":if ready {"ready"} else {"unavailable"}})
            );
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
        }
    }
    #[test]
    fn successive_native_sessions_replace_the_same_launch_manifest() {
        let root = private_root();
        let path = root.path().join("launch.json");
        let logs = root.path().join("logs");
        let first_session = Uuid::new_v4().to_string();
        let second_session = Uuid::new_v4().to_string();
        for session in [&first_session, &second_session] {
            let manifest = Manifest::at(path.clone()).unwrap();
            let collector = start(
                &logs,
                HostIdentity {
                    device_id: Uuid::new_v4().to_string(),
                    session_id: session.clone(),
                    app_version: "0.0.1".into(),
                    platform: "test".into(),
                    platform_version: "1".into(),
                },
                manifest,
            )
            .unwrap();
            let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(value["session_id"], *session);
            assert_eq!(value["status"], "ready");
            assert_eq!(value["directory"], logs.to_string_lossy().as_ref());
            assert!(collector.shutdown(std::time::Duration::from_secs(1)));
        }
    }

    #[test]
    fn writer_lock_failure_is_unavailable_and_recovery_publishes_ready() {
        let root = private_root();
        let directory = root.path().join("logs");
        let first = FileDestination::open(&directory).unwrap();
        let path = root.path().canonicalize().unwrap().join("launch.json");
        let mut destination = DiscoveredFile {
            directory,
            session_id: Uuid::new_v4().to_string(),
            manifest: Manifest::at(path.clone()).unwrap(),
            writer: None,
        };
        assert!(!destination.open());
        let read = || serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(read()["status"], "unavailable");
        assert!(Path::new(read()["directory"].as_str().unwrap()).is_absolute());
        drop(first);
        assert!(destination.recover());
        assert_eq!(read()["status"], "ready");
        destination.write(b"{}\n").unwrap();
        destination.flush().unwrap();
        assert!(destination.write(&vec![b'x'; 32 * 1024]).is_err());
        assert_eq!(read()["status"], "unavailable");
        assert!(destination.writer.is_none());
        assert!(destination.recover());
        assert_eq!(read()["status"], "ready");
    }
}
