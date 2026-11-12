use super::{Destination, MAX_EVENT_BYTES};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::{
    collections::VecDeque,
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
};
use uuid::Uuid;

pub const TOTAL_BYTES: u64 = 256 * 1024 * 1024;
pub const SEGMENT_BYTES: u64 = 4 * 1024 * 1024;
const MAX_FILES: usize = 64;

fn invalid() -> io::Error {
    io::Error::from(io::ErrorKind::InvalidData)
}

fn directory(path: &Path) -> io::Result<Dir> {
    std::fs::create_dir_all(path)?;
    let parent = Dir::open_ambient_dir(
        path.parent().ok_or_else(invalid)?,
        cap_std::ambient_authority(),
    )?;
    let file = cap_primitives::fs::open_dir_nofollow(
        &parent.into_std_file(),
        Path::new(path.file_name().ok_or_else(invalid)?),
    )?;
    let dir = Dir::from_std_file(file);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        dir.set_permissions(
            ".",
            cap_std::fs::Permissions::from_std(std::fs::Permissions::from_mode(0o700)),
        )?;
    }
    Ok(dir)
}

fn open(dir: &Dir, name: &str, create: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).follow(FollowSymlinks::No);
    if create {
        options.create_new(true);
    }
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = dir.open_with(name, &options)?.into_std();
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(invalid());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(invalid());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        let mut information = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
        if unsafe {
            GetFileInformationByHandle(file.as_raw_handle().cast(), information.as_mut_ptr())
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if unsafe { information.assume_init() }.nNumberOfLinks != 1 {
            return Err(invalid());
        }
    }
    Ok(file)
}

pub fn load_or_create_device_id(path: &Path) -> io::Result<String> {
    let dir = directory(path)?;
    match open(&dir, "device-id", false) {
        Ok(mut file) => {
            if file.metadata()?.len() != 36 {
                return Err(invalid());
            }
            let mut value = String::new();
            file.read_to_string(&mut value)?;
            if !super::valid_uuid(&value) {
                return Err(invalid());
            }
            Ok(value)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let mut file = match open(&dir, "device-id", true) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    return load_or_create_device_id(path);
                }
                Err(error) => return Err(error),
            };
            let value = Uuid::new_v4().to_string();
            file.write_all(value.as_bytes())?;
            file.sync_all()?;
            Ok(value)
        }
        Err(error) => Err(error),
    }
}

struct Segment {
    name: String,
    size: u64,
}

pub struct FileDestination {
    dir: Dir,
    _lock: File,
    segments: VecDeque<Segment>,
    active: Option<File>,
    next: u64,
    total: u64,
    budget: u64,
    segment_limit: u64,
    failed: bool,
}

impl FileDestination {
    pub fn open(path: &Path) -> io::Result<Self> {
        Self::with_limits(path, TOTAL_BYTES, SEGMENT_BYTES)
    }

    pub fn with_limits(path: &Path, budget: u64, segment_limit: u64) -> io::Result<Self> {
        if segment_limit == 0
            || segment_limit > SEGMENT_BYTES
            || budget < segment_limit
            || budget > TOTAL_BYTES
        {
            return Err(invalid());
        }
        let dir = directory(path)?;
        let lock = match open(&dir, "writer.lock", true) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                open(&dir, "writer.lock", false)?
            }
            Err(error) => return Err(error),
        };
        lock.try_lock()
            .map_err(|_| io::Error::from(io::ErrorKind::WouldBlock))?;
        let mut segments = Vec::new();
        for entry in dir.entries()? {
            let entry = entry?;
            let name = entry.file_name().into_string().map_err(|_| invalid())?;
            if name == "writer.lock" || name == "device-id" {
                continue;
            }
            if !is_segment(&name) || !entry.file_type()?.is_file() || segments.len() >= 4096 {
                return Err(invalid());
            }
            let file = open(&dir, &name, false)?;
            segments.push(Segment {
                name,
                size: file.metadata()?.len(),
            });
        }
        segments.sort_by(|a, b| a.name.cmp(&b.name));
        let next = segments
            .last()
            .map(|s| s.name[8..28].parse::<u64>().map_err(|_| invalid()))
            .transpose()?
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(invalid)?;
        let total = segments.iter().try_fold(0u64, |total, s| {
            total.checked_add(s.size).ok_or_else(invalid)
        })?;
        let mut writer = Self {
            dir,
            _lock: lock,
            segments: segments.into(),
            active: None,
            next,
            total,
            budget,
            segment_limit,
            failed: false,
        };
        writer.evict(0, false)?;
        if let Some(last) = writer.segments.back_mut() {
            let mut file = open(&writer.dir, &last.name, false)?;
            let retained = complete_prefix(&mut file, last.size)?;
            file.set_len(retained)?;
            writer.total -= last.size - retained;
            last.size = retained;
            file.seek(SeekFrom::End(0))?;
            writer.active = Some(file);
        }
        Ok(writer)
    }

    fn evict(&mut self, incoming: u64, new_file: bool) -> io::Result<()> {
        while self.total.saturating_add(incoming) > self.budget
            || self.segments.len() + usize::from(new_file) > MAX_FILES
        {
            let segment = self.segments.front().ok_or_else(invalid)?;
            if self.segments.len() == 1 {
                self.active = None;
            }
            // Opening without symlink traversal also rejects substituted links before deletion.
            let _ = open(&self.dir, &segment.name, false)?;
            self.dir.remove_file(&segment.name)?;
            self.total -= segment.size;
            self.segments.pop_front();
        }
        Ok(())
    }

    fn append(&mut self, bytes: &[u8]) -> io::Result<()> {
        let length = bytes.len() as u64;
        if length == 0
            || length > self.segment_limit
            || bytes.len() > MAX_EVENT_BYTES
            || bytes.last() != Some(&b'\n')
            || bytes[..bytes.len() - 1].contains(&b'\n')
            || std::str::from_utf8(bytes).is_err()
        {
            return Err(invalid());
        }
        let rotate = self
            .segments
            .back()
            .is_none_or(|s| s.size + length > self.segment_limit);
        if rotate {
            self.active = None;
        }
        self.evict(length, rotate)?;
        if self.active.is_none() {
            self.evict(length, true)?;
            let name = format!("segment-{:020}.jsonl", self.next);
            self.next = self.next.checked_add(1).ok_or_else(invalid)?;
            self.active = Some(open(&self.dir, &name, true)?);
            self.segments.push_back(Segment { name, size: 0 });
        }
        let file = self.active.as_mut().ok_or_else(invalid)?;
        let old_size = self.segments.back().ok_or_else(invalid)?.size;
        if let Err(error) = file.write_all(bytes) {
            let _ = file.set_len(old_size);
            return Err(error);
        }
        self.segments.back_mut().ok_or_else(invalid)?.size += length;
        self.total += length;
        Ok(())
    }
}

fn is_segment(name: &str) -> bool {
    name.len() == 34
        && name.starts_with("segment-")
        && name.ends_with(".jsonl")
        && name.as_bytes()[8..28].iter().all(u8::is_ascii_digit)
}

fn complete_prefix(file: &mut File, length: u64) -> io::Result<u64> {
    let mut end = length;
    let mut buffer = [0u8; 8192];
    while end > 0 {
        let start = end.saturating_sub(buffer.len() as u64);
        let count = (end - start) as usize;
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut buffer[..count])?;
        if let Some(index) = buffer[..count].iter().rposition(|b| *b == b'\n') {
            return Ok(start + index as u64 + 1);
        }
        end = start;
    }
    Ok(0)
}

impl Destination for FileDestination {
    fn write(&mut self, record: &[u8]) -> io::Result<()> {
        if self.failed {
            return Err(io::ErrorKind::NotConnected.into());
        }
        let result = self.append(record);
        self.failed = result.is_err();
        result
    }
    fn flush(&mut self) -> io::Result<()> {
        if let Some(file) = self.active.as_mut() {
            file.flush()?;
        }
        Ok(())
    }
}
