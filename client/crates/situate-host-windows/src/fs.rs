#[cfg(test)]
mod tests;

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, DirBuilder, Metadata, OpenOptions};
use std::{
    ffi::OsStr,
    fs::File,
    io,
    path::{Component, Path, PathBuf},
};

pub struct HostFs;
impl situate_host_api::fs::FilesystemHost for HostFs {
    fn directory_for_sync(directory: &Dir) -> io::Result<File> {
        directory_for_sync(directory)
    }

    fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()> {
        rename_noreplace(from, old, to, new)
    }
}

pub const WRITABLE_SYNC_HANDLE: bool = true;
pub const RECHECK_HISTORY_CONTROLS: bool = true;
pub const RECOVER_UNFLUSHED_HISTORY: bool = false;
pub const RELEASE_CHILD_BEFORE_MOVE: bool = true;
pub const REMOVE_FAILED_HISTORY_STAGE: bool = false;
pub const STAGE_WORKSPACE_MARKER: bool = false;

pub fn private_file_options(_options: &mut OpenOptions) {}
pub fn nonblocking_file_options(_options: &mut OpenOptions) {}
pub fn private_dir_builder(_builder: &mut DirBuilder) {}
pub fn restrict_directory(_dir: &Dir, _name: &str) -> io::Result<()> {
    Ok(())
}
pub fn enforce_single_link_on_write(_file: &cap_std::fs::File) -> io::Result<bool> {
    Ok(true)
}
pub fn is_private_record(_metadata: &Metadata) -> bool {
    true
}
pub fn file_cache_identity(_metadata: &std::fs::Metadata) -> Option<(u64, u64)> {
    None
}
pub fn file_change_identity(_metadata: &Metadata) -> Option<(u64, u64, i64, i64, u32)> {
    None
}
pub fn executable(_metadata: &Metadata) -> bool {
    false
}
pub fn sync_registry_parent(_path: &Path) -> io::Result<()> {
    Ok(())
}

pub fn replace_file_write_through(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain([0])
            .collect::<Vec<_>>()
    };
    let from = wide(from);
    let to = wide(to);
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()> {
    use std::os::windows::{ffi::OsStrExt, ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, MoveFileExW};
    fn path(dir: &Dir, name: &str) -> io::Result<Vec<u16>> {
        let file = dir.try_clone()?.into_std_file();
        let mut buffer = vec![0u16; 32768];
        // The directory handle was opened without following symlinks. Windows
        // publication still requires ancestors to stay put until MoveFileExW.
        let size = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        if size as usize >= buffer.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "native.content.path.tooLong",
            ));
        }
        buffer.truncate(size as usize);
        let path = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer)).join(name);
        Ok(path.as_os_str().encode_wide().chain(Some(0)).collect())
    }
    let from = path(from, old)?;
    let to = path(to, new)?;
    // Zero flags exclude replacement, including an existing empty directory.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
pub fn publish_history(_marker: &Dir, stage: &str, history_path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let from: Vec<u16> = history_path
        .with_file_name(stage)
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let to: Vec<u16> = history_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Zero flags deliberately omit MOVEFILE_REPLACE_EXISTING. Both buffers are NUL-terminated.
    if unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0)
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
pub fn history_file_for_sync(dir: &Dir, name: &OsStr) -> io::Result<File> {
    use cap_std::fs::OpenOptionsExt;
    use std::os::windows::{
        fs::MetadataExt,
        io::{AsRawHandle, FromRawHandle},
    };
    use windows_sys::Win32::{
        Foundation::{GENERIC_WRITE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ, FILE_SHARE_WRITE, ReOpenFile,
        },
    };

    let mut options = OpenOptions::new();
    options
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .follow(FollowSymlinks::No);
    let file = dir.open_with(name, &options)?.into_std();
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "History entry is not a regular file.",
        ));
    }
    // Changing READONLY also changes every hard-link alias, including aliases
    // outside history. Do not acquire write access by changing file attributes.
    if metadata.permissions().readonly() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Read-only history files cannot be synchronized safely.",
        ));
    }
    let identity = same_file::Handle::from_file(file.try_clone()?)?;
    let handle = unsafe {
        ReOpenFile(
            file.as_raw_handle(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_FLAG_OPEN_REPARSE_POINT,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let writable = unsafe { File::from_raw_handle(handle) };
    let metadata = writable.metadata()?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || same_file::Handle::from_file(writable.try_clone()?)? != identity
    {
        return Err(io::Error::other(
            "History file identity changed before synchronization.",
        ));
    }
    Ok(writable)
}
pub fn storage_root(
    path: &Path,
) -> Result<(std::path::PathBuf, std::path::Components<'_>), io::Error> {
    if !path.is_absolute() {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let mut components = path.components();
    let mut root = PathBuf::new();
    let implicit_unc_root = {
        use std::path::Prefix;
        let Some(Component::Prefix(prefix)) = components.next() else {
            return Err(io::ErrorKind::InvalidInput.into());
        };
        match prefix.kind() {
            Prefix::Disk(_)
            | Prefix::VerbatimDisk(_)
            | Prefix::UNC(_, _)
            | Prefix::VerbatimUNC(_, _) => root.push(prefix.as_os_str()),
            _ => return Err(io::ErrorKind::InvalidInput.into()),
        }
        matches!(prefix.kind(), Prefix::VerbatimUNC(_, _))
    };
    match components.clone().next() {
        Some(Component::RootDir) => {
            components.next();
        }
        // A bare verbatim UNC share is absolute but has no RootDir component.
        None if implicit_unc_root => {}
        _ => return Err(io::ErrorKind::InvalidInput.into()),
    }
    root.push(std::path::MAIN_SEPARATOR_STR);
    Ok((root, components))
}
pub enum PatchIdentity {
    Ordinary(same_file::Handle),
    Detached {
        _pin: File,
        id: windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO,
    },
}

impl PatchIdentity {
    pub fn new(identity: same_file::Handle, inside_moved_directory: bool) -> io::Result<Self> {
        if inside_moved_directory {
            return detached_patch_identity(identity);
        }
        Ok(Self::Ordinary(identity))
    }

    pub fn matches(&self, candidate: &same_file::Handle) -> io::Result<bool> {
        match self {
            Self::Ordinary(identity) => Ok(identity == candidate),
            Self::Detached { id, .. } => {
                Ok(same_windows_file_ids(id, &windows_file_id(candidate)?))
            }
        }
    }
}

fn windows_file_id(
    file: &impl std::os::windows::io::AsRawHandle,
) -> io::Result<windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO> {
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
    };
    let mut id = FILE_ID_INFO::default();
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut id as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(id)
}

fn same_windows_file_ids(
    left: &windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO,
    right: &windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO,
) -> bool {
    left.VolumeSerialNumber == right.VolumeSerialNumber
        && left.FileId.Identifier == right.FileId.Identifier
}

fn detached_patch_identity(identity: same_file::Handle) -> io::Result<PatchIdentity> {
    use std::os::windows::{
        fs::MetadataExt,
        io::{AsRawHandle, FromRawHandle},
    };
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        Storage::FileSystem::{
            ExtendedFileIdType, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_ID_DESCRIPTOR, FILE_ID_DESCRIPTOR_0, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
            FILE_SHARE_READ, FILE_SHARE_WRITE, OpenFileById,
        },
    };
    let id = windows_file_id(&identity)?;
    let descriptor = FILE_ID_DESCRIPTOR {
        dwSize: std::mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
        Type: ExtendedFileIdType,
        Anonymous: FILE_ID_DESCRIPTOR_0 {
            ExtendedFileId: id.FileId,
        },
    };
    // Relative-open readers and ReOpenFile handles can block ancestor moves.
    // Open by ID while keeping the original handle alive until verification.
    let handle = unsafe {
        OpenFileById(
            identity.as_raw_handle(),
            &descriptor,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            FILE_FLAG_OPEN_REPARSE_POINT,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let pin = unsafe { File::from_raw_handle(handle) };
    let metadata = pin.metadata()?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || !same_windows_file_ids(&id, &windows_file_id(&pin)?)
    {
        return Err(io::Error::other(
            "Content identity changed while opening its identity handle.",
        ));
    }
    Ok(PatchIdentity::Detached { _pin: pin, id })
}
pub fn is_single_link(file: &File, _metadata: &std::fs::Metadata) -> io::Result<bool> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };
    let mut information = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { information.assume_init() }.nNumberOfLinks == 1)
}
pub fn directory_for_sync(dir: &Dir) -> io::Result<File> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsMaybeDirExt};
    let mut options = cap_std::fs::OpenOptions::new();
    options
        .write(true)
        .maybe_dir(true)
        .follow(FollowSymlinks::No);
    // FlushFileBuffers needs write access, but ReOpenFile rejects directory
    // handles. cap-std opens "." through NtCreateFile relative to the held handle.
    dir.open_with(".", &options)
        .map(cap_std::fs::File::into_std)
}

pub fn publish_new_file(dir: &Dir, stage: &str, name: &str) -> io::Result<()> {
    dir.hard_link(stage, dir, name)
}
/// Finish the batch before publishing references to its files.
#[derive(Default)]
#[must_use]
pub struct SyncBatch {
    _private: (),
}
impl SyncBatch {
    pub fn sync_file(&mut self, file: File) -> io::Result<()> {
        file.sync_all()
    }
    pub fn sync_directory(&mut self, dir: &Dir) -> io::Result<()> {
        self.sync_file(directory_for_sync(dir)?)
    }
    pub fn finish(self) -> io::Result<()> {
        Ok(())
    }
}
