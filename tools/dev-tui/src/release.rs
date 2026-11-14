use crate::{
    actions::{CommandSpec, Task},
    app::{App, Dialog, Status},
    process::Outcome,
};
use crossterm::event::{KeyCode, KeyEvent};
use serde_json::Value;
use std::{path::Path, process::Command};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Plan,
    Run,
    Status,
    Inspect,
    Reconcile,
}
impl Action {
    pub fn argument(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Run => "run",
            Self::Status => "status",
            Self::Inspect => "inspect",
            Self::Reconcile => "reconcile",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Plan => "Release · Plan",
            Self::Run => "Release · Run",
            Self::Status => "Release · Status",
            Self::Inspect => "Release · Inspect",
            Self::Reconcile => "Release · Reconcile",
        }
    }
    pub fn writes(self) -> bool {
        matches!(self, Self::Run | Self::Reconcile)
    }
}

pub fn command(root: &Path, action: Action, args: &[String]) -> CommandSpec {
    let mut spec = CommandSpec::new("node", &["tools/pipeline.mjs", action.argument()], root);
    spec.args.extend_from_slice(args);
    spec.report = true;
    spec.events = action != Action::Plan;
    spec
}

#[derive(Default)]
pub struct Workflow {
    pub workflow: String,
    pub fields: Vec<(String, String)>,
    pub field: usize,
    pub plan: Option<Value>,
    file: Option<tempfile::NamedTempFile>,
    pending: Option<usize>,
    inspection: Option<Value>,
    recovery: bool,
}
impl Workflow {
    pub fn confirmation_label(&self) -> &'static str {
        if self.inspection.is_some() {
            "y Reconcile inspected operation"
        } else {
            "y Authorize exact plan"
        }
    }
    pub fn description(&self) -> String {
        if let Some(observation) = &self.inspection {
            return format!(
                "Action: Reconcile existing operation\n{}\n\nReview the exact operation, remote observation and reconciliation digest. No automatic retry or rollback.",
                serde_json::to_string_pretty(observation).unwrap()
            );
        }
        if let Some(plan) = &self.plan {
            return format!(
                "Action: {}\n{}\n\nReview every identity and stage before authorizing.\nNo automatic retry or rollback.",
                "Run workflow",
                serde_json::to_string_pretty(plan).unwrap()
            );
        }
        let mut lines = vec![format!("Workflow: {}", self.workflow)];
        for (index, (name, value)) in self.fields.iter().enumerate() {
            lines.push(format!(
                "{} {name}: {value}{}",
                if index == self.field { ">" } else { " " },
                if index == self.field { "_" } else { "" }
            ));
        }
        lines.push("Tab selects a field; Enter plans. Use the original operation identity for recovery. Inspect before reconciliation.".into());
        lines.join("\n")
    }
    fn arguments(&self) -> Result<Vec<String>, String> {
        let mut args = vec![self.workflow.clone()];
        for (name, value) in &self.fields {
            if value.is_empty() || value.starts_with('-') || value.chars().any(char::is_control) {
                return Err(format!("Enter an explicit {name}."));
            }
            if matches!(name.as_str(), "source" | "base")
                && (value.len() != 40 || !value.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                return Err(format!("{name} must be an exact 40-character Git SHA."));
            }
            args.extend([format!("--{name}"), value.clone()]);
        }
        if self.workflow == "publish" {
            args.extend(["--repository".into(), "getsituate/situate".into()]);
        }
        Ok(args)
    }
    fn operation_arguments(&self) -> Result<Vec<String>, String> {
        let operation = self
            .fields
            .iter()
            .find(|(name, _)| name == "operation")
            .map(|(_, value)| value.as_str())
            .unwrap_or_default();
        if operation.is_empty()
            || operation.len() > 80
            || !operation
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || !operation.as_bytes()[0].is_ascii_alphanumeric()
        {
            return Err("Enter the original operation ID.".into());
        }
        Ok(vec![
            self.workflow.clone(),
            "--operation".into(),
            operation.into(),
        ])
    }
    fn validate_observation(&self, value: &Value) -> Result<(), String> {
        let operation = self.operation_arguments()?;
        if value["schemaVersion"] != 1
            || value["operationId"] != operation[2]
            || !["planDigest", "stateDigest", "reconciliationDigest"]
                .iter()
                .all(|key| valid_digest(&value[*key]))
            || !value
                .as_object()
                .is_some_and(|object| object.contains_key("remote"))
        {
            return Err(
                "Invalid inspection or operation identity. Inspect again before reconciliation."
                    .into(),
            );
        }
        Ok(())
    }
    fn validate_journal(&self, value: &Value) -> Result<(), String> {
        let operation = self.operation_arguments()?;
        if value["schemaVersion"] != 1
            || value["operationId"] != operation[2]
            || value["plan"]["workflow"] != self.workflow
            || !digest(&value["plan"])
            || !value["stages"].is_array()
            || !value["status"].is_string()
        {
            return Err("Invalid operation journal or workflow identity.".into());
        }
        Ok(())
    }
    fn validate_plan(&self, bytes: &[u8]) -> Result<Value, String> {
        let plan: Value =
            serde_json::from_slice(bytes).map_err(|_| "Invalid or incomplete workflow plan.")?;
        if plan["schemaVersion"] != 1 || plan["workflow"] != self.workflow || !digest(&plan) {
            return Err("Unsupported workflow plan or missing authorization digest.".into());
        }
        for (name, value) in &self.fields {
            let key = if name == "release-id" {
                "releaseId"
            } else {
                name
            };
            if plan[key].as_str() != Some(value)
                && !(key == "releaseId"
                    && plan[key]
                        .as_u64()
                        .is_some_and(|id| id.to_string() == *value))
            {
                return Err(format!("The plan changed {name}; request a new plan."));
            }
        }
        if self.workflow == "publish" && plan["repository"] != "getsituate/situate" {
            return Err("The plan targets a different repository.".into());
        }
        Ok(plan)
    }
}
fn digest(value: &Value) -> bool {
    valid_digest(&value["authorizationDigest"])
}
fn valid_digest(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}

pub fn result(bytes: &[u8]) -> Result<Value, String> {
    let mut terminal = None;
    for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
        let value: Value =
            serde_json::from_slice(line).map_err(|_| "Invalid or partial workflow event.")?;
        if terminal.is_some() {
            return Err("Unexpected data after workflow result.".into());
        }
        match value["type"].as_str() {
            Some("result") => terminal = Some(value),
            Some("stage" | "suite") => {}
            None if value["schemaVersion"] == 1 && value["operationId"].is_string() => {
                terminal = Some(value)
            }
            _ => return Err("Unknown workflow event.".into()),
        }
    }
    terminal.ok_or_else(|| {
        "Workflow ended without a structured result. Inspect before retrying.".into()
    })
}

impl App {
    pub fn open_workflow(&mut self, workflow: &str) {
        if self.workflow.pending.is_some() {
            self.notice =
                "Wait for the active workflow or stop it before selecting another operation."
                    .into();
            return;
        }
        let source = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.root)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        let mut fields = if workflow == "publish" {
            vec![("release-id".into(), String::new())]
        } else {
            vec![("source".into(), source), ("base".into(), String::new())]
        };
        if workflow != "verify" {
            fields.extend([
                ("destination".into(), String::new()),
                ("operation".into(), String::new()),
            ]);
        }
        self.workflow = Workflow {
            workflow: workflow.into(),
            fields,
            ..Workflow::default()
        };
        self.notice.clear();
        self.dialog = Some(Dialog::WorkflowInput);
    }
    fn workflow_start(&mut self, action: Action) {
        if self.workflow.pending.is_some() {
            return;
        }
        let args = if matches!(action, Action::Inspect | Action::Status | Action::Reconcile) {
            match self.workflow.operation_arguments().and_then(|mut args| {
                if action == Action::Reconcile {
                    let observation = self
                        .workflow
                        .inspection
                        .as_ref()
                        .ok_or("Inspect this operation first.")?;
                    self.workflow.validate_observation(observation)?;
                    args.extend([
                        "--confirm".into(),
                        observation["reconciliationDigest"].as_str().unwrap().into(),
                    ]);
                }
                Ok(args)
            }) {
                Ok(args) => args,
                Err(error) => {
                    self.notice = error;
                    return;
                }
            }
        } else if action == Action::Run {
            let Some(plan) = &self.workflow.plan else {
                return;
            };
            if self.workflow.recovery {
                self.notice = "Inspect this operation first.".into();
                return;
            }
            let Some(file) = &self.workflow.file else {
                return;
            };
            vec![
                self.workflow.workflow.clone(),
                "--plan".into(),
                file.path().to_string_lossy().into_owned(),
                "--confirm".into(),
                plan["authorizationDigest"].as_str().unwrap().into(),
            ]
        } else {
            match self.workflow.arguments() {
                Ok(args) => args,
                Err(error) => {
                    self.notice = error;
                    return;
                }
            }
        };
        let mut spec = command(&self.root, action, &args);
        if action == Action::Plan {
            self.workflow.plan = None;
            match tempfile::NamedTempFile::new() {
                Ok(file) => {
                    spec.args.extend([
                        "--output".into(),
                        file.path().to_string_lossy().into_owned(),
                    ]);
                    self.workflow.file = Some(file);
                }
                Err(error) => {
                    self.notice = error.to_string();
                    return;
                }
            }
        }
        let previous = self.runs.last().map(|r| r.id);
        self.launch_spec(Task::Workflow(action), spec);
        if let Some(run) = self.runs.last().filter(|r| Some(r.id) != previous) {
            self.workflow.pending = Some(run.id);
            if action.writes() && self.workflow.workflow != "verify" {
                self.workflow.recovery = true;
                self.workflow.inspection = None;
            }
            self.dialog = None;
        }
    }
    pub fn workflow_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                self.workflow.plan = None;
                self.dialog = None;
            }
            KeyCode::Tab | KeyCode::Down if self.dialog == Some(Dialog::WorkflowInput) => {
                self.workflow.field = (self.workflow.field + 1) % self.workflow.fields.len();
            }
            KeyCode::BackTab | KeyCode::Up if self.dialog == Some(Dialog::WorkflowInput) => {
                self.workflow.field = (self.workflow.field + self.workflow.fields.len() - 1)
                    % self.workflow.fields.len();
            }
            KeyCode::Backspace if self.dialog == Some(Dialog::WorkflowInput) => {
                self.workflow.fields[self.workflow.field].1.pop();
                self.workflow.inspection = None;
                self.workflow.recovery = false;
            }
            KeyCode::Enter if self.dialog == Some(Dialog::WorkflowInput) => {
                self.workflow_start(Action::Plan)
            }
            KeyCode::Char('y') if self.dialog == Some(Dialog::WorkflowConfirm) => self
                .workflow_start(if self.workflow.inspection.is_some() {
                    Action::Reconcile
                } else {
                    Action::Run
                }),
            KeyCode::F(2) if self.dialog == Some(Dialog::WorkflowInput) => {
                self.workflow_start(Action::Inspect)
            }
            KeyCode::F(3) if self.dialog == Some(Dialog::WorkflowInput) => {
                self.workflow_start(Action::Status)
            }
            KeyCode::Char(c)
                if self.dialog == Some(Dialog::WorkflowInput)
                    && !c.is_control()
                    && self.workflow.fields[self.workflow.field].1.len() < 512 =>
            {
                self.workflow.fields[self.workflow.field].1.push(c);
                self.workflow.inspection = None;
                self.workflow.recovery = false;
            }
            _ => {}
        }
    }
    pub fn workflow_finished(&mut self, id: usize, action: Action, outcome: &Outcome) {
        if self.workflow.pending != Some(id) {
            return;
        }
        self.workflow.pending = None;
        let original_dialog = self.dialog;
        let closing = self.quitting || original_dialog == Some(Dialog::Quit);
        if action == Action::Plan && outcome.success() {
            let parsed = self
                .workflow
                .validate_plan(&outcome.report)
                .and_then(|plan| {
                    let bytes = std::fs::read(self.workflow.file.as_ref().unwrap().path())
                        .map_err(|e| e.to_string())?;
                    let saved: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                    if saved != plan {
                        return Err("Saved plan differs from the displayed plan.".into());
                    }
                    Ok(plan)
                });
            match parsed {
                Ok(plan) => {
                    self.workflow.plan = Some(plan);
                    self.dialog = Some(Dialog::WorkflowConfirm);
                }
                Err(error) => {
                    self.workflow_fail(id, error);
                    self.dialog = Some(Dialog::WorkflowInput);
                }
            }
        } else if action != Action::Plan {
            let decoded = match action {
                Action::Inspect | Action::Status => {
                    serde_json::from_slice::<Value>(&outcome.report)
                        .map_err(|_| "Invalid or partial operation JSON.".to_string())
                }
                _ => result(&outcome.report),
            };
            let checked = decoded.and_then(|value| {
                match action {
                    Action::Inspect => self.workflow.validate_observation(&value)?,
                    Action::Status | Action::Reconcile => self.workflow.validate_journal(&value)?,
                    Action::Run if value["type"] != "result" => {
                        return Err("Missing workflow result.".into());
                    }
                    _ => {}
                }
                if !outcome.success() {
                    return Err("Workflow command failed. Inspect before reconciliation.".into());
                }
                if matches!(action, Action::Run | Action::Reconcile)
                    && !matches!(value["status"].as_str(), Some("passed" | "completed"))
                {
                    return Err(
                        "Workflow did not complete successfully. Inspect before reconciliation."
                            .into(),
                    );
                }
                Ok(value)
            });
            self.workflow.plan = None;
            match checked {
                Ok(value) if action == Action::Inspect => {
                    self.workflow.inspection = Some(value);
                    self.workflow.recovery = true;
                    self.dialog = Some(Dialog::WorkflowConfirm);
                }
                Ok(_) => {}
                Err(error) => {
                    self.workflow.inspection = None;
                    self.workflow_fail(id, error);
                }
            }
        }
        if closing {
            self.dialog = original_dialog;
        }
    }
    fn workflow_fail(&mut self, id: usize, error: String) {
        self.notice = error.clone();
        if let Some(run) = self.runs.iter_mut().find(|r| r.id == id) {
            if run.status != Status::Cancelled {
                run.status = Status::Failed;
            }
            run.logs.push_back(error);
            if matches!(run.task, Task::Workflow(action) if action.writes()) {
                run.logs
                    .push_back(crate::text::PUBLICATION_UNCERTAIN.into());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_partial_and_missing_results_fail_closed() {
        for bytes in [
            b"".as_slice(),
            b"{",
            b"{\"type\":\"stage\",\"stage\":\"build\"}\n",
            b"{\"type\":\"result\"}\n{",
            b"{\"type\":\"unknown\"}",
        ] {
            assert!(result(bytes).is_err());
        }
        assert_eq!(result(b"{\"type\":\"stage\",\"stage\":\"build\",\"status\":\"passed\"}\n{\"type\":\"result\",\"status\":\"passed\"}\n").unwrap()["status"], "passed");
    }
    #[tokio::test]
    async fn core_response_shapes_preserve_reports_and_fail_closed() {
        let observation = serde_json::json!({
            "schemaVersion":1, "operationId":"original", "planDigest":"a".repeat(64),
            "stateDigest":"b".repeat(64), "remote":{"state":"unknown"},
            "reconciliationDigest":"c".repeat(64)
        });
        let journal = serde_json::json!({
            "schemaVersion":1, "operationId":"original",
            "plan":{"workflow":"publish","authorizationDigest":"a".repeat(64)},
            "status":"completed","stages":[]
        });
        let progress = "{\"type\":\"suite\",\"suite\":\"unit\",\"status\":\"passed\"}\n{\"type\":\"stage\",\"stage\":\"promote\",\"status\":\"passed\"}\n";
        let mut cases = vec![
            (
                Action::Run,
                format!("{progress}{{\"type\":\"result\",\"status\":\"completed\"}}\n"),
                true,
            ),
            (
                Action::Run,
                format!("{progress}{{\"type\":\"result\",\"status\":\"passed\"}}\n"),
                true,
            ),
            (
                Action::Run,
                format!("{progress}{{\"type\":\"result\",\"status\":\"failed\"}}\n"),
                false,
            ),
            (Action::Run, progress.into(), false),
            (Action::Run, format!("{progress}{{"), false),
            (
                Action::Inspect,
                serde_json::to_string_pretty(&observation).unwrap(),
                true,
            ),
            (
                Action::Status,
                serde_json::to_string_pretty(&journal).unwrap(),
                true,
            ),
            (Action::Reconcile, format!("{progress}{journal}\n"), true),
            (Action::Inspect, "{\"schemaVersion\":1".into(), false),
            (Action::Status, "{\"schemaVersion\":1".into(), false),
            (
                Action::Reconcile,
                format!("{progress}{{\"schemaVersion\":1"),
                false,
            ),
        ];
        for key in [
            "operationId",
            "planDigest",
            "stateDigest",
            "reconciliationDigest",
        ] {
            let mut invalid = observation.clone();
            invalid[key] = "different".into();
            cases.push((Action::Inspect, invalid.to_string(), false));
        }
        for (action, report, passed) in cases {
            let mut app = crate::app::tests::app();
            app.workflow = Workflow {
                workflow: "publish".into(),
                fields: vec![("operation".into(), "original".into())],
                pending: Some(0),
                ..Workflow::default()
            };
            app.runs
                .push(crate::app::tests::fake_run(Task::Workflow(action)));
            let bytes = report.into_bytes();
            app.event(crate::process::Event::Finished(
                0,
                Outcome {
                    code: Some(0),
                    report: bytes.clone(),
                    ..Outcome::default()
                },
            ));
            assert_eq!(
                app.runs[0].status == Status::Passed,
                passed,
                "{action:?}: {}",
                String::from_utf8_lossy(&bytes)
            );
            assert_eq!(app.runs[0].raw_report, bytes);
            assert_eq!(
                app.workflow.inspection.is_some(),
                passed && action == Action::Inspect
            );
            assert_eq!(
                app.dialog == Some(Dialog::WorkflowConfirm),
                passed && action == Action::Inspect
            );
        }
    }
    #[test]
    fn recovery_requires_only_the_original_operation_identity() {
        let workflow = Workflow {
            workflow: "create".into(),
            fields: vec![
                ("source".into(), String::new()),
                ("base".into(), String::new()),
                ("operation".into(), "original".into()),
            ],
            ..Workflow::default()
        };
        assert_eq!(
            workflow.operation_arguments().unwrap(),
            ["create", "--operation", "original"]
        );
        assert!(workflow.arguments().is_err());
    }
    #[test]
    fn plan_binds_all_requested_identities() {
        let workflow = Workflow {
            workflow: "publish".into(),
            fields: vec![
                ("release-id".into(), "42".into()),
                ("destination".into(), "host".into()),
                ("operation".into(), "operation-1".into()),
            ],
            ..Workflow::default()
        };
        let mut plan = serde_json::json!({"schemaVersion":1,"workflow":"publish","releaseId":"42","destination":"host","operation":"operation-1","repository":"getsituate/situate","authorizationDigest":"a".repeat(64)});
        assert!(
            workflow
                .validate_plan(&serde_json::to_vec(&plan).unwrap())
                .is_ok()
        );
        for key in [
            "releaseId",
            "destination",
            "operation",
            "repository",
            "authorizationDigest",
        ] {
            let saved = plan[key].clone();
            plan[key] = "different".into();
            assert!(
                workflow
                    .validate_plan(&serde_json::to_vec(&plan).unwrap())
                    .is_err()
            );
            plan[key] = saved;
        }
        assert!(
            !workflow
                .arguments()
                .unwrap()
                .iter()
                .any(|arg| arg.contains("GITHUB_"))
        );
    }
}
