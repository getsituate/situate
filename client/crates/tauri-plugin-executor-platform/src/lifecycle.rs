use std::time::{Duration, Instant};

const DEADLINE: Duration = Duration::from_secs(15);

pub(crate) struct Lifecycle {
    opened: Instant,
    heartbeat: Instant,
    ready: bool,
    closed: bool,
}

impl Lifecycle {
    pub(crate) fn new(now: Instant) -> Self {
        Self {
            opened: now,
            heartbeat: now,
            ready: false,
            closed: false,
        }
    }
    pub(crate) fn heartbeat(&mut self, now: Instant) {
        if !self.closed {
            self.heartbeat = now;
        }
    }
    pub(crate) fn ready(&mut self) {
        self.ready = true;
    }
    pub(crate) fn expired(&self, now: Instant) -> bool {
        !self.closed
            && (now.duration_since(self.heartbeat) >= DEADLINE
                || (!self.ready && now.duration_since(self.opened) >= DEADLINE))
    }
    pub(crate) fn is_closed(&self) -> bool {
        self.closed
    }
    pub(crate) fn close(&mut self) -> bool {
        if self.closed {
            return false;
        }
        self.closed = true;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_must_finish_even_if_heartbeats_continue() {
        let start = Instant::now();
        let mut state = Lifecycle::new(start);
        state.heartbeat(start + Duration::from_secs(14));
        assert!(!state.expired(start + Duration::from_secs(14)));
        assert!(state.expired(start + Duration::from_secs(15)));
    }

    #[test]
    fn heartbeat_deadline_and_revocation_are_terminal() {
        let start = Instant::now();
        let mut state = Lifecycle::new(start);
        state.ready();
        state.heartbeat(start + Duration::from_secs(10));
        assert!(!state.expired(start + Duration::from_secs(24)));
        assert!(state.expired(start + Duration::from_secs(25)));
        assert!(state.close());
        assert!(!state.close());
        state.heartbeat(start + Duration::from_secs(30));
        assert!(state.is_closed());
        assert!(!state.expired(start + Duration::from_secs(60)));
    }
}
