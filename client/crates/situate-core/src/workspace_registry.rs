use crate::workspaces::Location;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    pub version: u32,
    pub known: Vec<Location>,
    // Ordered least to most recently active; independent of list membership.
    pub restore: Vec<Location>,
}
impl Default for Registry {
    fn default() -> Self {
        Self {
            version: 1,
            known: vec![],
            restore: vec![],
        }
    }
}
impl Registry {
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("native.workspace.registry.readFailed".into()),
        };
        let data: Self =
            serde_json::from_slice(&bytes).map_err(|_| "native.workspace.registry.corrupt")?;
        if data.version != 1 {
            return Err("native.workspace.registry.unsupported".into());
        }
        for list in [&data.known, &data.restore] {
            let mut ids = HashSet::new();
            if list
                .iter()
                .any(|l| l.id.is_empty() || l.handle.is_empty() || !ids.insert(&l.id))
            {
                return Err("native.workspace.registry.corrupt".into());
            }
        }
        Ok(data)
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let save = || -> Result<(), Box<dyn std::error::Error>> {
            let parent = path.parent().ok_or("native.workspace.registry.noAppData")?;
            fs::create_dir_all(parent)?;
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            file.write_all(&serde_json::to_vec(self)?)?;
            file.as_file().sync_all()?;
            file.persist(path)?;
            #[cfg(unix)]
            fs::File::open(parent)?.sync_all()?;
            Ok(())
        };
        save().map_err(|_| "native.workspace.registry.saveFailed".into())
    }
    pub fn opened(&mut self, location: Location, remember: bool) {
        if remember || self.known.iter().any(|l| l.id == location.id) {
            self.known.retain(|l| l.id != location.id);
            self.known.push(location.clone());
        }
        self.restore.retain(|l| l.id != location.id);
        self.restore.push(location);
    }
    pub fn remove(&mut self, id: &str) {
        self.known.retain(|l| l.id != id);
    }
    pub fn close(&mut self, id: &str) {
        self.restore.retain(|l| l.id != id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn loc(id: &str) -> Location {
        Location {
            id: id.into(),
            name: id.into(),
            display: id.into(),
            kind: "path".into(),
            handle: id.into(),
        }
    }
    #[test]
    fn removal_switching_closure_and_restart_are_independent() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("registry.json");
        let mut r = Registry::default();
        r.opened(loc("A"), true);
        r.opened(loc("B"), true);
        r.remove("A");
        r.opened(loc("A"), false);
        r.save(&path).unwrap();
        let mut r = Registry::load(&path).unwrap();
        assert_eq!(r.known, vec![loc("B")]);
        assert_eq!(r.restore, vec![loc("B"), loc("A")]);
        r.close("B");
        r.save(&path).unwrap();
        let mut r = Registry::load(&path).unwrap();
        assert_eq!(r.known, vec![loc("B")]);
        assert_eq!(r.restore, vec![loc("A")]);
        r.opened(loc("A"), true);
        r.opened(loc("A"), true);
        assert_eq!(r.restore.len(), 1);
        assert_eq!(r.known.len(), 2);
    }
    #[test]
    fn corruption_and_future_versions_are_not_reset() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("registry.json");
        for bytes in ["broken", r#"{"version":2,"known":[],"restore":[]}"#] {
            fs::write(&path, bytes).unwrap();
            assert!(Registry::load(&path).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn save_failure_preserves_previous_destination() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("registry.json");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("keep"), "keep").unwrap();
        assert!(Registry::default().save(&path).is_err());
        assert_eq!(fs::read_to_string(path.join("keep")).unwrap(), "keep");
    }
}
