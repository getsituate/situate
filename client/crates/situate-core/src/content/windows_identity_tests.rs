use super::*;
use crate::content::windows_test_support::restricted_context;
use std::fs;

#[test]
fn detached_identity_comparison_uses_all_identifier_bytes_and_volume() {
    use windows_sys::Win32::Storage::FileSystem::{FILE_ID_128, FILE_ID_INFO};
    let original = FILE_ID_INFO {
        VolumeSerialNumber: 7,
        FileId: FILE_ID_128 {
            Identifier: [0; 16],
        },
    };
    assert!(same_windows_file_ids(&original, &original));
    for byte in 0..16 {
        let mut replacement = original;
        replacement.FileId.Identifier[byte] = 1;
        assert!(!same_windows_file_ids(&original, &replacement));
    }
    let mut other_volume = original;
    other_volume.VolumeSerialNumber = 8;
    assert!(!same_windows_file_ids(&original, &other_volume));
}

#[test]
fn restricted_token_retains_identity_across_ancestor_move_and_replacement() {
    let _context = restricted_context().unwrap();
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir_all(temp.path().join("source/sub")).unwrap();
    fs::write(temp.path().join("source/sub/note.md"), b"original").unwrap();
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    let identity = {
        let source = child_dir(&root, "source").unwrap();
        let sub = child_dir(&source, "sub").unwrap();
        let (_, identity) = read_operation_file(&sub, "note.md", 1024).unwrap();
        PatchIdentity::new(identity, true).unwrap()
    };
    rename_noreplace(&root, "source", &root, "moved").unwrap();
    assert!(!temp.path().join("source").exists());
    let moved = child_dir(&root, "moved").unwrap();
    let sub = child_dir(&moved, "sub").unwrap();
    let (bytes, candidate) = read_operation_file(&sub, "note.md", 1024).unwrap();
    assert_eq!(bytes, b"original");
    assert!(identity.matches(&candidate).unwrap());
    sub.rename("note.md", &sub, "retained.md").unwrap();
    sub.write("note.md", b"original").unwrap();
    let (bytes, replacement) = read_operation_file(&sub, "note.md", 1024).unwrap();
    assert_eq!(bytes, b"original");
    assert!(!identity.matches(&replacement).unwrap());
    assert_eq!(sub.read("retained.md").unwrap(), b"original");
}

#[test]
fn restricted_token_can_move_nested_reference_patches() {
    let _context = restricted_context().unwrap();
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::create_dir_all(temp.path().join("source/sub")).unwrap();
    fs::create_dir(temp.path().join("deep")).unwrap();
    fs::write(temp.path().join("outside.md"), "unchanged").unwrap();
    fs::write(
        temp.path().join("source/sub/note.md"),
        "[outside](../../outside.md)\n",
    )
    .unwrap();
    fs::write(
        temp.path().join("backlink.md"),
        "[note](source/sub/note.md)\n",
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let outcome = store.move_entry("source", "deep/moved").unwrap();
    assert!(
        matches!(outcome, OperationOutcome::Complete { .. }),
        "{outcome:?}"
    );
    assert!(!temp.path().join("source").exists());
    assert_eq!(
        store.read_text("deep/moved/sub/note.md").unwrap().text,
        "[outside](../../../outside.md)\n"
    );
    assert_eq!(
        store.read_text("backlink.md").unwrap().text,
        "[note](deep/moved/sub/note.md)\n"
    );
    assert_eq!(
        fs::read(temp.path().join("outside.md")).unwrap(),
        b"unchanged"
    );
}

fn reference_replacement(readonly: bool) {
    use std::os::windows::fs::MetadataExt;
    let _context = restricted_context().unwrap();
    let path = tempfile::tempdir().unwrap().keep();
    eprintln!("Reference replacement fixture: {}", path.display());
    for directory in ["stage", "target", "decoy"] {
        fs::create_dir(path.join(directory)).unwrap();
    }
    let original = path.join("target/note.md");
    let alias = path.join("outside.bin");
    fs::write(&original, b"original").unwrap();
    fs::write(path.join("decoy/note.md"), b"decoy").unwrap();
    if readonly {
        let mut permissions = fs::metadata(&original).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&original, permissions).unwrap();
    }
    fs::hard_link(&original, &alias).unwrap();
    let before = fs::metadata(&alias).unwrap().file_attributes();
    let root = Dir::open_ambient_dir(&path, ambient_authority()).unwrap();
    let stage = child_dir(&root, "stage").unwrap();
    let target = child_dir(&root, "target").unwrap();
    let _decoy = child_dir(&root, "decoy").unwrap();
    let (_, identity) = read_operation_file(&target, "note.md", 1024).unwrap();
    let mut pin = PatchIdentity::new(identity, true).unwrap();
    drop(target);
    rename_noreplace(&root, "target", &root, "moved").unwrap();
    let target = child_dir(&root, "moved").unwrap();
    let (_, candidate) = read_operation_file(&target, "note.md", 1024).unwrap();
    assert!(pin.matches(&candidate).unwrap());
    pin = PatchIdentity::Ordinary(candidate);
    let original = path.join("moved/note.md");
    let temporary = temporary_file(&stage, b"replacement").unwrap();
    let result = stage
        .rename(&temporary, &target, "note.md")
        .map_err(ContentError::from);
    if readonly {
        assert!(
            matches!(result, Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied)
        );
        assert_eq!(fs::read(&original).unwrap(), b"original");
        assert_eq!(stage.read(&temporary).unwrap(), b"replacement");
    } else {
        result.unwrap();
        assert_eq!(fs::read(&original).unwrap(), b"replacement");
        assert!(!stage.try_exists(&temporary).unwrap());
        let (_, replaced) = read_operation_file(&target, "note.md", 1024).unwrap();
        assert!(!pin.matches(&replaced).unwrap());
    }
    assert_eq!(fs::read(&alias).unwrap(), b"original");
    assert_eq!(fs::metadata(&alias).unwrap().file_attributes(), before);
    assert!(
        pin.matches(&same_file::Handle::from_path(&alias).unwrap())
            .unwrap()
    );
    assert_eq!(fs::read(path.join("decoy/note.md")).unwrap(), b"decoy");
}

#[test]
fn reference_replacement_preserves_held_identity_and_outside_alias() {
    reference_replacement(false);
}

#[test]
fn reference_replacement_rejects_readonly_target_without_changing_alias() {
    reference_replacement(true);
}
