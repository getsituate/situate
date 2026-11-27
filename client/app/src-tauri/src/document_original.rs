use serde_json::{Value, json};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

pub(crate) const MAX_BYTES: u64 = 32 * 1024 * 1024;
pub(crate) const THUMBNAIL_READ_BYTES: u64 = 8 * 1024 * 1024;
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
    limit: u64,
}
impl OriginalWriter {
    pub(crate) fn new(limit: u64) -> Result<Self, String> {
        // The temporary file has no application-visible path, including after an interrupted download.
        let file = tempfile::tempfile().map_err(|_| UNAVAILABLE)?;
        Ok(Self {
            file,
            size: 0,
            limit,
        })
    }

    pub(crate) fn append(&mut self, bytes: &[u8]) -> Result<(), String> {
        let size = self.size + bytes.len() as u64;
        if size > self.limit {
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
    pub(crate) fn local(
        path: &Path,
        cancel: &CancellationToken,
        limit: u64,
    ) -> Result<Self, String> {
        if !path.is_absolute() {
            return Err("native.plugins.invalidPath".into());
        }
        let metadata = std::fs::symlink_metadata(path).map_err(local_error)?;
        if !metadata.is_file() {
            return Err("native.plugins.invalidPath".into());
        }
        if metadata.len() > limit {
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
        let mut output = OriginalWriter::new(limit)?;
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

#[cfg(desktop)]
pub(crate) use external::Copies;

#[cfg(desktop)]
mod external {
    use super::*;
    use std::{
        io,
        time::{Duration, Instant},
    };
    use tempfile::TempDir;

    const MAX_COPIES: usize = 16;
    const LIFETIME: Duration = Duration::from_secs(60 * 60);
    const OPEN_FAILED: &str = "native.files.external.openFailed";

    #[derive(Default)]
    pub(crate) struct Copies(Mutex<Vec<(Instant, TempDir)>>);

    impl Copies {
        pub(crate) fn open(
            &self,
            original: &Original,
            mime_type: &str,
            authorized: impl FnOnce() -> Result<(), String>,
            launch: impl FnOnce(&Path) -> io::Result<()>,
        ) -> Result<Instant, String> {
            let suffix = suffix(mime_type).ok_or("documents.openUnsupported")?;
            let mut copies = self.0.lock().map_err(|_| OPEN_FAILED)?;
            copies.retain(|(expires, _)| *expires > Instant::now());
            if copies.len() >= MAX_COPIES {
                return Err("documents.openCopiesFull".into());
            }
            let mut builder = tempfile::Builder::new();
            builder.prefix("situate-document-");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                builder.permissions(std::fs::Permissions::from_mode(0o700));
            }
            let directory = builder.tempdir().map_err(|_| OPEN_FAILED)?;
            let path = directory.path().join(format!("Document.{suffix}"));
            copy(original, &path).map_err(|_| OPEN_FAILED)?;
            authorized()?;
            launch(&path).map_err(|_| OPEN_FAILED)?;
            let expires = Instant::now() + LIFETIME;
            // A file association can acknowledge the request before the app reads the file.
            copies.push((expires, directory));
            Ok(expires)
        }

        pub(crate) fn expire(&self) {
            if let Ok(mut copies) = self.0.lock() {
                copies.retain(|(expires, _)| *expires > Instant::now());
            }
        }

        pub(crate) fn clear(&self) {
            if let Ok(mut copies) = self.0.lock() {
                copies.clear();
            }
        }
    }

    fn suffix(mime_type: &str) -> Option<&'static str> {
        Some(match mime_type {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/tiff" => "tiff",
            "image/webp" => "webp",
            "image/heic" => "heic",
            "text/plain" => "txt",
            "text/markdown" => "md",
            "text/csv" => "csv",
            "application/rtf" | "text/rtf" => "rtf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
            "application/vnd.oasis.opendocument.text" => "odt",
            "application/vnd.oasis.opendocument.spreadsheet" => "ods",
            "application/vnd.oasis.opendocument.presentation" => "odp",
            _ => return None,
        })
    }

    fn copy(original: &Original, path: &Path) -> io::Result<()> {
        let mut input = original
            .file
            .lock()
            .map_err(|_| io::Error::other(UNAVAILABLE))?;
        input.rewind()?;
        let mut prefix = [0; 4];
        let prefix = &mut prefix[..original.size.min(4) as usize];
        input.read_exact(prefix)?;
        if crate::external_links::executable_signature(prefix) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not a document"));
        }
        input.rewind()?;
        let mut output = OpenOptions::new().write(true).create_new(true).open(path)?;
        if io::copy(&mut (&mut *input).take(original.size), &mut output)? != original.size {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        output.flush()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn original(bytes: &[u8]) -> Original {
            let mut writer = OriginalWriter::new(MAX_BYTES).unwrap();
            writer.append(bytes).unwrap();
            writer.finish().unwrap()
        }

        #[test]
        fn hands_off_the_exact_copy_with_a_document_extension_and_retains_it() {
            let copies = Copies::default();
            let bytes = b"PK\x03\x04spreadsheet";
            let mut path = None;
            copies
                .open(
                    &original(bytes),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    || Ok(()),
                    |target| {
                        assert_eq!(target.extension().unwrap(), "xlsx");
                        assert_eq!(std::fs::read(target).unwrap(), bytes);
                        path = Some(target.to_owned());
                        Ok(())
                    },
                )
                .unwrap();
            let path = path.unwrap();
            assert!(path.is_file());
            copies.clear();
            assert!(!path.exists());
        }

        #[test]
        fn does_not_launch_unapproved_types_executables_or_revoked_reads() {
            let copies = Copies::default();
            let no_launch = |_: &Path| -> io::Result<()> { panic!("unexpected handoff") };
            assert_eq!(
                copies.open(
                    &original(b"data"),
                    "application/octet-stream",
                    || Ok(()),
                    no_launch
                ),
                Err("documents.openUnsupported".into())
            );
            assert_eq!(
                copies.open(
                    &original(b"MZdata"),
                    "application/pdf",
                    || Ok(()),
                    no_launch
                ),
                Err(OPEN_FAILED.into())
            );
            assert_eq!(
                copies.open(
                    &original(b"%PDF-"),
                    "application/pdf",
                    || Err(CANCELLED.into()),
                    no_launch
                ),
                Err(CANCELLED.into())
            );
            assert!(copies.0.lock().unwrap().is_empty());
        }

        #[test]
        fn discards_the_copy_when_the_default_app_cannot_be_started() {
            let copies = Copies::default();
            let mut path = None;
            assert_eq!(
                copies.open(
                    &original(b"%PDF-"),
                    "application/pdf",
                    || Ok(()),
                    |target| {
                        path = Some(target.to_owned());
                        Err(io::Error::other("no default handler"))
                    }
                ),
                Err(OPEN_FAILED.into())
            );
            assert!(!path.unwrap().exists());
        }
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
    pub(crate) limit: u64,
}
impl OriginalSlot {
    pub(crate) fn new(id: String, limit: u64) -> Self {
        Self {
            id,
            file: Mutex::new(None),
            limit,
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
        let original = Original::local(&path, &cancellation, MAX_BYTES).unwrap();
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
    fn automatic_reads_stop_at_their_lower_limit_without_restricting_the_reader() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large.pdf");
        let size = THUMBNAIL_READ_BYTES + 1;
        File::create(&path).unwrap().set_len(size).unwrap();
        let cancel = CancellationToken::new();
        assert!(
            matches!(Original::local(&path, &cancel, THUMBNAIL_READ_BYTES), Err(error) if error == TOO_LARGE)
        );
        assert_eq!(
            Original::local(&path, &cancel, MAX_BYTES)
                .unwrap()
                .descriptor("read")["size"],
            size
        );
        let mut writer = OriginalWriter::new(4).unwrap();
        writer.append(&[1, 2, 3]).unwrap();
        assert_eq!(writer.append(&[4, 5]).unwrap_err(), TOO_LARGE);
    }

    #[test]
    fn rejects_oversized_and_cancelled_originals_without_publishing_a_handle() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large.pdf");
        File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        let slot = OriginalSlot::new("unused".into(), MAX_BYTES);
        let cancellation = CancellationToken::new();
        assert_eq!(
            slot.stage(
                || Original::local(&path, &cancellation, slot.limit),
                &cancellation
            )
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
