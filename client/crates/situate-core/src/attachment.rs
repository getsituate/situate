use crate::ai_storage::Storage;
use chacha20poly1305::{
    XChaCha20Poly1305,
    aead::{AeadCore, OsRng},
};
use serde::{Deserialize, Serialize};

pub const MAX_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;
const INVALID: &str = "native.ai.conversation.versionInvalid";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentRef {
    pub id: String,
    pub mime_type: String,
    pub size: u64,
    pub name: String,
}

impl AttachmentRef {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.len() != 48
            || !self
                .id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || self.size == 0
            || self.size > MAX_ATTACHMENT_BYTES as u64
            || self.name.len() > 1024
            || !matches!(
                self.mime_type.as_str(),
                "image/png"
                    | "image/jpeg"
                    | "image/gif"
                    | "image/webp"
                    | "text/plain"
                    | "application/pdf"
            )
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}

fn validate_media(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "text/plain" => std::str::from_utf8(bytes).is_ok() && !bytes.contains(&0),
        _ => false,
    }
}

impl Storage {
    pub fn put_attachment(
        &self,
        mime: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<AttachmentRef, String> {
        let id = XChaCha20Poly1305::generate_nonce(&mut OsRng)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let reference = AttachmentRef {
            id,
            mime_type: mime.into(),
            size: bytes.len() as u64,
            name: name.into(),
        };
        reference.validate()?;
        if !validate_media(mime, bytes) {
            return Err(INVALID.into());
        }
        let _lock = self.lock_named("attachments.lock")?;
        let binary = format!("attachment-{}.bin", reference.id);
        if !self.replace(&binary, &format!("{binary}.tmp"), bytes)? {
            return Err("native.ai.conversation.durability".into());
        }
        let metadata = format!("attachment-{}.json", reference.id);
        if !self.replace(
            &metadata,
            &format!("{metadata}.tmp"),
            &serde_json::to_vec(&reference).map_err(|_| INVALID)?,
        )? {
            return Err("native.ai.conversation.durability".into());
        }
        Ok(reference)
    }

    pub fn read_attachment(&self, id: &str) -> Result<(AttachmentRef, Vec<u8>), String> {
        AttachmentRef {
            id: id.into(),
            mime_type: "text/plain".into(),
            size: 1,
            name: String::new(),
        }
        .validate()?;
        let metadata = self
            .read_named(&format!("attachment-{id}.json"), 4096)?
            .ok_or(INVALID)?;
        let reference: AttachmentRef = serde_json::from_slice(&metadata).map_err(|_| INVALID)?;
        reference.validate()?;
        if reference.id != id {
            return Err(INVALID.into());
        }
        let bytes = self
            .read_named(&format!("attachment-{id}.bin"), MAX_ATTACHMENT_BYTES as u64)?
            .ok_or(INVALID)?;
        if bytes.len() as u64 != reference.size || !validate_media(&reference.mime_type, &bytes) {
            return Err(INVALID.into());
        }
        Ok((reference, bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn attachment_symlinks_cannot_read_external_bytes() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join(".situate")).unwrap();
        let storage = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
        let reference = storage
            .put_attachment("text/plain", "note", b"original")
            .unwrap();
        let binary = temp
            .path()
            .join(format!(".situate/attachment-{}.bin", reference.id));
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(outside.path(), b"external").unwrap();
        std::fs::remove_file(&binary).unwrap();
        std::os::unix::fs::symlink(outside.path(), &binary).unwrap();
        assert!(storage.read_attachment(&reference.id).is_err());
        assert_eq!(std::fs::read(outside.path()).unwrap(), b"external");
    }

    #[test]
    fn binary_roundtrip_bounds_media_and_safe_ids() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join(".situate")).unwrap();
        let storage = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
        let bytes = b"\x89PNG\r\n\x1a\n\0\xff";
        let reference = storage
            .put_attachment("image/png", "picture.png", bytes)
            .unwrap();
        let reopened = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
        assert_eq!(
            reopened.read_attachment(&reference.id).unwrap(),
            (reference.clone(), bytes.to_vec())
        );
        assert!(storage.read_attachment("../outside").is_err());
        assert!(
            storage
                .put_attachment("image/png", "bad", b"not png")
                .is_err()
        );
        assert!(
            storage
                .put_attachment("text/html", "bad", b"<script>")
                .is_err()
        );
        assert!(storage.put_attachment("text/plain", "empty", b"").is_err());
        assert!(
            storage
                .put_attachment("text/plain", "large", &vec![b'a'; MAX_ATTACHMENT_BYTES + 1])
                .is_err()
        );
        let maximum = storage
            .put_attachment("text/plain", "maximum", &vec![b'a'; MAX_ATTACHMENT_BYTES])
            .unwrap();
        assert_eq!(
            storage.read_attachment(&maximum.id).unwrap().1.len(),
            MAX_ATTACHMENT_BYTES
        );
        std::fs::write(
            temp.path()
                .join(format!(".situate/attachment-{}.bin", reference.id)),
            b"changed",
        )
        .unwrap();
        assert!(storage.read_attachment(&reference.id).is_err());
    }
}
