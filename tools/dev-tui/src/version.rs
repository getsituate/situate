use crate::text;
use serde_json::Value;
use std::{fs, io, path::Path};

pub fn number(value: &str) -> Option<[u64; 3]> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut number = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|c| c.is_ascii_digit())
        {
            return None;
        }
        number[index] = part.parse().ok()?;
    }
    Some(number)
}

pub fn current(root: &Path) -> io::Result<String> {
    let value: Value = serde_json::from_slice(&fs::read(
        root.join("client/app/src-tauri/tauri.conf.json"),
    )?)?;
    let version = value["version"]
        .as_str()
        .filter(|s| number(s).is_some())
        .ok_or_else(|| io::Error::other(text::VERSION_INVALID_SOURCE))?;
    Ok(version.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_numeric_triples_without_suffixes_or_leading_zeroes() {
        assert_eq!(number("1.10.2"), Some([1, 10, 2]));
        assert_eq!(number("0.0.0"), Some([0, 0, 0]));
        for value in ["", "1.2", "1.2.3.4", "01.2.3", "1.2.3-beta", "-1.2.3"] {
            assert_eq!(number(value), None);
        }
    }

    #[test]
    fn current_reads_the_native_product_version_without_writing() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("client/app/src-tauri");
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("tauri.conf.json");
        let bytes = r#"{"version":"0.1.2","other":true}"#;
        fs::write(&file, bytes).unwrap();
        assert_eq!(current(root.path()).unwrap(), "0.1.2");
        assert_eq!(fs::read_to_string(file).unwrap(), bytes);
    }

    #[test]
    fn invalid_or_missing_version_files_are_errors() {
        let root = tempfile::tempdir().unwrap();
        assert!(current(root.path()).is_err());
        let directory = root.path().join("client/app/src-tauri");
        fs::create_dir_all(&directory).unwrap();
        for bytes in ["not json", r#"{}"#, r#"{"version":"0.1"}"#] {
            fs::write(directory.join("tauri.conf.json"), bytes).unwrap();
            assert!(current(root.path()).is_err());
        }
    }
}
