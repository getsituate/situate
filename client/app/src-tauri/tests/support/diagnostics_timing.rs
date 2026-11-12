use serde_json::{Value, json};
use std::{
    sync::{
        Mutex, TryLockError,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

const LIMIT: usize = 2048;
static TIMINGS: Mutex<FileTimings> = Mutex::new(FileTimings::new());
static CONTENDED: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
pub enum FileStage {
    DiagnosticStart,
    Authorization,
    DispatchQueue,
    Execution,
    DiagnosticFinish,
}

struct FileTimings {
    active: bool,
    samples: [Vec<f64>; 5],
    overflow: [u64; 5],
}

impl FileTimings {
    const fn new() -> Self {
        Self {
            active: false,
            samples: [Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new()],
            overflow: [0; 5],
        }
    }

    fn record(&mut self, stage: FileStage, elapsed: Duration) {
        if !self.active {
            return;
        }
        let index = stage as usize;
        if self.samples[index].len() == LIMIT {
            self.overflow[index] += 1;
        } else {
            self.samples[index].push(elapsed.as_secs_f64() * 1000.0);
        }
    }

    fn finish(&mut self) -> Value {
        self.active = false;
        let mut stages = serde_json::Map::new();
        for (index, name) in [
            "diagnostic_start",
            "authorization",
            "dispatch_queue",
            "execution",
            "diagnostic_finish",
        ]
        .into_iter()
        .enumerate()
        {
            let values = &mut self.samples[index];
            values.sort_by(f64::total_cmp);
            stages.insert(
                name.into(),
                json!({
                    "count": values.len(), "overflow": self.overflow[index],
                    "p95_ms": values.get(values.len() * 95 / 100),
                    "max_ms": values.last(),
                    "total_ms": values.iter().sum::<f64>(),
                }),
            );
        }
        Value::Object(stages)
    }
}

pub fn record_file_stage(stage: FileStage, elapsed: Duration) {
    match TIMINGS.try_lock() {
        Ok(mut timings) => timings.record(stage, elapsed),
        Err(TryLockError::WouldBlock) => {
            CONTENDED.fetch_add(1, Ordering::Relaxed);
        }
        Err(TryLockError::Poisoned(_)) => {}
    }
}

pub fn begin_file_timings() -> Result<(), String> {
    let mut timings = TIMINGS
        .lock()
        .map_err(|_| "File timing state unavailable")?;
    *timings = FileTimings::new();
    timings.active = true;
    CONTENDED.store(0, Ordering::Relaxed);
    Ok(())
}

pub fn finish_file_timings() -> Result<Value, String> {
    let mut timings = TIMINGS
        .lock()
        .map_err(|_| "File timing state unavailable")?;
    Ok(json!({"stages":timings.finish(),"contention_drops":CONTENDED.load(Ordering::Relaxed)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inactive_and_finished_windows_do_not_collect() {
        let mut timings = FileTimings::new();
        timings.record(FileStage::Execution, Duration::from_millis(7));
        timings.active = true;
        timings.record(FileStage::Execution, Duration::from_millis(3));
        assert_eq!(timings.finish()["execution"]["total_ms"], 3.0);
        timings.record(FileStage::Execution, Duration::from_millis(11));
        assert_eq!(timings.finish()["execution"]["count"], 1);
    }

    #[test]
    fn observations_are_bounded_and_stage_summaries_are_independent() {
        let mut timings = FileTimings::new();
        timings.active = true;
        for _ in 0..LIMIT + 3 {
            timings.record(FileStage::DispatchQueue, Duration::from_millis(2));
        }
        for ms in 1..=100 {
            timings.record(FileStage::Execution, Duration::from_millis(ms));
        }
        let result = timings.finish();
        assert_eq!(result["dispatch_queue"]["count"], 2048);
        assert_eq!(result["dispatch_queue"]["overflow"], 3);
        assert_eq!(result["dispatch_queue"]["total_ms"], 4096.0);
        assert_eq!(result["execution"]["count"], 100);
        assert_eq!(result["execution"]["p95_ms"], 96.0);
        assert_eq!(result["execution"]["max_ms"], 100.0);
        assert_eq!(result["diagnostic_start"]["p95_ms"], Value::Null);
    }
}
