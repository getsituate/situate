use cap_std::fs::Dir;
use situate_host::fs::HostFs;
use situate_host_api::fs::FilesystemHost;
use std::io;

pub(crate) use situate_host::fs::SyncBatch;
#[cfg(all(test, target_vendor = "apple"))]
pub(crate) use situate_host::fs::testing;

pub(crate) fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()> {
    HostFs::rename_noreplace(from, old, to, new)
}

pub(crate) fn sync_directory(dir: &Dir) -> io::Result<()> {
    HostFs::directory_for_sync(dir)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cap_std::ambient_authority;
    use std::{fs, path::Path};

    #[test]
    fn nofollow_directory_can_be_synced() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("data")).unwrap();
        let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        let dir = Dir::from_std_file(
            cap_primitives::fs::open_dir_nofollow(&root.into_std_file(), Path::new("data"))
                .unwrap(),
        );
        dir.write("saved", b"contents").unwrap();
        let sync_handle = HostFs::directory_for_sync(&dir)
            .unwrap_or_else(|error| panic!("Opening directory sync handle failed: {error:?}"));
        sync_handle
            .sync_all()
            .unwrap_or_else(|error| panic!("Flushing directory sync handle failed: {error:?}"));
        sync_directory(&dir).unwrap();
    }
}
