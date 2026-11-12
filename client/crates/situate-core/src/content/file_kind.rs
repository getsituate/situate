use std::io;

#[derive(Debug, PartialEq, Eq)]
pub enum FileContent<'a> {
    Text(&'a str),
    Binary,
}

/// Classifies bytes, not filenames. Unknown non-UTF-8 content is an encoding
/// error rather than permission to launch another application.
pub fn classify_file(bytes: &[u8]) -> io::Result<FileContent<'_>> {
    if bytes.starts_with(b"\xff\xfe")
        || bytes.starts_with(b"\xfe\xff")
        || bytes.starts_with(b"\0\0\xfe\xff")
    {
        return Err(encoding_error());
    }
    let known_binary = [
        b"%PDF".as_slice(),
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"GIF87a",
        b"GIF89a",
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"\x1f\x8b",
        b"RIFF",
        b"\x7fELF",
        b"MZ",
        b"\xfe\xed\xfa\xce",
        b"\xce\xfa\xed\xfe",
        b"\xfe\xed\xfa\xcf",
        b"\xcf\xfa\xed\xfe",
        b"\xca\xfe\xba\xbe",
    ]
    .iter()
    .any(|magic| bytes.starts_with(magic));
    if known_binary
        || bytes
            .iter()
            .any(|b| matches!(b, 0..=8 | 11 | 12 | 14..=31 | 127))
    {
        return Ok(FileContent::Binary);
    }
    std::str::from_utf8(bytes)
        .map(FileContent::Text)
        .map_err(|_| encoding_error())
}

fn encoding_error() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "native.content.file.invalidUtf8",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_not_extension_determines_text_or_binary() {
        assert_eq!(
            classify_file(b"{\"value\":1}\n").unwrap(),
            FileContent::Text("{\"value\":1}\n")
        );
        assert_eq!(
            classify_file(b"#!/bin/sh\necho hello\n").unwrap(),
            FileContent::Text("#!/bin/sh\necho hello\n")
        );
        assert_eq!(classify_file(b"%PDF-1.7\n").unwrap(), FileContent::Binary);
        assert_eq!(classify_file(b"hello\0world").unwrap(), FileContent::Binary);
        assert!(classify_file(b"caf\xe9").is_err());
        assert!(classify_file(b"\xff\xfeh\0i\0").is_err());
    }
}
