use serde_json::{Value, json};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

pub(crate) const MAX_BYTES: u64 = 32 * 1024 * 1024;
pub(crate) const CHUNK_BYTES: usize = 1024 * 1024;
const UNAVAILABLE: &str = "native.plugins.unavailable";
const CANCELLED: &str = "native.plugins.hostCancelled";
const TOO_LARGE: &str = "native.plugins.tooLarge";

pub(crate) struct Original {
    file: Mutex<File>,
    size: u64,
}

pub(crate) struct OriginalWriter {
    file: File,
    size: u64,
}
impl OriginalWriter {
    pub(crate) fn new() -> Result<Self, String> {
        // The temporary file has no application-visible path, including after an interrupted download.
        let file = tempfile::tempfile().map_err(|_| UNAVAILABLE)?;
        Ok(Self { file, size: 0 })
    }

    pub(crate) fn append(&mut self, bytes: &[u8]) -> Result<(), String> {
        let size = self.size + bytes.len() as u64;
        if size > MAX_BYTES {
            return Err(TOO_LARGE.into());
        }
        self.file.write_all(bytes).map_err(|_| UNAVAILABLE)?;
        self.size = size;
        Ok(())
    }

    pub(crate) fn finish(self) -> Result<Original, String> {
        if self.size == 0 {
            return Err(UNAVAILABLE.into());
        }
        Ok(Original {
            file: Mutex::new(self.file),
            size: self.size,
        })
    }
}

impl Original {
    pub(crate) fn local(path: &Path, cancel: &CancellationToken) -> Result<Self, String> {
        if !path.is_absolute() {
            return Err("native.plugins.invalidPath".into());
        }
        let metadata = std::fs::symlink_metadata(path).map_err(local_error)?;
        if !metadata.is_file() {
            return Err("native.plugins.invalidPath".into());
        }
        if metadata.len() > MAX_BYTES {
            return Err(TOO_LARGE.into());
        }
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
            options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let mut input = options.open(path).map_err(local_error)?;
        let before = input.metadata().map_err(local_error)?;
        if !before.is_file() {
            return Err("native.plugins.invalidPath".into());
        }
        let mut output = OriginalWriter::new()?;
        let mut buffer = vec![0; 64 * 1024];
        loop {
            if cancel.is_cancelled() {
                return Err(CANCELLED.into());
            }
            let n = input.read(&mut buffer).map_err(local_error)?;
            if n == 0 {
                break;
            }
            output.append(&buffer[..n])?;
        }
        let after = input.metadata().map_err(local_error)?;
        if before.len() != output.size
            || after.len() != output.size
            || before.modified().ok() != after.modified().ok()
        {
            return Err(UNAVAILABLE.into());
        }
        output.finish()
    }

    pub(crate) fn descriptor(&self, id: &str) -> Value {
        json!({ "id": id, "size": self.size })
    }

    pub(crate) fn chunk(&self, offset: u64, cancel: &CancellationToken) -> Result<Vec<u8>, String> {
        if offset >= self.size
            || !offset.is_multiple_of(CHUNK_BYTES as u64)
            || cancel.is_cancelled()
        {
            return Err(UNAVAILABLE.into());
        }
        let mut file = self.file.lock().map_err(|_| UNAVAILABLE)?;
        let mut bytes = vec![0; (self.size - offset).min(CHUNK_BYTES as u64) as usize];
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| UNAVAILABLE)?;
        file.read_exact(&mut bytes).map_err(|_| UNAVAILABLE)?;
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        Ok(bytes)
    }
}

fn local_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "not-found",
        std::io::ErrorKind::PermissionDenied => "permission",
        _ => UNAVAILABLE,
    }
    .into()
}

pub(crate) fn outcome(error: &str) -> &'static str {
    match error {
        "not-found" => "not-found",
        "permission" => "permission",
        TOO_LARGE => "too-large",
        CANCELLED => "cancelled",
        _ => "unavailable",
    }
}

pub(crate) struct OriginalSlot {
    pub(crate) id: String,
    pub(crate) file: Mutex<Option<Original>>,
}
impl OriginalSlot {
    pub(crate) fn new(id: String) -> Self {
        Self {
            id,
            file: Mutex::new(None),
        }
    }

    pub(crate) fn stage(
        &self,
        create: impl FnOnce() -> Result<Original, String>,
        cancel: &CancellationToken,
    ) -> Result<Value, String> {
        let mut file = self.file.lock().map_err(|_| UNAVAILABLE)?;
        if file.is_some() {
            return Err(UNAVAILABLE.into());
        }
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let original = create()?;
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let descriptor = original.descriptor(&self.id);
        *file = Some(original);
        Ok(descriptor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_original_is_read_in_bounded_chunks_without_reopening_its_path() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("scan.pdf");
        let mut contents = vec![0xA3; CHUNK_BYTES];
        contents.extend_from_slice(&[10, 0, 255]);
        std::fs::write(&path, &contents).unwrap();
        let cancellation = CancellationToken::new();
        let original = Original::local(&path, &cancellation).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        assert_eq!(
            original.chunk(0, &cancellation).unwrap(),
            contents[..CHUNK_BYTES]
        );
        assert_eq!(
            original.chunk(CHUNK_BYTES as u64, &cancellation).unwrap(),
            [10, 0, 255]
        );
        assert!(original.chunk(1, &cancellation).is_err());
        cancellation.cancel();
        assert!(original.chunk(0, &cancellation).is_err());
    }

    #[test]
    fn rejects_oversized_and_cancelled_originals_without_publishing_a_handle() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large.pdf");
        File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        let slot = OriginalSlot::new("unused".into());
        let cancellation = CancellationToken::new();
        assert_eq!(
            slot.stage(|| Original::local(&path, &cancellation), &cancellation)
                .unwrap_err(),
            TOO_LARGE
        );
        assert!(slot.file.lock().unwrap().is_none());
        cancellation.cancel();
        assert_eq!(
            slot.stage(|| unreachable!(), &cancellation).unwrap_err(),
            CANCELLED
        );
        assert!(slot.file.lock().unwrap().is_none());
    }
}
