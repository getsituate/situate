use super::directory_for_sync;
use cap_std::fs::Dir;
use std::{fs::File, io};

#[cfg(target_vendor = "apple")]
use std::{collections::BTreeMap, os::unix::fs::MetadataExt};

/// The batch must finish before publishing references to its files or acknowledging persistence.
#[derive(Default)]
#[must_use]
pub(crate) struct SyncBatch {
    #[cfg(target_vendor = "apple")]
    devices: BTreeMap<u64, File>,
}

impl SyncBatch {
    pub(crate) fn sync_file(&mut self, file: File) -> io::Result<()> {
        #[cfg(target_vendor = "apple")]
        {
            let device = file.metadata()?.dev();
            rustix::io::retry_on_intr(|| rustix::fs::fsync(&file))?;
            #[cfg(test)]
            testing::record(testing::Event::Prepared(device));
            self.devices.entry(device).or_insert(file);
            Ok(())
        }
        #[cfg(not(target_vendor = "apple"))]
        {
            file.sync_all()
        }
    }

    pub(crate) fn sync_directory(&mut self, directory: &Dir) -> io::Result<()> {
        self.sync_file(directory_for_sync(directory)?)
    }

    pub(crate) fn finish(self) -> io::Result<()> {
        #[cfg(target_vendor = "apple")]
        for (_device, file) in self.devices {
            // fsync flushes each entry to the device; F_FULLFSYNC then persists the
            // preceding flushes on that filesystem before publication can proceed.
            #[cfg(test)]
            testing::before_barrier()?;
            file.sync_all()?;
            #[cfg(test)]
            testing::record(testing::Event::Barrier(_device));
        }
        Ok(())
    }
}

#[cfg(all(test, target_vendor = "apple"))]
pub(crate) mod testing {
    use std::{cell::RefCell, io, marker::PhantomData, rc::Rc};

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum Event {
        Prepared(u64),
        Barrier(u64),
    }

    #[derive(Default)]
    struct State {
        events: Vec<Event>,
        fail_after: Option<usize>,
    }

    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    pub(crate) struct Recording {
        previous: Option<State>,
        _thread: PhantomData<Rc<()>>,
    }

    pub(crate) fn start() -> Recording {
        Recording {
            previous: STATE.replace(Some(State::default())),
            _thread: PhantomData,
        }
    }

    impl Recording {
        pub(crate) fn events(&self) -> Vec<Event> {
            STATE.with_borrow(|state| state.as_ref().unwrap().events.clone())
        }

        pub(crate) fn fail_after(&self, successful_barriers: usize) {
            STATE.with_borrow_mut(|state| {
                state.as_mut().unwrap().fail_after = Some(successful_barriers);
            });
        }
    }

    impl Drop for Recording {
        fn drop(&mut self) {
            STATE.replace(self.previous.take());
        }
    }

    pub(super) fn record(event: Event) {
        STATE.with_borrow_mut(|state| {
            if let Some(state) = state {
                state.events.push(event);
            }
        });
    }

    pub(super) fn before_barrier() -> io::Result<()> {
        STATE.with_borrow_mut(|state| {
            if let Some(state) = state {
                match state.fail_after {
                    Some(0) => {
                        state.fail_after = None;
                        return Err(io::Error::other("injected device flush failure"));
                    }
                    Some(remaining) => state.fail_after = Some(remaining - 1),
                    None => {}
                }
            }
            Ok(())
        })
    }
}

#[cfg(all(test, target_vendor = "apple"))]
mod tests {
    use super::*;
    use cap_std::ambient_authority;
    use testing::Event;

    #[test]
    fn files_and_directories_share_one_final_device_barrier() {
        let temp = tempfile::tempdir().unwrap();
        let directory = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        let recording = testing::start();
        let mut batch = SyncBatch::default();
        for name in ["first", "second"] {
            let file = directory.create(name).unwrap();
            file.set_len(16).unwrap();
            batch.sync_file(file.into_std()).unwrap();
        }
        batch.sync_directory(&directory).unwrap();
        let device = std::fs::metadata(temp.path()).unwrap().dev();
        assert_eq!(recording.events(), vec![Event::Prepared(device); 3]);
        batch.finish().unwrap();
        assert_eq!(
            recording.events(),
            vec![
                Event::Prepared(device),
                Event::Prepared(device),
                Event::Prepared(device),
                Event::Barrier(device),
            ]
        );
    }

    #[test]
    fn every_filesystem_receives_a_barrier() {
        let temp = tempfile::tempdir().unwrap();
        let first = File::create(temp.path().join("first")).unwrap();
        let second = File::create(temp.path().join("second")).unwrap();
        let recording = testing::start();
        // Separate filesystem identities must not collapse into one barrier.
        let batch = SyncBatch {
            devices: BTreeMap::from([(1, first), (2, second)]),
        };
        batch.finish().unwrap();
        assert_eq!(
            recording.events(),
            vec![Event::Barrier(1), Event::Barrier(2)]
        );
    }

    #[test]
    #[ignore = "Requires SITUATE_TEST_SECOND_FILESYSTEM on a second writable filesystem"]
    fn distinct_filesystems_receive_independent_barriers() {
        let first = tempfile::tempdir().unwrap();
        let second_root = std::env::var_os("SITUATE_TEST_SECOND_FILESYSTEM")
            .expect("SITUATE_TEST_SECOND_FILESYSTEM must name a second writable filesystem");
        let second = tempfile::tempdir_in(second_root).unwrap();
        let first_device = std::fs::metadata(first.path()).unwrap().dev();
        let second_device = std::fs::metadata(second.path()).unwrap().dev();
        assert_ne!(
            first_device, second_device,
            "The fixtures must be on distinct filesystems"
        );
        let first_dir = Dir::open_ambient_dir(first.path(), ambient_authority()).unwrap();
        let second_dir = Dir::open_ambient_dir(second.path(), ambient_authority()).unwrap();
        let recording = testing::start();
        let mut batch = SyncBatch::default();
        batch
            .sync_file(first_dir.create("first").unwrap().into_std())
            .unwrap();
        batch.sync_directory(&first_dir).unwrap();
        batch
            .sync_file(second_dir.create("second").unwrap().into_std())
            .unwrap();
        batch.sync_directory(&second_dir).unwrap();
        let prepared = vec![
            Event::Prepared(first_device),
            Event::Prepared(first_device),
            Event::Prepared(second_device),
            Event::Prepared(second_device),
        ];
        assert_eq!(recording.events(), prepared);
        batch.finish().unwrap();
        let events = recording.events();
        assert_eq!(&events[..4], prepared);
        let mut devices = [first_device, second_device];
        devices.sort();
        assert_eq!(&events[4..], devices.map(Event::Barrier));
    }

    #[test]
    fn member_flush_errors_are_propagated_before_a_device_barrier() {
        use std::os::{fd::OwnedFd, unix::net::UnixStream};
        let (stream, _peer) = UnixStream::pair().unwrap();
        let descriptor: OwnedFd = stream.into();
        let recording = testing::start();
        let mut batch = SyncBatch::default();
        assert!(batch.sync_file(File::from(descriptor)).is_err());
        assert!(recording.events().is_empty());
    }

    #[test]
    fn a_later_filesystem_barrier_failure_is_not_acknowledged() {
        let temp = tempfile::tempdir().unwrap();
        let recording = testing::start();
        let batch = SyncBatch {
            devices: BTreeMap::from([
                (1, File::create(temp.path().join("first")).unwrap()),
                (2, File::create(temp.path().join("second")).unwrap()),
            ]),
        };
        recording.fail_after(1);
        assert!(batch.finish().is_err());
        assert_eq!(recording.events(), vec![Event::Barrier(1)]);
    }

    #[test]
    fn final_barrier_errors_are_not_acknowledged() {
        let temp = tempfile::tempdir().unwrap();
        let recording = testing::start();
        let mut batch = SyncBatch::default();
        batch
            .sync_file(File::create(temp.path().join("first")).unwrap())
            .unwrap();
        recording.fail_after(0);
        assert!(batch.finish().is_err());
        assert!(
            recording
                .events()
                .iter()
                .all(|event| matches!(event, Event::Prepared(_)))
        );
    }
}
