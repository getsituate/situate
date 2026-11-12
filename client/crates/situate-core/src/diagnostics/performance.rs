use super::*;
use std::{
    io,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use uuid::Uuid;

struct TimedSink {
    delay: Duration,
    gate: Option<(mpsc::SyncSender<()>, mpsc::Receiver<()>)>,
    bytes: Arc<AtomicUsize>,
    records: Arc<AtomicUsize>,
}
impl Destination for TimedSink {
    fn write(&mut self, record: &[u8]) -> io::Result<()> {
        self.bytes.fetch_add(record.len(), Ordering::Relaxed);
        self.records.fetch_add(1, Ordering::Relaxed);
        if let Some((entered, release)) = self.gate.take() {
            entered.send(()).unwrap();
            release.recv().unwrap();
        }
        if !self.delay.is_zero() {
            std::thread::sleep(self.delay);
        }
        Ok(())
    }
}

#[test]
#[ignore = "manual producer latency measurement"]
fn producer_latency() {
    for mode in ["healthy", "slow", "blocked"] {
        let (entered_send, entered) = mpsc::sync_channel(1);
        let (release, release_receive) = mpsc::sync_channel(1);
        let host = HostIdentity {
            device_id: Uuid::new_v4().to_string(),
            session_id: Uuid::new_v4().to_string(),
            app_version: "0.0.1".into(),
            platform: "test".into(),
            platform_version: "1".into(),
        };
        let bytes = Arc::new(AtomicUsize::new(0));
        let records = Arc::new(AtomicUsize::new(0));
        let collector = Collector::with_destinations(
            host,
            vec![DestinationRegistration {
                destination: Box::new(TimedSink {
                    bytes: bytes.clone(),
                    records: records.clone(),
                    delay: if mode == "slow" {
                        Duration::from_millis(1)
                    } else {
                        Duration::ZERO
                    },
                    gate: if mode == "blocked" {
                        Some((entered_send, release_receive))
                    } else {
                        None
                    },
                }),
                filter: DestinationFilter::default(),
            }],
        )
        .unwrap();
        let producer = collector
            .producer(BoundContext {
                origin: Origin::Native,
                workspace_id: None,
            })
            .unwrap();
        let input = EventInput {
            schema_version: 1,
            event: "operation.finished".into(),
            level: Level::Info,
            category: "storage".into(),
            timestamp_ms: 1,
            sequence: 0,
            context: None,
            attributes: serde_json::from_value(
                serde_json::json!({"action":"save","outcome":"success","duration_ms":1}),
            )
            .unwrap(),
        };
        if mode == "blocked" {
            let deadline = Instant::now() + Duration::from_secs(1);
            while !producer.emit(input.clone()) {
                assert!(Instant::now() < deadline);
                std::thread::yield_now();
            }
            entered.recv_timeout(Duration::from_secs(1)).unwrap();
        }
        let baseline = Instant::now();
        for _ in 0..10_000 {
            std::hint::black_box(input.clone());
        }
        let baseline_ns = baseline.elapsed().as_nanos() / 10_000;
        let mut elapsed = Vec::with_capacity(10_000);
        let mut admitted = 0;
        let start = Instant::now();
        for _ in 0..10_000 {
            let event = input.clone();
            let begin = Instant::now();
            admitted += usize::from(producer.emit(event));
            elapsed.push(begin.elapsed().as_nanos());
        }
        let total = start.elapsed();
        elapsed.sort_unstable();
        if mode == "blocked" {
            release.send(()).unwrap();
        }
        let drained = collector.shutdown(Duration::from_secs(1));
        let written = records.load(Ordering::Relaxed);
        let written_bytes = bytes.load(Ordering::Relaxed);
        println!(
            "{mode}: samples=10000 admitted={admitted} p50_ns={} p95_ns={} p99_ns={} max_ns={} elapsed_ms={} clone_baseline_ns={baseline_ns} written={written} bytes={written_bytes} mean_bytes={} drained={drained}",
            elapsed[5000],
            elapsed[9500],
            elapsed[9900],
            elapsed[9999],
            total.as_millis(),
            written_bytes / written.max(1)
        );
    }
}
