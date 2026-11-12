pub mod ai_storage;
pub mod attachment;
pub mod content;
pub mod conversation;
pub mod conversation_history;
pub mod conversation_runtime;
pub mod conversation_store;
pub use conversation_store::{ConversationRecord, ConversationSummary};
pub mod appearance;
pub mod diagnostics;
mod durable_storage;
mod ignored_files;
pub mod layout_storage;
pub mod localization;
pub mod messages;
pub mod metadata;
pub mod onboarding;
pub mod plugins;
mod reference_storage;
mod reference_storage_json;
#[cfg(test)]
mod reference_storage_tests;
pub mod rendering;
pub mod workspace_identity;
pub mod workspace_registry;
pub mod workspaces;

use std::{fs, io, path::Path};

pub fn save_text(directory: &Path, text: &str) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    fs::write(directory.join("text.txt"), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_directory_and_preserves_utf8_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("data");
        let text = "  Hello, world 👋\nSecond line\t\n";

        save_text(&directory, text).unwrap();

        assert_eq!(
            fs::read(directory.join("text.txt")).unwrap(),
            text.as_bytes()
        );
    }

    #[test]
    fn overwrites_and_truncates_including_empty_text() {
        let temp = tempfile::tempdir().unwrap();

        for text in ["Long original content", "Short", ""] {
            save_text(temp.path(), text).unwrap();
            assert_eq!(
                fs::read(temp.path().join("text.txt")).unwrap(),
                text.as_bytes()
            );
        }
    }

    #[test]
    fn reports_unusable_directory() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("not-a-directory");
        fs::write(&file, "keep").unwrap();

        assert!(save_text(&file, "new").is_err());
        assert_eq!(fs::read_to_string(file).unwrap(), "keep");
    }

    #[test]
    fn reports_unwritable_destination() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("text.txt")).unwrap();

        assert!(save_text(temp.path(), "new").is_err());
    }
}
