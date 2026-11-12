use super::{
    BoundContext, EventInput, FileDestination, HostIdentity, Level, MAX_EVENT_BYTES,
    MAX_SAFE_INTEGER, Origin, Record, valid_uuid,
};
use std::{
    collections::VecDeque,
    io,
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const QUEUE_BYTES: usize = 2 * 1024 * 1024;
pub const QUEUE_EVENTS: usize = 4096;
pub const MAX_PRODUCERS: usize = 128;
const RECORD_CHARGE: usize = 4096;
const RETRY_INTERVAL: Duration = Duration::from_secs(5);

/// Called only on the collector worker. Implementations must not retain unbounded buffers.
pub trait Destination: Send + 'static {
    fn write(&mut self, record: &[u8]) -> io::Result<()>;
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn recover(&mut self) -> bool {
        false
    }
}

pub struct NoopDestination;
impl Destination for NoopDestination {
    fn write(&mut self, _: &[u8]) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
pub struct DestinationFilter {
    pub minimum_level: Level,
    pub categories: Vec<String>,
}
impl Default for DestinationFilter {
    fn default() -> Self {
        Self {
            minimum_level: Level::Trace,
            categories: Vec::new(),
        }
    }
}
impl DestinationFilter {
    fn accepts(&self, event: &EventInput) -> bool {
        event.level >= self.minimum_level
            && (self.categories.is_empty() || self.categories.contains(&event.category))
    }
}

pub struct DestinationRegistration {
    pub destination: Box<dyn Destination>,
    pub filter: DestinationFilter,
}
struct Slot {
    destination: Box<dyn Destination>,
    filter: DestinationFilter,
    failed: Option<Instant>,
}
impl Slot {
    fn ready(&mut self) -> bool {
        if self.failed.is_some_and(|at| at.elapsed() >= RETRY_INTERVAL) {
            self.failed = if self.destination.recover() {
                None
            } else {
                Some(Instant::now())
            };
        }
        self.failed.is_none()
    }
    fn write(&mut self, event: &EventInput, bytes: &[u8]) -> bool {
        if !self.filter.accepts(event) {
            return true;
        }
        if !self.ready() {
            return false;
        }
        if self.destination.write(bytes).is_err() {
            self.failed = Some(Instant::now());
            return false;
        }
        true
    }
}

struct LocalFile {
    path: PathBuf,
    writer: Option<FileDestination>,
}
impl Destination for LocalFile {
    fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        if self.writer.is_none() {
            self.writer = Some(FileDestination::open(&self.path)?);
        }
        let result = self
            .writer
            .as_mut()
            .ok_or(io::ErrorKind::NotConnected)?
            .write(bytes);
        if result.is_err() {
            self.writer = None;
        }
        result
    }
    fn flush(&mut self) -> io::Result<()> {
        if let Some(writer) = &mut self.writer {
            writer.flush()?;
        }
        Ok(())
    }
    fn recover(&mut self) -> bool {
        self.writer = FileDestination::open(&self.path).ok();
        self.writer.is_some()
    }
}

struct Pending {
    input: EventInput,
    bound: BoundContext,
    producer_id: String,
    received_at_ms: u64,
}
struct Queue {
    records: VecDeque<Pending>,
    charged: usize,
    in_flight: usize,
}
struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
    stopped: AtomicBool,
    producers: AtomicUsize,
    losses: [AtomicU64; 45],
}
impl Shared {
    fn lost(&self, origin: Origin, level: Level, reason: usize) {
        let index = reason * 15 + origin as usize * 5 + level as usize;
        let _ = self.losses[index].try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
            Some(n.saturating_add(1).min(MAX_SAFE_INTEGER))
        });
    }
}

pub struct Collector {
    shared: Arc<Shared>,
    finished: Mutex<mpsc::Receiver<()>>,
}
struct Registration {
    shared: Arc<Shared>,
    bound: BoundContext,
    id: String,
}
impl Drop for Registration {
    fn drop(&mut self) {
        self.shared.producers.fetch_sub(1, Ordering::Relaxed);
    }
}
#[derive(Clone)]
pub struct Producer {
    registration: Arc<Registration>,
}

impl Producer {
    pub fn id(&self) -> &str {
        &self.registration.id
    }
    /// Reports bounded queue admission, not persistence. Contention drops instead of waiting.
    pub fn emit(&self, input: EventInput) -> bool {
        let shared = &self.registration.shared;
        if shared.stopped.load(Ordering::Acquire) || !input.is_valid() {
            return false;
        }
        // Copy only admitted scalar lengths; native callers may reserve arbitrarily large capacities.
        let input = input.clone();
        let Ok(mut queue) = shared.queue.try_lock() else {
            shared.lost(self.registration.bound.origin, input.level, 1);
            return false;
        };
        if shared.stopped.load(Ordering::Acquire) {
            return false;
        }
        while queue.charged + RECORD_CHARGE > QUEUE_BYTES
            || queue.records.len() + queue.in_flight >= QUEUE_EVENTS
        {
            let Some(index) = queue
                .records
                .iter()
                .position(|record| record.input.level < input.level)
            else {
                shared.lost(self.registration.bound.origin, input.level, 0);
                return false;
            };
            if let Some(removed) = queue.records.remove(index) {
                shared.lost(removed.bound.origin, removed.input.level, 0);
                queue.charged -= RECORD_CHARGE;
            }
        }
        queue.records.push_back(Pending {
            input,
            bound: self.registration.bound.clone(),
            producer_id: self.registration.id.clone(),
            received_at_ms: timestamp_ms(),
        });
        queue.charged += RECORD_CHARGE;
        shared.wake.notify_one();
        true
    }
}

impl Collector {
    /// File initialization and recovery run on the worker; this does not confirm storage readiness.
    pub fn start(path: &Path, identity: HostIdentity) -> io::Result<Self> {
        Self::with_destinations(
            identity,
            vec![DestinationRegistration {
                destination: Box::new(LocalFile {
                    path: path.to_owned(),
                    writer: None,
                }),
                filter: DestinationFilter::default(),
            }],
        )
    }

    pub fn with_destinations(
        identity: HostIdentity,
        destinations: Vec<DestinationRegistration>,
    ) -> io::Result<Self> {
        if !identity.is_valid()
            || destinations.len() > 4
            || destinations.iter().any(|d| {
                d.filter.categories.len() > 10 || d.filter.categories.iter().any(|s| s.len() > 16)
            })
        {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let identity = identity.clone();
        let _ = super::contract::catalog();
        let shared = Arc::new(Shared {
            queue: Mutex::new(Queue {
                records: VecDeque::with_capacity(QUEUE_BYTES / RECORD_CHARGE),
                charged: 0,
                in_flight: 0,
            }),
            wake: Condvar::new(),
            stopped: AtomicBool::new(false),
            producers: AtomicUsize::new(0),
            losses: std::array::from_fn(|_| AtomicU64::new(0)),
        });
        let worker_shared = shared.clone();
        let (send, receive) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("diagnostics".into())
            .spawn(move || {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run(worker_shared.clone(), identity, destinations)
                }));
                worker_shared.stopped.store(true, Ordering::Release);
                let _ = send.try_send(());
            })?;
        Ok(Self {
            shared,
            finished: Mutex::new(receive),
        })
    }

    pub fn producer(&self, bound: BoundContext) -> Option<Producer> {
        if self.shared.stopped.load(Ordering::Acquire)
            || bound
                .workspace_id
                .as_ref()
                .is_some_and(|id| !valid_uuid(id))
        {
            return None;
        }
        self.shared
            .producers
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
                (count < MAX_PRODUCERS).then_some(count + 1)
            })
            .ok()?;
        Some(Producer {
            registration: Arc::new(Registration {
                shared: self.shared.clone(),
                bound: bound.clone(),
                id: Uuid::new_v4().to_string(),
            }),
        })
    }

    /// Stops admission and waits at most one second. A stalled worker is detached, never joined.
    pub fn shutdown(&self, timeout: Duration) -> bool {
        self.shared.stopped.store(true, Ordering::Release);
        self.shared.wake.notify_all();
        let Ok(finished) = self.finished.try_lock() else {
            return false;
        };
        matches!(
            finished.recv_timeout(timeout.min(Duration::from_secs(1))),
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected)
        )
    }
}
impl Drop for Collector {
    fn drop(&mut self) {
        self.shared.stopped.store(true, Ordering::Release);
        self.shared.wake.notify_all();
    }
}

fn run(shared: Arc<Shared>, identity: HostIdentity, destinations: Vec<DestinationRegistration>) {
    let mut slots: Vec<_> = destinations
        .into_iter()
        .map(|d| Slot {
            destination: d.destination,
            filter: d.filter,
            failed: None,
        })
        .collect();
    let mut sequence = 0u64;
    let summary_producer = Uuid::new_v4().to_string();
    let mut last_flush = Instant::now();
    loop {
        let ready = slots.iter_mut().any(Slot::ready);
        let Ok(mut queue) = shared.queue.lock() else {
            return;
        };
        if shared.stopped.load(Ordering::Acquire) && (queue.records.is_empty() || !ready) {
            break;
        }
        if queue.records.is_empty() || !ready {
            let Ok((guard, _)) = shared.wake.wait_timeout(queue, Duration::from_millis(100)) else {
                return;
            };
            drop(guard);
        } else {
            let Some(pending) = queue.records.pop_front() else {
                continue;
            };
            queue.in_flight += 1;
            drop(queue);
            let record = Record {
                input: pending.input,
                bound: pending.bound,
                producer_id: pending.producer_id,
                identity: identity.clone(),
                collector_sequence: sequence,
                received_at_ms: pending.received_at_ms,
            };
            sequence = sequence.saturating_add(1).min(MAX_SAFE_INTEGER);
            if !deliver(&mut slots, &record) {
                shared.lost(record.bound.origin, record.input.level, 2);
            }
            if let Ok(mut queue) = shared.queue.lock() {
                queue.charged -= RECORD_CHARGE;
                queue.in_flight -= 1;
            }
        }
        emit_losses(
            &shared,
            &identity,
            &summary_producer,
            &mut slots,
            &mut sequence,
        );
        if last_flush.elapsed() >= Duration::from_secs(1) {
            for slot in &mut slots {
                if slot.failed.is_none() && slot.destination.flush().is_err() {
                    slot.failed = Some(Instant::now());
                }
            }
            last_flush = Instant::now();
        }
    }
    emit_losses(
        &shared,
        &identity,
        &summary_producer,
        &mut slots,
        &mut sequence,
    );
    for slot in &mut slots {
        if slot.failed.is_none() {
            let _ = slot.destination.flush();
        }
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis().min(MAX_SAFE_INTEGER as u128) as u64)
}

fn deliver(slots: &mut [Slot], record: &Record) -> bool {
    let Ok(mut bytes) = serde_json::to_vec(record) else {
        return false;
    };
    bytes.push(b'\n');
    if bytes.len() > MAX_EVENT_BYTES {
        return false;
    }
    let mut success = true;
    for slot in slots {
        success &= slot.write(&record.input, &bytes);
        if record.input.level == Level::Error
            && slot.failed.is_none()
            && slot.destination.flush().is_err()
        {
            slot.failed = Some(Instant::now());
            success = false;
        }
    }
    success
}

fn emit_losses(
    shared: &Shared,
    identity: &HostIdentity,
    producer: &str,
    slots: &mut [Slot],
    sequence: &mut u64,
) {
    if slots.iter_mut().any(|slot| !slot.ready()) {
        return;
    }
    for (index, counter) in shared.losses.iter().enumerate() {
        let count = counter.swap(0, Ordering::Relaxed);
        if count == 0 {
            continue;
        }
        let origin = [Origin::Frontend, Origin::Native, Origin::Plugin][(index % 15) / 5];
        let level = [
            Level::Trace,
            Level::Debug,
            Level::Info,
            Level::Warn,
            Level::Error,
        ][index % 5];
        let record = Record { identity: identity.clone(), bound: BoundContext { origin, workspace_id: None }, producer_id: producer.into(), collector_sequence: *sequence, received_at_ms: timestamp_ms(), input: EventInput {
            schema_version: 1, event: "diagnostics.dropped".into(), level, category: "diagnostics".into(), timestamp_ms: timestamp_ms(), sequence: *sequence, context: None,
            attributes: serde_json::from_value(serde_json::json!({"count":count,"error_code":(["overload", "contention", "io"][index / 15])})).unwrap_or_default(),
        }};
        *sequence = sequence.saturating_add(1).min(MAX_SAFE_INTEGER);
        if !deliver(slots, &record) {
            let _ = counter.try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                Some(n.saturating_add(count).min(MAX_SAFE_INTEGER))
            });
        }
    }
}
