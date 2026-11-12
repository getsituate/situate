use super::*;
use crate::onboarding::{OnboardingRecord, OnboardingStorage};
use std::{
    cell::{Cell, RefCell},
    io,
    os::unix::fs::PermissionsExt,
    rc::Rc,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Checkpoint {
    Empty,
    Staging,
    Identity,
    Progress,
    Prepared,
    Published,
    Synced,
    ProgressWrite,
    ProgressSync,
    StagingSync,
    ChildSync,
    ParentSync,
}

type Hook = Box<dyn FnMut(Checkpoint, &Dir) -> io::Result<()>>;
thread_local! {
    static HOOK: RefCell<Option<Hook>> = RefCell::new(None);
}
struct HookGuard;
impl Drop for HookGuard {
    fn drop(&mut self) {
        HOOK.with(|hook| *hook.borrow_mut() = None);
    }
}
fn observe(hook: impl FnMut(Checkpoint, &Dir) -> io::Result<()> + 'static) -> HookGuard {
    HOOK.with(|current| assert!(current.borrow_mut().replace(Box::new(hook)).is_none()));
    HookGuard
}
pub(crate) fn checkpoint(point: Checkpoint, child: &Dir) -> io::Result<()> {
    HOOK.with(|hook| match hook.borrow_mut().as_mut() {
        Some(hook) => hook(point, child),
        None => Ok(()),
    })
}

#[test]
fn publication_includes_initial_progress_without_native_followup() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = create_for_onboarding(temp.path(), "Garden").unwrap();
    let root = Path::new(&workspace.handle);
    assert!(crate::workspace_identity::read(root).is_some());
    let snapshot = OnboardingStorage::open(root, &workspace.id)
        .unwrap()
        .load()
        .unwrap();
    assert_eq!(snapshot.record, Some(OnboardingRecord::default()));
    assert!(snapshot.revision.is_some());
    assert_eq!(fs::read_dir(root).unwrap().count(), 1);
    assert_eq!(fs::read_dir(root.join(".situate")).unwrap().count(), 3);
    let compatibility: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".situate/migrations.json")).unwrap()).unwrap();
    assert_eq!(
        compatibility,
        serde_json::json!({"minimumAppVersion":"0.1.6","lastAppliedMigration":2})
    );
    assert_eq!(
        fs::metadata(root.join(".situate/native-onboarding.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}

#[test]
fn interruption_never_leaves_a_published_workspace_without_progress() {
    use Checkpoint::*;
    for point in [
        Empty, Staging, Identity, Progress, Prepared, Published, Synced,
    ] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Garden");
        let published = matches!(point, Published | Synced);
        let observed = root.clone();
        let reached = Rc::new(Cell::new(false));
        let triggered = reached.clone();
        let _guard = observe(move |current, _| {
            if current != point {
                return Ok(());
            }
            triggered.set(true);
            assert_eq!(inspect(&observed).is_ok(), published, "{point:?}");
            Err(io::Error::other("injected interruption"))
        });
        let error = create_for_onboarding(temp.path(), "Garden").unwrap_err();
        assert!(reached.get(), "{point:?}");
        let payload: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(payload["key"], "native.workspace.create.partial");
        assert_eq!(
            payload["params"]["path"],
            root.canonicalize().unwrap().to_str().unwrap()
        );
        assert!(root.is_dir());
        assert_eq!(inspect(&root).is_ok(), published);
        let before = fs::read_dir(&root).unwrap().count();
        if published {
            let snapshot = OnboardingStorage::open(&root.canonicalize().unwrap(), "reopened")
                .unwrap()
                .load()
                .unwrap();
            assert_eq!(snapshot.record, Some(OnboardingRecord::default()));
            assert!(crate::workspace_identity::read(&root).is_some());
        } else {
            assert!(!root.join(".situate").exists());
        }
        assert_eq!(
            create_for_onboarding(temp.path(), "Garden").unwrap_err(),
            "native.workspace.folder.exists"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), before);
    }
}

#[test]
fn failed_initial_writes_and_syncs_preserve_the_publication_boundary() {
    use Checkpoint::*;
    for point in [
        ProgressWrite,
        ProgressSync,
        StagingSync,
        ChildSync,
        ParentSync,
    ] {
        let temp = tempfile::tempdir().unwrap();
        let reached = Rc::new(Cell::new(false));
        let triggered = reached.clone();
        let _guard = observe(move |current, _| {
            if current == point {
                triggered.set(true);
                return Err(io::Error::other("injected I/O failure"));
            }
            Ok(())
        });
        let error = create_for_onboarding(temp.path(), "Garden").unwrap_err();
        assert!(reached.get(), "{point:?}");
        let payload: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(payload["key"], "native.workspace.create.partial");
        assert_eq!(
            payload["params"]["error"],
            "native.workspace.create.markerFailed"
        );
        let root = temp.path().join("Garden").canonicalize().unwrap();
        if matches!(point, ChildSync | ParentSync) {
            assert!(inspect(&root).is_ok());
            assert!(crate::workspace_identity::read(&root).is_some());
            let snapshot = OnboardingStorage::open(&root, "reopened")
                .unwrap()
                .load()
                .unwrap();
            assert_eq!(snapshot.record, Some(OnboardingRecord::default()));
        } else {
            assert!(inspect(&root).is_err());
            assert!(!root.join(".situate").exists());
            let stage = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
            assert!(stage.join("workspace.json").is_file());
            let bytes = fs::read(stage.join("native-onboarding.json")).unwrap();
            if point == ProgressWrite {
                assert!(bytes.is_empty());
            } else {
                let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(document["record"]["step"], "access");
            }
        }
    }
}

#[test]
fn metadata_publication_does_not_replace_existing_entries() {
    for kind in ["file", "empty", "populated", "symlink", "dangling"] {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("keep"), "unchanged").unwrap();
        let target = if kind == "dangling" {
            outside.path().join("missing")
        } else {
            outside.path().to_owned()
        };
        let link = target.clone();
        let root = temp.path().join("Garden");
        let _guard = observe(move |point, child| {
            if point == Checkpoint::Prepared {
                match kind {
                    "file" => child.write(".situate", "keep")?,
                    "empty" | "populated" => {
                        child.create_dir(".situate")?;
                        if kind == "populated" {
                            child.write(".situate/keep", "unchanged")?;
                        }
                    }
                    _ => std::os::unix::fs::symlink(&link, root.join(".situate"))?,
                }
            }
            Ok(())
        });
        assert!(create_for_onboarding(temp.path(), "Garden").is_err());
        let marker = temp.path().join("Garden/.situate");
        match kind {
            "file" => assert_eq!(fs::read_to_string(marker).unwrap(), "keep"),
            "empty" => assert_eq!(fs::read_dir(marker).unwrap().count(), 0),
            "populated" => {
                assert_eq!(
                    fs::read_to_string(marker.join("keep")).unwrap(),
                    "unchanged"
                );
                assert_eq!(fs::read_dir(marker).unwrap().count(), 1);
            }
            _ => assert_eq!(fs::read_link(marker).unwrap(), target),
        }
        assert_eq!(
            fs::read_to_string(outside.path().join("keep")).unwrap(),
            "unchanged"
        );
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    }
}

#[test]
fn staging_replacement_is_rejected_before_publication() {
    for symlink in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().to_owned();
        let root = temp.path().join("Garden");
        let _guard = observe(move |point, child| {
            if point == Checkpoint::Prepared {
                let stage = child.entries()?.next().unwrap()?.file_name();
                child.rename(&stage, child, "retained")?;
                if symlink {
                    std::os::unix::fs::symlink(&target, root.join(&stage))?;
                } else {
                    child.create_dir(&stage)?;
                }
            }
            Ok(())
        });
        let error = create_for_onboarding(temp.path(), "Garden").unwrap_err();
        let payload: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(
            payload["params"]["error"],
            "native.workspace.create.locationChanged"
        );
        let root = temp.path().join("Garden");
        assert!(!root.join(".situate").exists());
        assert!(root.join("retained/workspace.json").is_file());
        assert!(root.join("retained/native-onboarding.json").is_file());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}

#[test]
fn late_marker_replacement_cannot_be_acknowledged_as_success() {
    let temp = tempfile::tempdir().unwrap();
    let _guard = observe(|point, child| {
        if point == Checkpoint::Synced {
            child.rename(".situate", child, "retained")?;
            child.create_dir(".situate")?;
        }
        Ok(())
    });
    let error = create_for_onboarding(temp.path(), "Garden").unwrap_err();
    let payload: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert_eq!(
        payload["params"]["error"],
        "native.workspace.create.locationChanged"
    );
    let root = temp.path().join("Garden");
    assert!(root.join("retained/native-onboarding.json").is_file());
    assert!(root.join("retained/workspace.json").is_file());
    assert_eq!(fs::read_dir(root.join(".situate")).unwrap().count(), 0);
}

#[test]
fn parent_and_child_replacements_prevent_metadata_publication() {
    for replace_parent in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path().join("parent");
        fs::create_dir(&parent).unwrap();
        let source = if replace_parent {
            parent.clone()
        } else {
            parent.join("Garden")
        };
        let moved = temp.path().join("moved");
        let destination = moved.clone();
        let _guard = observe(move |point, _| {
            if point == Checkpoint::Prepared {
                fs::rename(&source, &destination)?;
                fs::create_dir(&source)?;
                fs::write(source.join("keep"), "unchanged")?;
            }
            Ok(())
        });
        assert!(create_for_onboarding(&parent, "Garden").is_err());
        let original = if replace_parent {
            moved.join("Garden")
        } else {
            moved
        };
        assert!(!original.join(".situate").exists());
        let replacement = if replace_parent {
            parent.clone()
        } else {
            parent.join("Garden")
        };
        assert_eq!(
            fs::read_to_string(replacement.join("keep")).unwrap(),
            "unchanged"
        );
        assert_eq!(fs::read_dir(replacement).unwrap().count(), 1);
    }
}

#[test]
fn ordinary_creation_and_legacy_admission_do_not_initialize_onboarding() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = create(temp.path(), "Legacy").unwrap();
    let root = Path::new(&workspace.handle);
    assert!(crate::workspace_identity::admit(root).is_some());
    let snapshot = OnboardingStorage::open(root, &workspace.id)
        .unwrap()
        .load()
        .unwrap();
    assert_eq!(snapshot.record, None);
    assert!(!root.join(".situate/native-onboarding.json").exists());
    assert_eq!(fs::read_dir(root.join(".situate")).unwrap().count(), 2);
    assert!(root.join(".situate/migrations.json").is_file());
}
