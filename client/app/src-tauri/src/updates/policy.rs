use serde::Serialize;
use url::Url;

pub const DEFAULT_ENDPOINT: &str = "https://getsituate.com/releases/current/update.json";
pub const DAY: u64 = 24 * 60 * 60 * 1000;

pub fn direct(distribution: Option<&str>, macos: bool) -> bool {
    macos && distribution == Some("direct")
}

pub fn secure_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Current,
    Checking,
    Downloading,
    Ready,
    Preparing,
    Installing,
    CheckFailed,
    DownloadFailed,
    InstallFailed,
    RecoveryRequired,
}

#[derive(Default, Debug)]
pub struct Retry {
    failures: usize,
    pub due: u64,
    pub offline: bool,
    last_failure: Option<u64>,
}
impl Retry {
    pub fn failed(&mut self, now: u64, offline: bool) {
        let minutes = [1, 5, 30, 60][self.failures.min(3)];
        self.failures = self.failures.saturating_add(1);
        self.due = now.saturating_add(minutes * 60_000);
        self.offline = offline;
        self.last_failure = Some(now);
    }
    pub fn reconcile_clock(&mut self, now: u64) {
        if self.last_failure.is_some_and(|last| now < last) {
            self.due = now;
            self.last_failure = Some(now);
        }
    }
    pub fn succeeded(&mut self) {
        *self = Self::default();
    }
    pub fn connected(&mut self) {
        if self.offline {
            self.due = 0;
            self.offline = false;
        }
    }
}

pub fn check_due(now: u64, last: Option<u64>, retry: &Retry) -> bool {
    now >= retry.due && last.is_none_or(|last| last > now || now - last >= DAY)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_macos_direct_builds_have_authority() {
        for value in [
            None,
            Some(""),
            Some("external"),
            Some("Direct"),
            Some("unknown"),
        ] {
            assert!(!direct(value, true));
        }
        assert!(direct(Some("direct"), true));
        assert!(!direct(Some("direct"), false));
    }
    #[test]
    fn transport_rejects_plaintext_credentials_and_fragments() {
        for value in [
            "http://example.com",
            "https://user@example.com",
            "https://example.com/#secret",
            "file:///tmp/feed",
        ] {
            assert!(!secure_url(&Url::parse(value).unwrap()));
        }
        assert!(secure_url(&Url::parse(DEFAULT_ENDPOINT).unwrap()));
    }
    #[test]
    fn failure_waits_are_bounded_and_connectivity_does_not_skip_server_backoff() {
        let mut retry = Retry::default();
        for minutes in [1, 5, 30, 60, 60] {
            retry.failed(1_000, false);
            retry.connected();
            assert_eq!(retry.due, 1_000 + minutes * 60_000);
        }
        retry.failed(1_000, true);
        retry.connected();
        assert_eq!(retry.due, 0);
    }
    #[test]
    fn retained_success_and_download_retries_have_independent_clocks() {
        let now = DAY * 3;
        let mut download = Retry::default();
        download.failed(now, false);
        assert!(!check_due(now, Some(now), &Retry::default()));
        assert!(check_due(now + DAY, Some(now), &Retry::default()));
        assert_eq!(download.due, now + 60_000);
        assert!(check_due(now, None, &Retry::default()));
        assert!(check_due(now - 1, Some(now), &Retry::default()));
    }
}
