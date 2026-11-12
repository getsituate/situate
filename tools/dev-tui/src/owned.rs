use crate::text;
use nix::{
    errno::Errno,
    sys::signal::{Signal, kill, killpg},
    unistd::Pid,
};
use std::{collections::BTreeMap, io, process::Command};

#[derive(Debug)]
struct Process {
    parent: u32,
    group: u32,
    state: String,
    birth: String,
}
type Snapshot = BTreeMap<u32, Process>;

// The root must lead its own process group. ps birth times have second precision;
// snapshots cannot make signal delivery atomic or discover children orphaned
// before their ancestry was observed.
pub struct OwnedProcesses {
    root: u32,
    root_birth: Option<String>,
    identities: BTreeMap<u32, String>,
    armed: bool,
}

impl OwnedProcesses {
    pub fn new(root: u32) -> io::Result<Self> {
        if root == 0 || root > i32::MAX as u32 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                text::INVALID_PID,
            ));
        }
        Ok(Self::from_snapshot(root, &snapshot()?))
    }

    fn from_snapshot(root: u32, processes: &Snapshot) -> Self {
        let root_birth = processes.get(&root).map(|p| p.birth.clone());
        let identities = root_birth
            .iter()
            .map(|birth| (root, birth.clone()))
            .collect();
        let mut owned = Self {
            root,
            root_birth,
            identities,
            armed: true,
        };
        owned.observe(processes);
        owned
    }

    fn observe(&mut self, processes: &Snapshot) {
        self.identities
            .retain(|pid, birth| processes.get(pid).is_some_and(|p| p.birth == *birth));
        if self.root_birth.is_some() && self.identities.get(&self.root) == self.root_birth.as_ref()
        {
            for (&pid, process) in processes {
                if process.group == self.root {
                    self.identities
                        .entry(pid)
                        .or_insert_with(|| process.birth.clone());
                }
            }
        }
        loop {
            let before = self.identities.len();
            for (&pid, process) in processes {
                if pid > 0 && self.identities.contains_key(&process.parent) {
                    self.identities
                        .entry(pid)
                        .or_insert_with(|| process.birth.clone());
                }
            }
            if self.identities.len() == before {
                break;
            }
        }
    }

    pub fn refresh(&mut self) -> io::Result<()> {
        self.observe(&snapshot()?);
        Ok(())
    }

    pub fn has_live_processes(&mut self) -> io::Result<bool> {
        let processes = snapshot()?;
        self.observe(&processes);
        Ok(self
            .identities
            .keys()
            .any(|pid| !processes[pid].state.starts_with('Z')))
    }

    pub fn signal(&mut self, signal: Signal) -> io::Result<()> {
        if !self.armed {
            return Ok(());
        }
        self.refresh()?;
        let mut error = None;
        let mut group_delivered = false;
        // Without the original leader's identity, a numeric PGID is not enough
        // to distinguish our group from a later group that reused that number.
        if self.root_birth.is_some() && self.identities.get(&self.root) == self.root_birth.as_ref()
        {
            let result = killpg(Pid::from_raw(self.root as i32), signal);
            group_delivered = result.is_ok();
            record(result, &mut error);
        }
        // Group delivery can terminate and reap descendants. Revalidate before
        // addressing individual PIDs, including descendants in detached groups.
        let processes = snapshot()?;
        self.observe(&processes);
        for &pid in self.identities.keys().rev() {
            if !group_delivered || processes[&pid].group != self.root {
                record(kill(Pid::from_raw(pid as i32), signal), &mut error);
            }
        }
        error.map_or(Ok(()), Err)
    }

    pub fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for OwnedProcesses {
    fn drop(&mut self) {
        if self.armed {
            let _ = self.signal(Signal::SIGKILL);
        }
    }
}

fn record(result: Result<(), Errno>, error: &mut Option<io::Error>) {
    if let Err(errno) = result
        && errno != Errno::ESRCH
        && error.is_none()
    {
        *error = Some(io::Error::from_raw_os_error(errno as i32));
    }
}

fn snapshot() -> io::Result<Snapshot> {
    let output = Command::new("ps")
        .args(["-A", "-o", "pid=,ppid=,pgid=,stat=,lstart="])
        .env("LC_ALL", "C")
        .env("TZ", "UTC")
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "{}: ps exited with {}",
            text::PROCESS_TABLE,
            output.status
        )));
    }
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    parse_snapshot(text)
}

fn parse_snapshot(text: &str) -> io::Result<Snapshot> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidData, text::INVALID_PROCESS_TABLE);
    let mut processes = Snapshot::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 9 {
            return Err(invalid());
        }
        let pid = fields[0].parse::<u32>().map_err(|_| invalid())?;
        let parent = fields[1].parse::<u32>().map_err(|_| invalid())?;
        if pid > i32::MAX as u32 || parent > i32::MAX as u32 {
            return Err(invalid());
        }
        let process = Process {
            parent,
            group: fields[2].parse::<u32>().map_err(|_| invalid())?,
            state: fields[3].into(),
            birth: fields[4..].join(" "),
        };
        if processes.insert(pid, process).is_some() {
            return Err(invalid());
        }
    }
    if processes.is_empty() {
        return Err(invalid());
    }
    Ok(processes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(rows: &[(u32, u32, &str)]) -> Snapshot {
        rows.iter()
            .map(|&(pid, parent, birth)| {
                (
                    pid,
                    Process {
                        parent,
                        group: pid,
                        state: "S".into(),
                        birth: birth.into(),
                    },
                )
            })
            .collect()
    }
    fn owned(root: u32, rows: &[(u32, u32, &str)]) -> OwnedProcesses {
        let mut owned = OwnedProcesses::from_snapshot(root, &table(rows));
        owned.disarm();
        owned
    }
    fn pids(owned: &OwnedProcesses) -> Vec<u32> {
        owned.identities.keys().copied().collect()
    }

    #[test]
    fn discovers_all_generations_without_adopting_siblings() {
        let owned = owned(
            400,
            &[
                (400, 1, "a"),
                (300, 400, "b"),
                (200, 300, "c"),
                (100, 200, "d"),
                (500, 1, "e"),
            ],
        );
        assert_eq!(pids(&owned), [100, 200, 300, 400]);
    }

    #[test]
    fn retains_reparented_descendants_and_follows_their_new_children() {
        let mut owned = owned(400, &[(400, 1, "a"), (300, 400, "b")]);
        owned.observe(&table(&[(300, 1, "b"), (200, 300, "c"), (500, 1, "d")]));
        assert_eq!(pids(&owned), [200, 300]);
    }

    #[test]
    fn reused_root_cannot_extend_ancestry_or_reclaim_the_group() {
        let mut owned = owned(400, &[(400, 1, "a"), (300, 400, "b")]);
        owned.observe(&table(&[
            (400, 1, "replacement"),
            (300, 1, "b"),
            (200, 400, "c"),
        ]));
        assert_eq!(pids(&owned), [300]);
        assert_ne!(owned.identities.get(&400), owned.root_birth.as_ref());
    }

    #[test]
    fn reused_descendant_cannot_extend_ancestry() {
        let mut owned = owned(400, &[(400, 1, "a"), (300, 400, "b"), (200, 300, "c")]);
        owned.observe(&table(&[
            (400, 1, "a"),
            (300, 1, "replacement"),
            (200, 1, "c"),
            (100, 300, "d"),
        ]));
        assert_eq!(pids(&owned), [200, 400]);
    }

    #[test]
    fn missing_root_is_not_adopted_when_its_pid_appears_later() {
        let mut owned = owned(400, &[(1, 0, "init")]);
        owned.observe(&table(&[(400, 1, "new"), (300, 400, "child")]));
        assert!(owned.identities.is_empty());
    }

    #[test]
    fn adopts_original_group_members_even_when_their_parent_has_exited() {
        let mut snapshot = table(&[(400, 1, "root"), (200, 1, "child")]);
        snapshot.get_mut(&200).unwrap().group = 400;
        let mut owned = OwnedProcesses::from_snapshot(400, &snapshot);
        owned.disarm();
        snapshot.remove(&400);
        owned.observe(&snapshot);
        assert_eq!(pids(&owned), [200]);
    }
    #[test]
    fn parses_platform_spacing_and_rejects_incomplete_tables() {
        let snapshot = parse_snapshot("  12  1 12 S Tue Oct  6 22:11:29 2026    \n").unwrap();
        assert_eq!(snapshot[&12].parent, 1);
        assert_eq!(snapshot[&12].birth, "Tue Oct 6 22:11:29 2026");
        for text in [
            "",
            "12 1",
            "bad 1 12 S Tue Oct 6 22:11:29 2026",
            "12 1 12 S Tue Oct 6 22:11:29 2026\n12 1 12 S Tue Oct 6 22:11:29 2026",
        ] {
            assert_eq!(
                parse_snapshot(text).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
    }

    #[test]
    fn host_process_table_contains_the_current_process() {
        assert!(snapshot().unwrap().contains_key(&std::process::id()));
    }

    #[test]
    fn missing_process_is_normal_but_permission_failure_is_not() {
        let mut error = None;
        record(Err(Errno::ESRCH), &mut error);
        assert!(error.is_none());
        record(Err(Errno::EPERM), &mut error);
        assert_eq!(error.unwrap().raw_os_error(), Some(Errno::EPERM as i32));
    }

    #[test]
    fn disarmed_owner_does_not_signal() {
        let mut owned = owned(std::process::id(), &[(std::process::id(), 1, "synthetic")]);
        owned.signal(Signal::SIGKILL).unwrap();
    }

    #[test]
    fn invalid_root_cannot_address_a_special_kill_target() {
        assert!(OwnedProcesses::new(0).is_err());
        assert!(OwnedProcesses::new(u32::MAX).is_err());
    }
}
