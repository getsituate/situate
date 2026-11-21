use super::*;
use std::{cell::RefCell, io};

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
pub(crate) fn checkpoint(point: Checkpoint, child: &Dir) -> io::Result<()> {
    HOOK.with(|hook| match hook.borrow_mut().as_mut() {
        Some(hook) => hook(point, child),
        None => Ok(()),
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "workspaces_onboarding_cases.rs"]
mod cases;
