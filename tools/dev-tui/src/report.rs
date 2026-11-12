use crate::text;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suite {
    pub id: String,
    pub status: String,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Report {
    pub status: String,
    #[serde(default)]
    pub results: Vec<Suite>,
    pub error: Option<String>,
}
impl Report {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let report: Self =
            serde_json::from_slice(bytes).map_err(|e| format!("{}: {e}", text::REPORT_INVALID))?;
        if !matches!(
            report.status.as_str(),
            "passed" | "failed" | "cancelled" | "no-tests" | "error"
        ) || (report.status == "passed"
            && (report.results.is_empty() || report.results.iter().any(|s| s.status != "passed")))
            || (report.successful() && report.error.is_some())
            || report.results.iter().any(|suite| {
                suite.status == "passed" && (suite.exit_code != Some(0) || suite.error.is_some())
            })
            || (report.status == "no-tests" && !report.results.is_empty())
        {
            return Err(text::REPORT_INVALID.into());
        }
        Ok(report)
    }
    pub fn successful(&self) -> bool {
        matches!(self.status.as_str(), "passed" | "no-tests")
    }
    pub fn lines(&self) -> Vec<String> {
        let mut lines = vec![if self.status == "no-tests" {
            text::NO_TESTS.into()
        } else {
            self.status.clone()
        }];
        if let Some(error) = &self.error {
            lines.push(format!("{}: {error}", text::REPORT_ERROR));
        }
        for suite in &self.results {
            lines.push(format!(
                "{:<12} {}  {:.2}s  {}: {}",
                suite.status,
                suite.id,
                suite.duration_ms as f64 / 1000.0,
                text::EXIT,
                suite
                    .exit_code
                    .map_or_else(|| "—".into(), |c| c.to_string())
            ));
            if let Some(error) = &suite.error {
                lines.push(format!("  {error}"));
            }
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_tests_is_not_passed() {
        let r = Report::parse(br#"{"status":"no-tests","results":[]}"#).unwrap();
        assert_eq!(r.lines(), [text::NO_TESTS]);
    }
    #[test]
    fn parses_suite_errors_and_runner_errors() {
        let r = Report::parse(br#"{"status":"failed","results":[{"id":"core","status":"failed","durationMs":12,"exitCode":1,"error":"missing tool"}]}"#).unwrap();
        assert!(!r.successful());
        assert!(r.lines().join("\n").contains("missing tool"));
        assert!(
            Report::parse(br#"{"status":"error","error":"bad base"}"#)
                .unwrap()
                .lines()
                .join("\n")
                .contains("bad base")
        );
    }
    #[test]
    fn rejects_contradictory_success() {
        for json in [
            r#"{"status":"no-tests","error":"failed setup"}"#,
            r#"{"status":"passed","results":[{"id":"core","status":"passed","durationMs":1,"exitCode":1}]}"#,
            r#"{"status":"passed","results":[{"id":"core","status":"passed","durationMs":1,"exitCode":0,"error":"incomplete"}]}"#,
        ] {
            assert!(Report::parse(json.as_bytes()).is_err());
        }
    }
    #[test]
    fn rejects_missing_malformed_or_inconsistent_reports() {
        for bytes in [
            b"".as_slice(),
            b"not json",
            br#"{"status":"passed"}"#,
            br#"{"status":"planned"}"#,
        ] {
            assert!(Report::parse(bytes).is_err());
        }
    }
}
