use super::*;
use std::fs;

fn workspace(folder: bool) -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    if folder {
        fs::create_dir(temp.path().join("source")).unwrap();
        fs::write(temp.path().join("source/a.bin"), [0, 255]).unwrap();
    } else {
        fs::write(temp.path().join("source"), [0, 255]).unwrap();
    }
    temp
}
fn revision(outcome: OperationOutcome) -> String {
    let OperationOutcome::Complete { history_revision } = outcome else {
        panic!("expected completion")
    };
    history_revision
}

#[test]
fn structural_reversal_never_moves_or_deletes_an_equal_byte_reused_binary() {
    for folder in [false, true] {
        for moved in [false, true] {
            for gap in [false, true] {
                let temp = workspace(folder);
                let mut store = ContentStore::open(temp.path()).unwrap();
                let revision = revision(if moved {
                    store.move_entry("source", "target").unwrap()
                } else {
                    store.copy_entry("source", "target").unwrap()
                });
                let replaced = if folder { "target/a.bin" } else { "target" };
                if gap {
                    super::live_references::INTERRUPT.set(1);
                    assert!(store.move_entry(replaced, "abandoned").is_err());
                    store.record_external_changes().unwrap();
                    fs::remove_file(temp.path().join(replaced)).unwrap();
                } else {
                    store.delete_entry(replaced).unwrap();
                }
                fs::write(temp.path().join(replaced), [0, 255]).unwrap();
                store.record_external_changes().unwrap();
                let before = store.repo.head().unwrap().target().unwrap();
                assert!(
                    store.reverse_entry_change("target", &revision).is_err(),
                    "folder={folder} moved={moved} gap={gap}"
                );
                assert_eq!(store.repo.head().unwrap().target().unwrap(), before);
                assert_eq!(fs::read(temp.path().join(replaced)).unwrap(), [0, 255]);
                assert_eq!(temp.path().join("source").exists(), !moved);
                assert!(!temp.path().join("abandoned").exists());
            }
        }
    }
}

#[test]
fn reversing_binary_creation_and_move_with_continuous_lineage_still_works() {
    for folder in [false, true] {
        let temp = workspace(folder);
        let mut store = ContentStore::open(temp.path()).unwrap();
        let copied = revision(store.copy_entry("source", "copy").unwrap());
        assert!(matches!(
            store.reverse_entry_change("copy", &copied).unwrap(),
            ReversalOutcome::Structure(OperationOutcome::Complete { .. })
        ));
        assert!(!temp.path().join("copy").exists());
        let moved = revision(store.move_entry("source", "target").unwrap());
        assert!(matches!(
            store.reverse_entry_change("target", &moved).unwrap(),
            ReversalOutcome::Structure(OperationOutcome::Complete { .. })
        ));
        assert!(temp.path().join("source").exists());
        assert!(!temp.path().join("target").exists());
    }
}
