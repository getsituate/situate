use crate::{
    actions::{Task, browser, client_dependencies_ready, prepare_client},
    application_logs::ApplicationLogs,
    inspection::{self, Evidence},
    process::{self, Event, Outcome},
    publication::{self, Action as PublicationAction, Candidate},
    report::Report,
    text, version,
};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::{collections::VecDeque, path::PathBuf, time::Instant};
use tokio::{
    sync::{mpsc, watch},
    task::JoinHandle,
};

pub const LOG_LIMIT: usize = 3000;
const RUN_LIMIT: usize = 24;
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Running,
    Stopping,
    Passed,
    Failed,
    Cancelled,
    NoTests,
}
impl Status {
    pub fn label(self) -> &'static str {
        match self {
            Self::Running => text::RUNNING,
            Self::Stopping => text::STOPPING,
            Self::Passed => text::PASSED,
            Self::Failed => text::FAILED,
            Self::Cancelled => text::CANCELLED,
            Self::NoTests => text::NO_TESTS,
        }
    }
    pub fn active(self) -> bool {
        matches!(self, Self::Running | Self::Stopping)
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dialog {
    Install(Task),
    Tests,
    Releases,
    Preparation,
    PreparationInput(bool),
    PreparationConfirm(crate::release::Operation),
    ReleaseNumber { all: bool },
    ReleaseConfirm(Task),
    ReleaseVersion(Task),
    ReleaseTestPrompt(Task),
    ReleaseTestResults(Task),
    PublicationCandidates,
    PublicationActions,
    PublicationTarget(PublicationAction),
    PublicationConfirm(PublicationAction),
    Full,
    Quit,
    Help,
}

pub struct Run {
    pub id: usize,
    pub task: Task,
    pub status: Status,
    pub started: Instant,
    pub duration: Option<std::time::Duration>,
    pub code: Option<i32>,
    pub logs: VecDeque<String>,
    pub discarded: usize,
    pub report: Option<Report>,
    pub raw_report: Vec<u8>,
    pub commands: Vec<crate::actions::CommandSpec>,
    pub evidence: Option<Evidence>,
    pub preparing: bool,
    pub application_logs: Option<ApplicationLogs>,
    stop: watch::Sender<bool>,
    worker: JoinHandle<()>,
}
impl Run {
    fn log(&mut self, line: String) -> bool {
        if let Some(evidence) = &mut self.evidence {
            evidence.record(&line);
        }
        let trimmed = self.logs.len() == LOG_LIMIT;
        if trimmed {
            self.logs.pop_front();
            self.discarded += 1;
        }
        self.logs.push_back(line);
        trimmed
    }
    fn stop(&mut self) {
        if self.status.active() {
            self.status = Status::Stopping;
            let _ = self.stop.send(true);
        }
    }
    pub(crate) fn finish(&mut self, outcome: Outcome) {
        self.preparing = false;
        self.duration = Some(self.started.elapsed());
        self.code = outcome.code;
        let mut failed = !outcome.success();
        if self.task.is_test() && (!outcome.cancelled || !outcome.report.is_empty()) {
            match Report::parse(&outcome.report) {
                Ok(report) => {
                    failed |= !report.successful();
                    self.report = Some(report);
                }
                Err(error) => {
                    self.log(error);
                    failed = true;
                }
            }
        }
        if let Some(error) = outcome.error {
            self.log(error);
        }
        if matches!(self.task, Task::Publication(action) if action.writes_remote())
            && (failed || outcome.cancelled)
        {
            for line in text::PUBLICATION_UNCERTAIN.lines() {
                self.log(line.into());
            }
        }
        self.raw_report = outcome.report;
        self.status = if outcome.cancelled {
            Status::Cancelled
        } else if failed {
            Status::Failed
        } else if self.report.as_ref().is_some_and(|r| r.status == "no-tests") {
            Status::NoTests
        } else {
            Status::Passed
        };
    }
}

struct ReleaseTests {
    task: Task,
    run_id: Option<usize>,
    version: String,
}

pub struct App {
    pub root: PathBuf,
    #[cfg(test)]
    test_root: Option<tempfile::TempDir>,
    pub branch: String,
    pub runs: Vec<Run>,
    pub selected: usize,
    pub output_focus: bool,
    pub show_results: bool,
    pub show_application: bool,
    last_log_poll: Instant,
    pub scroll: usize,
    pub horizontal: u16,
    pub follow: bool,
    pub dialog: Option<Dialog>,
    pub notice: String,
    pub release_number: String,
    pub release: crate::release::Release,
    pub publication_candidates: Vec<Candidate>,
    pub publication_index: usize,
    pub publication_target: String,
    pub release_test_summary: String,
    pub current_version: String,
    pub version_input: String,
    pub release_app_version: String,
    release_tests: Option<ReleaseTests>,
    pub quitting: bool,
    inspect_run_id: Option<usize>,
    next_id: usize,
    tx: mpsc::Sender<Event>,
}
impl App {
    pub fn new(root: PathBuf, branch: String, tx: mpsc::Sender<Event>) -> Self {
        Self {
            root,
            #[cfg(test)]
            test_root: None,
            branch,
            tx,
            runs: vec![],
            selected: 0,
            output_focus: false,
            show_results: false,
            show_application: false,
            last_log_poll: Instant::now(),
            scroll: 0,
            horizontal: 0,
            follow: true,
            dialog: None,
            notice: String::new(),
            release_number: String::new(),
            release: crate::release::Release::default(),
            publication_candidates: vec![],
            publication_index: 0,
            publication_target: String::new(),
            release_test_summary: String::new(),
            current_version: String::new(),
            version_input: String::new(),
            release_app_version: String::new(),
            release_tests: None,
            quitting: false,
            inspect_run_id: None,
            next_id: 0,
        }
    }
    pub fn viewed_run(&self) -> Option<&Run> {
        self.selected
            .checked_sub(text::ACTIONS.len())
            .and_then(|i| self.runs.get(i))
            .or_else(|| self.runs.last())
    }
    fn controlled_run(&self) -> Option<usize> {
        self.selected.checked_sub(text::ACTIONS.len()).or_else(|| {
            self.output_focus
                .then(|| self.runs.len().checked_sub(1))
                .flatten()
        })
    }
    pub fn active(&self) -> bool {
        self.runs.iter().any(|r| r.status.active())
    }
    pub fn conflict(&self, task: Task) -> Option<&'static str> {
        for run in self.runs.iter().filter(|r| r.status.active()) {
            if run.task == task {
                return Some(text::DUPLICATE);
            }
            if (run.task.is_release() && (task.is_client() || task.is_test() || task.is_release()))
                || (task.is_release() && (run.task.is_client() || run.task.is_test()))
            {
                return Some(text::RELEASE_CONFLICT);
            }
            if run.task.is_client()
                && task.is_client()
                && (run.preparing || !client_dependencies_ready(&self.root))
            {
                return Some(text::CLIENT_INSTALL_CONFLICT);
            }
            if run.preparing && task.is_test() {
                return Some(text::TEST_INSTALL_CONFLICT);
            }
            if run.task.is_test() && task.is_test() {
                return Some(text::TEST_CONFLICT);
            }
            if run.task.is_client() && task == Task::Full {
                return Some(text::FULL_CLIENT_CONFLICT);
            }
            if run.task == Task::Full && task.is_client() {
                return Some(text::TEST_CLIENT_CONFLICT);
            }
            if run.task.is_test() && task.is_client() && !client_dependencies_ready(&self.root) {
                return Some(text::INSTALL_TEST_CONFLICT);
            }
        }
        None
    }
    pub fn launch(&mut self, task: Task) {
        if matches!(task, Task::Publication(_)) && !cfg!(target_os = "macos") {
            self.notice = text::RELEASE_HOST.into();
            return;
        }
        if task.is_apple_release() && !cfg!(target_os = "macos") {
            self.notice = text::RELEASE_HOST.into();
            return;
        }
        if task.is_apple_release()
            && (self.release_app_version.is_empty()
                || version::current(&self.root).ok().as_deref()
                    != Some(self.release_app_version.as_str()))
        {
            self.notice = text::VERSION_CHANGED.into();
            return;
        }
        if (task.is_client() || task.is_apple_release()) && !client_dependencies_ready(&self.root) {
            self.notice.clear();
            if let Some(reason) = self.conflict(task) {
                self.notice = reason.into();
            } else {
                self.dialog = Some(Dialog::Install(task));
            }
            return;
        }
        self.launch_with_setup(task, false);
    }
    fn launch_with_setup(&mut self, task: Task, install: bool) {
        self.notice.clear();
        if task.is_apple_release()
            && (self.release_app_version.is_empty()
                || version::current(&self.root).ok().as_deref()
                    != Some(self.release_app_version.as_str()))
        {
            self.notice = text::VERSION_CHANGED.into();
            return;
        }
        if let Some(reason) = self.conflict(task) {
            self.notice = reason.into();
            return;
        }
        let mut spec = if let Task::Publication(action) = task {
            let Some(candidate) = self.publication_candidates.get(self.publication_index) else {
                self.notice = text::PUBLICATION_EMPTY.into();
                return;
            };
            match candidate.command(&self.root, action, &self.publication_target) {
                Ok(spec) => spec,
                Err(error) => {
                    self.notice = error;
                    return;
                }
            }
        } else if install {
            prepare_client(&self.root)
        } else {
            task.command(&self.root)
        };
        let mut after_success = if install {
            Some(task.command(&self.root))
        } else {
            (task == Task::Docs).then(|| browser(&self.root))
        };
        if task.is_apple_release() {
            let build = after_success.as_mut().unwrap_or(&mut spec);
            build.args.extend([
                "--expected-version".into(),
                self.release_app_version.clone(),
            ]);
        }
        let application_logs = if task == Task::Desktop {
            match ApplicationLogs::new() {
                Ok(logs) => {
                    if let Some(next) = &mut after_success {
                        next.diagnostics_manifest = Some(logs.manifest_path());
                    } else {
                        spec.diagnostics_manifest = Some(logs.manifest_path());
                    }
                    Some(logs)
                }
                Err(_) => {
                    self.notice = text::APPLICATION_INIT_FAILED.into();
                    None
                }
            }
        } else {
            None
        };
        if task.is_apple_release() {
            spec.release_validation = Some(self.root.clone());
        }
        self.start_run(task, spec, after_success, install, application_logs);
    }
    pub fn launch_spec(&mut self, task: Task, spec: crate::actions::CommandSpec) {
        if let Some(reason) = self.conflict(task) {
            self.notice = reason.into();
            return;
        }
        self.start_run(task, spec, None, false, None);
    }
    fn start_run(
        &mut self,
        task: Task,
        spec: crate::actions::CommandSpec,
        after_success: Option<crate::actions::CommandSpec>,
        install: bool,
        application_logs: Option<ApplicationLogs>,
    ) {
        if self.runs.len() >= RUN_LIMIT
            && let Some(index) = self.runs.iter().position(|r| !r.status.active())
        {
            self.runs.remove(index);
        }
        let command = format!("> {}", spec.display());
        let mut evidence = if task.is_test() || task.is_release() {
            match Evidence::new(true) {
                Ok(evidence) => Some(evidence),
                Err(_) => {
                    self.notice = text::INSPECTION_CAPTURE_FAILED.into();
                    None
                }
            }
        } else {
            None
        };
        if let Some(evidence) = &mut evidence {
            evidence.record(&command);
        }
        let id = self.next_id;
        self.next_id += 1;
        let (stop, stopped) = watch::channel(false);
        let commands = std::iter::once(spec.clone())
            .chain(after_success.iter().cloned())
            .collect();
        let worker = process::start(id, spec, after_success, self.tx.clone(), stopped);
        self.runs.push(Run {
            id,
            task,
            status: Status::Running,
            started: Instant::now(),
            duration: None,
            code: None,
            logs: VecDeque::from([command]),
            discarded: 0,
            report: None,
            raw_report: vec![],
            commands,
            evidence,
            preparing: install,
            application_logs,
            stop,
            worker,
        });
        self.selected = text::ACTIONS.len() + self.runs.len() - 1;
        self.reset_view();
        self.output_focus = true;
    }
    pub fn poll_application_logs(&mut self) {
        if self.last_log_poll.elapsed() < std::time::Duration::from_millis(250) {
            return;
        }
        self.last_log_poll = Instant::now();
        let viewed = self.viewed_run().map(|run| run.id);
        for run in &mut self.runs {
            if let Some(logs) = &mut run.application_logs {
                let evicted = logs.evicted;
                logs.poll();
                if self.show_application && !self.follow && viewed == Some(run.id) {
                    self.scroll = self
                        .scroll
                        .saturating_sub(logs.evicted.saturating_sub(evicted));
                }
            }
        }
    }
    pub fn viewed_logs_mut(&mut self) -> Option<&mut ApplicationLogs> {
        let id = self.viewed_run()?.id;
        self.runs
            .iter_mut()
            .find(|r| r.id == id)?
            .application_logs
            .as_mut()
    }
    pub fn select(&mut self, index: usize) {
        self.selected = index.min(text::ACTIONS.len() - 1 + self.runs.len());
        self.output_focus = self.selected >= text::ACTIONS.len();
        self.reset_view();
    }
    fn reset_view(&mut self) {
        self.follow = true;
        self.scroll = 0;
        self.horizontal = 0;
        self.show_results = false;
        self.show_application = false;
    }
    pub fn event(&mut self, event: Event) {
        match event {
            Event::Followup(id) => {
                if let Some(run) = self.runs.iter_mut().find(|r| r.id == id) {
                    run.preparing = false;
                }
            }
            Event::Output(id, line) => {
                let viewed = self.viewed_run().map(|r| r.id);
                if let Some(run) = self.runs.iter_mut().find(|r| r.id == id)
                    && run.log(line)
                    && viewed == Some(id)
                    && !self.follow
                    && !self.show_results
                    && !self.show_application
                {
                    self.scroll = self.scroll.saturating_sub(1);
                }
            }
            Event::Finished(id, outcome) => {
                if let Some(run) = self.runs.iter_mut().find(|r| r.id == id) {
                    let operation = if let Task::Preparation(op) = run.task {
                        Some(op)
                    } else {
                        None
                    };
                    if let Some(op) = operation {
                        run.finish(outcome.clone());
                        self.release_finished(op, &outcome);
                    } else {
                        run.finish(outcome);
                    }
                }
                if let Some(pending) = &self.release_tests
                    && pending.run_id == Some(id)
                    && !self.quitting
                {
                    if self.dialog == Some(Dialog::Quit) {
                        self.release_tests = None;
                    } else {
                        self.dialog = Some(Dialog::ReleaseTestResults(pending.task));
                    }
                }
            }
        }
    }
    pub fn stop_all(&mut self) {
        self.quitting = true;
        self.notice = text::SHUTDOWN.into();
        for run in &mut self.runs {
            run.stop();
        }
    }
    pub async fn join(&mut self) {
        for run in &mut self.runs {
            if !run.worker.is_finished() {
                run.worker.abort();
            }
            let _ = (&mut run.worker).await;
        }
    }
    fn request_quit(&mut self) {
        if self.active() {
            self.dialog = Some(Dialog::Quit);
        } else {
            self.quitting = true;
        }
    }
    fn request_inspection(&mut self, id: Option<usize>) {
        let Some(id) = id else {
            self.notice = text::INSPECTION_NO_RUN.into();
            return;
        };
        if !inspection::available(&self.root) {
            self.notice = text::INSPECTION_PI_MISSING.into();
            return;
        }
        self.inspect_run_id = Some(id);
        self.dialog = None;
        self.stop_all();
    }
    pub fn prepare_inspection(&mut self) -> std::io::Result<Option<PathBuf>> {
        let Some(id) = self.inspect_run_id else {
            return Ok(None);
        };
        let run = self
            .runs
            .iter_mut()
            .find(|run| run.id == id)
            .ok_or_else(|| std::io::Error::other(text::INSPECTION_NO_RUN))?;
        inspection::prepare(run, &self.root, &self.branch).map(Some)
    }
    fn choose_version(&mut self, task: Task) {
        if let Some(reason) = self.conflict(task) {
            self.notice = reason.into();
            return;
        }
        match version::current(&self.root) {
            Ok(current) => {
                self.current_version = current;
                self.version_input.clear();
                self.release_app_version.clear();
                self.release.build_task = None;
                self.notice.clear();
                self.dialog = Some(Dialog::ReleaseVersion(task));
            }
            Err(_) => {
                self.notice = text::VERSION_INVALID_SOURCE.into();
                self.dialog = None;
            }
        }
    }
    fn version_key(&mut self, dialog: Dialog, key: KeyEvent) {
        match (dialog, key.code) {
            (_, KeyCode::Esc) => {
                self.dialog = None;
                self.release.build_task = None;
                self.version_input.clear();
            }
            (Dialog::ReleaseVersion(task), KeyCode::Char('c')) => {
                self.build_current_release(task);
            }
            (Dialog::ReleaseVersion(_), KeyCode::Backspace) => {
                self.version_input.pop();
                self.notice.clear();
            }
            (Dialog::ReleaseVersion(_), KeyCode::Char(c)) if c.is_ascii_digit() || c == '.' => {
                if self.version_input.len() < 64 {
                    self.version_input.push(c);
                }
            }
            (Dialog::ReleaseVersion(task), KeyCode::Enter) => {
                let valid = version::number(&self.version_input)
                    .zip(version::number(&self.current_version))
                    .is_some_and(|(next, current)| next >= current);
                if !valid {
                    self.notice = text::VERSION_INVALID.into();
                    return;
                }
                if version::current(&self.root).ok().as_deref()
                    != Some(self.current_version.as_str())
                {
                    self.notice = text::VERSION_CHANGED.into();
                    return;
                }
                self.release_app_version = self.version_input.clone();
                if self.version_input == self.current_version
                    && self
                        .root
                        .join(format!("releases/{}/release.json", self.version_input))
                        .is_file()
                {
                    self.begin_release(task);
                } else {
                    self.release.version = self.version_input.clone();
                    self.release.build_task = Some(task);
                    self.dialog = Some(Dialog::Preparation);
                    self.release_refresh();
                }
            }
            _ => {}
        }
    }
    pub(crate) fn build_current_release(&mut self, task: Task) {
        match version::current(&self.root) {
            Ok(current) => {
                self.release_app_version = current;
                self.release.build_task = None;
                self.begin_release(task);
            }
            Err(_) => self.notice = text::VERSION_INVALID_SOURCE.into(),
        }
    }
    pub(crate) fn resume_prepared_release(&mut self) {
        if self.dialog != Some(Dialog::Preparation) || self.quitting {
            return;
        }
        if let Some(task) = self.release.build_task.take() {
            if version::current(&self.root).ok().as_deref() != Some(self.release.version.as_str()) {
                self.notice = text::VERSION_CHANGED.into();
                return;
            }
            self.release_app_version = self.release.version.clone();
            self.begin_release(task);
        }
    }
    fn begin_release(&mut self, task: Task) {
        if let Some(reason) = self.conflict(task) {
            self.notice = reason.into();
            return;
        }
        self.notice.clear();
        self.release_test_summary.clear();
        self.release_tests = Some(ReleaseTests {
            task,
            run_id: None,
            version: self.release_app_version.clone(),
        });
        self.dialog = Some(Dialog::ReleaseTestPrompt(task));
    }
    fn run_release_tests(&mut self) {
        if let Some(reason) = self.conflict(Task::Full) {
            self.notice = reason.into();
            return;
        }
        let id = self.next_id;
        self.dialog = None;
        self.launch(Task::Full);
        if self
            .runs
            .iter()
            .any(|run| run.id == id && run.task == Task::Full)
            && let Some(pending) = &mut self.release_tests
        {
            pending.run_id = Some(id);
        }
    }
    pub fn release_tests_passed(&self) -> bool {
        self.release_test_run()
            .is_some_and(|run| run.status == Status::Passed)
    }
    fn release_test_run(&self) -> Option<&Run> {
        let id = self.release_tests.as_ref()?.run_id?;
        self.runs.iter().find(|run| run.id == id)
    }
    pub fn release_test_results(&self) -> String {
        let Some(run) = self.release_test_run() else {
            return text::RELEASE_TESTS_UNAVAILABLE.into();
        };
        let mut lines = vec![format!(
            "{}: {}",
            text::RELEASE_TESTS_RESULT,
            run.status.label()
        )];
        lines.push(format!(
            "{}: {}",
            text::EXIT,
            run.code.map_or_else(|| "—".into(), |code| code.to_string())
        ));
        if let Some(report) = &run.report {
            lines.extend(report.lines());
        }
        if run.report.is_none() || run.status != Status::Passed {
            lines.push(text::LOGS.into());
            lines.extend(run.logs.iter().rev().take(12).rev().cloned());
        }
        lines
            .into_iter()
            .map(|line| process::clean(line.as_bytes()))
            .collect::<Vec<_>>()
            .join("\n")
    }
    fn confirm_release_after_tests(&mut self, skipped: bool) {
        let Some(pending) = self.release_tests.take() else {
            return;
        };
        if skipped {
            self.release_test_summary = text::RELEASE_TESTS_SKIPPED.into();
        }
        self.release_app_version = pending.version;
        self.dialog = Some(Dialog::ReleaseConfirm(pending.task));
        self.notice.clear();
    }
    fn release_tests_key(&mut self, dialog: Dialog, key: KeyEvent) {
        match key.code {
            KeyCode::Char('i') if matches!(dialog, Dialog::ReleaseTestResults(_)) => {
                let id = self
                    .release_tests
                    .as_ref()
                    .and_then(|pending| pending.run_id);
                self.request_inspection(id);
            }
            KeyCode::Esc => {
                self.release_tests = None;
                self.dialog = None;
            }
            KeyCode::Char('y') if matches!(dialog, Dialog::ReleaseTestPrompt(_)) => {
                self.run_release_tests()
            }
            KeyCode::Char('r') if matches!(dialog, Dialog::ReleaseTestResults(_)) => {
                self.run_release_tests()
            }
            KeyCode::Char('s') if matches!(dialog, Dialog::ReleaseTestPrompt(_)) => {
                self.confirm_release_after_tests(true)
            }
            KeyCode::Enter
                if matches!(dialog, Dialog::ReleaseTestResults(_))
                    && self.release_tests_passed() =>
            {
                self.release_test_summary = self
                    .release_test_results()
                    .lines()
                    .next()
                    .unwrap_or(text::RELEASE_TESTS_UNAVAILABLE)
                    .into();
                self.confirm_release_after_tests(false);
            }
            KeyCode::Char('s')
                if matches!(dialog, Dialog::ReleaseTestResults(_))
                    && !self.release_tests_passed() =>
            {
                self.release_test_summary = format!(
                    "{}\n{}",
                    text::RELEASE_TESTS_OVERRIDE,
                    self.release_test_results()
                        .lines()
                        .next()
                        .unwrap_or(text::RELEASE_TESTS_UNAVAILABLE)
                );
                self.confirm_release_after_tests(false);
            }
            _ => {}
        }
    }
    fn publication_key(&mut self, dialog: Dialog, key: KeyEvent) {
        if key.code == KeyCode::Esc {
            self.dialog = None;
            self.publication_target.clear();
            return;
        }
        match dialog {
            Dialog::PublicationCandidates => match key.code {
                KeyCode::Up => self.publication_index = self.publication_index.saturating_sub(1),
                KeyCode::Down => {
                    self.publication_index = (self.publication_index + 1)
                        .min(self.publication_candidates.len().saturating_sub(1))
                }
                KeyCode::Enter if !self.publication_candidates.is_empty() => {
                    self.dialog = Some(Dialog::PublicationActions)
                }
                _ => {}
            },
            Dialog::PublicationActions => {
                let action = match key.code {
                    KeyCode::Char('1') => PublicationAction::Check,
                    KeyCode::Char('2') => PublicationAction::Stage,
                    KeyCode::Char('3') => PublicationAction::Publish,
                    KeyCode::Char('4') => PublicationAction::Inspect,
                    KeyCode::Char('5') => PublicationAction::Reconcile,
                    _ => return,
                };
                self.publication_target.clear();
                self.notice.clear();
                if action.writes_remote() {
                    let Some(candidate) = self.publication_candidates.get(self.publication_index)
                    else {
                        self.notice = text::PUBLICATION_EMPTY.into();
                        return;
                    };
                    match publication::destination(&self.root, &candidate.version) {
                        Ok(target) => {
                            self.publication_target = target;
                            self.dialog = Some(Dialog::PublicationTarget(action));
                        }
                        Err(error) => self.notice = error,
                    }
                } else {
                    self.dialog = Some(Dialog::PublicationConfirm(action));
                }
            }
            Dialog::PublicationTarget(action) if key.code == KeyCode::Enter => {
                if self
                    .publication_candidates
                    .get(self.publication_index)
                    .is_some_and(|candidate| {
                        publication::valid_confirmation(
                            &self.publication_target,
                            &candidate.version,
                        )
                    })
                {
                    self.notice.clear();
                    self.dialog = Some(Dialog::PublicationConfirm(action));
                } else {
                    self.notice = text::PUBLICATION_TARGET_INVALID.into();
                }
            }
            Dialog::PublicationConfirm(action) if key.code == KeyCode::Char('y') => {
                self.dialog = None;
                self.launch(Task::Publication(action));
            }
            _ => {}
        }
    }
    fn open_publication(&mut self) {
        self.notice.clear();
        self.publication_target.clear();
        self.publication_index = 0;
        match publication::discover(&self.root) {
            Ok(candidates) => {
                self.publication_candidates = candidates;
                self.dialog = Some(Dialog::PublicationCandidates);
            }
            Err(_) => {
                self.notice = text::PUBLICATION_METADATA_ERROR.into();
                self.dialog = None;
            }
        }
    }
    pub fn publication_description(&self) -> String {
        self.publication_candidates
            .get(self.publication_index)
            .map(Candidate::description)
            .unwrap_or_else(|| text::PUBLICATION_EMPTY.into())
    }
    pub fn key(&mut self, key: KeyEvent) {
        if self.quitting {
            return;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.request_quit();
            return;
        }
        if let Some(dialog) = self.dialog {
            if matches!(
                dialog,
                Dialog::Preparation | Dialog::PreparationInput(_) | Dialog::PreparationConfirm(_)
            ) {
                self.release_key(key, dialog);
                return;
            }
            if matches!(dialog, Dialog::ReleaseVersion(_)) {
                self.version_key(dialog, key);
                return;
            }
            if matches!(
                dialog,
                Dialog::ReleaseTestPrompt(_) | Dialog::ReleaseTestResults(_)
            ) {
                self.release_tests_key(dialog, key);
                return;
            }
            if matches!(
                dialog,
                Dialog::PublicationCandidates
                    | Dialog::PublicationActions
                    | Dialog::PublicationTarget(_)
                    | Dialog::PublicationConfirm(_)
            ) {
                self.publication_key(dialog, key);
                return;
            }
            if let Dialog::ReleaseNumber { all } = dialog {
                match key.code {
                    KeyCode::Esc => {
                        self.dialog = None;
                        self.notice.clear();
                    }
                    KeyCode::Backspace => {
                        self.release_number.pop();
                        self.notice.clear();
                    }
                    KeyCode::Char(c) if c.is_ascii_digit() => {
                        if self.release_number.len() < 5 {
                            self.release_number.push(c);
                        }
                        self.notice.clear();
                    }
                    KeyCode::Enter => {
                        if let Ok(number @ 1..=9999) = self.release_number.parse::<u16>()
                            && !self.release_number.starts_with('0')
                        {
                            self.notice.clear();
                            self.choose_version(if all {
                                Task::ReleaseAll(number)
                            } else {
                                Task::ReleaseIos(number)
                            });
                        } else {
                            self.notice = text::RELEASE_NUMBER_INVALID.into();
                        }
                    }
                    _ => {}
                }
                return;
            }
            match key.code {
                KeyCode::Esc | KeyCode::Char('n') => self.dialog = None,
                KeyCode::Char('y') if dialog == Dialog::Quit => {
                    self.dialog = None;
                    self.stop_all();
                }
                KeyCode::Char('y') if dialog == Dialog::Full => {
                    self.dialog = None;
                    self.launch(Task::Full);
                }
                KeyCode::Char('y') if matches!(dialog, Dialog::ReleaseConfirm(_)) => {
                    if let Dialog::ReleaseConfirm(task) = dialog {
                        self.dialog = None;
                        self.launch(task);
                    }
                }
                KeyCode::Char('y') => {
                    if let Dialog::Install(task) = dialog {
                        self.dialog = None;
                        self.launch_with_setup(task, true);
                    }
                }
                KeyCode::Char('1') if dialog == Dialog::Releases => {
                    self.choose_version(Task::ReleaseMacos)
                }
                KeyCode::Char('2' | '3') if dialog == Dialog::Releases => {
                    self.release_number.clear();
                    self.dialog = Some(Dialog::ReleaseNumber {
                        all: key.code == KeyCode::Char('3'),
                    });
                }
                KeyCode::Char('5') if dialog == Dialog::Releases => {
                    self.release.build_task = None;
                    self.dialog = Some(Dialog::Preparation);
                    self.release_refresh();
                }
                KeyCode::Char('4') if dialog == Dialog::Releases => self.open_publication(),
                KeyCode::Char('1') if dialog == Dialog::Tests => {
                    self.dialog = None;
                    self.launch(Task::Unit);
                }
                KeyCode::Char('2') if dialog == Dialog::Tests => {
                    self.dialog = None;
                    self.launch(Task::Quick);
                }
                KeyCode::Char('3') if dialog == Dialog::Tests => self.dialog = Some(Dialog::Full),
                KeyCode::Char('?') if dialog == Dialog::Help => self.dialog = None,
                _ => {}
            }
            return;
        }
        if self.show_application && matches!(key.code, KeyCode::Char('p' | 'l' | 'g' | 'x')) {
            if let Some(logs) = self.viewed_logs_mut() {
                match key.code {
                    KeyCode::Char('p') => logs.paused = !logs.paused,
                    KeyCode::Char('l') => logs.cycle_level(),
                    KeyCode::Char('g') => logs.cycle_category(),
                    KeyCode::Char('x') => logs.cycle_trace(),
                    _ => {}
                }
                self.scroll = 0;
            }
            return;
        }
        match key.code {
            KeyCode::Char('o') => {
                self.show_application = !self.show_application;
                self.show_results = false;
                self.scroll = 0;
                self.follow = true;
                self.output_focus = true;
            }
            KeyCode::Char('i') => self.request_inspection(self.viewed_run().map(|run| run.id)),
            KeyCode::Char('q') => self.request_quit(),
            KeyCode::Char('c') => self.launch(Task::Desktop),
            KeyCode::Char('d') => self.launch(Task::Design),
            KeyCode::Char('w') => self.launch(Task::Website),
            KeyCode::Char('r') if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.launch(Task::Requirements);
            }
            KeyCode::Char('R') => {
                self.notice.clear();
                self.dialog = Some(Dialog::Releases);
            }
            KeyCode::Char('t') => self.dialog = Some(Dialog::Tests),
            KeyCode::Char('a') => self.launch(Task::Docs),
            KeyCode::Char('?') => self.dialog = Some(Dialog::Help),
            KeyCode::Tab => self.output_focus = !self.output_focus,
            KeyCode::Enter if !self.output_focus && self.selected < text::ACTIONS.len() => {
                match self.selected {
                    0 => self.launch(Task::Desktop),
                    1 => self.dialog = Some(Dialog::Tests),
                    2 => self.launch(Task::Docs),
                    3 => self.launch(Task::Design),
                    4 => self.launch(Task::Website),
                    5 => self.launch(Task::Requirements),
                    _ => {
                        self.notice.clear();
                        self.dialog = Some(Dialog::Releases);
                    }
                }
            }
            KeyCode::Enter => self.output_focus = true,
            KeyCode::Char('s') => {
                if let Some(index) = self.controlled_run()
                    && let Some(run) = self.runs.get_mut(index)
                {
                    run.stop();
                }
            }
            KeyCode::Char('r') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                if let Some(index) = self.controlled_run()
                    && let Some(run) = self.runs.get(index)
                {
                    let task = run.task;
                    match task {
                        Task::Preparation(_) => {
                            self.dialog = Some(Dialog::Preparation);
                            self.release_refresh();
                        }
                        Task::Full => self.dialog = Some(Dialog::Full),
                        Task::Publication(_) => self.open_publication(),
                        Task::ReleaseMacos => self.choose_version(task),
                        Task::ReleaseIos(number) | Task::ReleaseAll(number) => {
                            self.notice.clear();
                            self.release_number = number.to_string();
                            self.dialog = Some(Dialog::ReleaseNumber {
                                all: matches!(task, Task::ReleaseAll(_)),
                            });
                        }
                        _ => self.launch(task),
                    }
                }
            }
            KeyCode::Char('e') => {
                self.show_application = false;
                self.show_results = !self.show_results;
                self.scroll = 0;
                self.horizontal = 0;
                self.follow = !self.show_results;
            }
            KeyCode::Up | KeyCode::Char('k') => self.move_by(-1),
            KeyCode::Down | KeyCode::Char('j') => self.move_by(1),
            KeyCode::PageUp => {
                self.follow = false;
                self.scroll = self.scroll.saturating_sub(10);
            }
            KeyCode::PageDown => {
                self.follow = false;
                self.scroll = self.scroll.saturating_add(10);
            }
            KeyCode::Home => {
                self.follow = false;
                self.scroll = 0;
            }
            KeyCode::End => self.follow = true,
            KeyCode::Left => self.horizontal = self.horizontal.saturating_sub(8),
            KeyCode::Right => self.horizontal = self.horizontal.saturating_add(8),
            _ => {}
        }
    }
    fn move_by(&mut self, delta: isize) {
        if self.output_focus {
            self.follow = false;
            self.scroll = self.scroll.saturating_add_signed(delta);
        } else {
            self.selected = self
                .selected
                .saturating_add_signed(delta)
                .min(text::ACTIONS.len() - 1 + self.runs.len());
            self.reset_view();
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) fn app() -> App {
        let (tx, _) = mpsc::channel(1);
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("client/app/src-tauri")).unwrap();
        std::fs::write(
            root.path().join("client/app/src-tauri/tauri.conf.json"),
            r#"{"version":"0.1.1"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.path().join("releases/0.1.1")).unwrap();
        std::fs::write(root.path().join("releases/0.1.1/release.json"), "{}").unwrap();
        let mut app = App::new(root.path().into(), "main".into(), tx);
        app.test_root = Some(root);
        app
    }
    fn select_current_version(app: &mut App) {
        assert!(matches!(app.dialog, Some(Dialog::ReleaseVersion(_))));
        app.version_input = "0.1.1".into();
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    }
    fn key(c: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE)
    }
    pub(crate) fn fake_run(task: Task) -> Run {
        let (stop, _) = watch::channel(false);
        Run {
            id: 0,
            task,
            status: Status::Running,
            started: Instant::now(),
            duration: None,
            code: None,
            logs: VecDeque::new(),
            discarded: 0,
            report: None,
            raw_report: vec![],
            commands: vec![],
            evidence: None,
            preparing: false,
            application_logs: None,
            stop,
            worker: tokio::spawn(async {}),
        }
    }
    #[tokio::test]
    async fn action_shortcuts_and_menu_entries_select_the_same_tasks() {
        for (index, shortcut, task) in [
            (0, 'c', Task::Desktop),
            (2, 'a', Task::Docs),
            (3, 'd', Task::Design),
            (4, 'w', Task::Website),
            (5, 'r', Task::Requirements),
        ] {
            let mut app = app();
            app.runs.push(fake_run(task));
            assert!(text::ACTIONS[index].starts_with(&format!("[{shortcut}]")));
            app.key(key(shortcut));
            assert_eq!(app.notice, text::DUPLICATE, "shortcut {shortcut}");
            assert!(app.dialog.is_none());
            app.notice.clear();
            app.select(index);
            app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            assert_eq!(app.notice, text::DUPLICATE, "action {index}");
            assert_eq!(app.runs.len(), 1);
        }
    }
    #[test]
    fn release_shortcut_uses_shift_and_old_bindings_do_not_start_tasks() {
        let mut app = app();
        for shortcut in ['b', 'm', 'v'] {
            app.key(key(shortcut));
            assert!(app.dialog.is_none());
            assert!(app.runs.is_empty());
        }
        app.key(KeyEvent::new(KeyCode::Char('R'), KeyModifiers::SHIFT));
        assert_eq!(app.dialog, Some(Dialog::Releases));
    }
    #[tokio::test]
    async fn website_is_independent_of_client_setup_and_prevents_duplicate_runs() {
        let mut app = app();
        app.runs.push(fake_run(Task::Website));
        app.key(key('w'));
        assert_eq!(app.notice, text::DUPLICATE);
        assert!(app.dialog.is_none());
        app.output_focus = false;
        app.selected = 4;
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.notice, text::DUPLICATE);
        assert!(app.conflict(Task::Docs).is_none());
        assert!(app.conflict(Task::Desktop).is_none());
        assert!(app.conflict(Task::Full).is_none());
    }
    #[tokio::test]
    async fn requirements_action_and_shortcut_prevent_duplicate_runs_without_client_setup() {
        let mut app = app();
        app.runs.push(fake_run(Task::Requirements));
        app.key(key('r'));
        assert_eq!(app.notice, text::DUPLICATE);
        assert!(app.dialog.is_none());
        app.output_focus = false;
        app.selected = 5;
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.notice, text::DUPLICATE);
        assert!(app.conflict(Task::Website).is_none());
        assert!(app.conflict(Task::Desktop).is_none());
    }
    #[test]
    fn full_suite_needs_confirmation_and_dialog_captures_shortcuts() {
        let mut app = app();
        app.key(key('t'));
        app.key(key('3'));
        assert!(app.dialog == Some(Dialog::Full));
        app.key(key('c'));
        assert!(app.runs.is_empty());
        app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.dialog.is_none());
    }
    #[test]
    fn missing_dependencies_require_confirmation_without_starting_a_process() {
        let mut app = app();
        app.key(key('c'));
        assert!(app.dialog == Some(Dialog::Install(Task::Desktop)));
        assert!(app.runs.is_empty());
        app.key(key('n'));
        assert!(app.dialog.is_none());
        assert!(app.runs.is_empty());
    }
    #[tokio::test]
    async fn installation_and_tests_cannot_overlap() {
        let mut app = app();
        app.runs.push(fake_run(Task::Quick));
        app.launch(Task::Desktop);
        assert_eq!(app.notice, text::INSTALL_TEST_CONFLICT);
        assert!(app.dialog.is_none());
        app.runs[0].task = Task::Desktop;
        app.runs[0].preparing = true;
        assert_eq!(app.conflict(Task::Unit), Some(text::TEST_INSTALL_CONFLICT));
        app.event(Event::Followup(0));
        assert!(app.conflict(Task::Unit).is_none());
    }
    #[test]
    fn design_workshop_opens_from_shortcut_and_action() {
        let mut app = app();
        app.key(key('d'));
        assert!(app.dialog == Some(Dialog::Install(Task::Design)));
        app.key(key('n'));
        app.select(3);
        assert!(!app.output_focus);
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(app.dialog == Some(Dialog::Install(Task::Design)));
        assert!(app.runs.is_empty());
    }
    #[tokio::test]
    async fn workshop_uses_a_separate_port_but_shares_setup_and_test_resources() {
        let mut app = app();
        let dir = tempfile::tempdir().unwrap();
        app.root = dir.path().into();
        let entries: Vec<String> =
            serde_json::from_str(include_str!("../client-dependencies.json")).unwrap();
        for entry in entries {
            let path = app.root.join("client/node_modules").join(entry);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "fixture").unwrap();
        }
        app.runs.push(fake_run(Task::Desktop));
        assert!(app.conflict(Task::Design).is_none());
        app.runs[0].preparing = true;
        assert_eq!(
            app.conflict(Task::Design),
            Some(text::CLIENT_INSTALL_CONFLICT)
        );
        app.runs[0].preparing = false;
        app.runs[0].task = Task::Design;
        assert!(app.conflict(Task::Desktop).is_none());
        assert_eq!(app.conflict(Task::Design), Some(text::DUPLICATE));
        assert_eq!(app.conflict(Task::Full), Some(text::FULL_CLIENT_CONFLICT));
        app.runs[0].task = Task::Full;
        assert_eq!(app.conflict(Task::Design), Some(text::TEST_CLIENT_CONFLICT));
    }
    #[test]
    fn release_menu_requires_a_valid_build_number_and_confirmation() {
        let mut app = app();
        app.select(text::ACTIONS.len() - 1);
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(app.dialog == Some(Dialog::Releases));
        app.key(key('1'));
        select_current_version(&mut app);
        assert_eq!(
            app.dialog,
            Some(Dialog::ReleaseTestPrompt(Task::ReleaseMacos))
        );
        app.key(key('s'));
        assert!(app.dialog == Some(Dialog::ReleaseConfirm(Task::ReleaseMacos)));
        app.key(key('n'));
        for (choice, all) in [('2', false), ('3', true)] {
            app.key(key('R'));
            app.key(key(choice));
            for invalid in ["", "0", "01", "10000"] {
                app.release_number = invalid.into();
                app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
                assert!(app.dialog == Some(Dialog::ReleaseNumber { all }));
                assert_eq!(app.notice, text::RELEASE_NUMBER_INVALID);
            }
            app.release_number.clear();
            app.key(key('4'));
            app.key(key('1'));
            app.key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
            app.key(key('2'));
            app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            select_current_version(&mut app);
            app.key(key('s'));
            assert!(
                app.dialog
                    == Some(Dialog::ReleaseConfirm(if all {
                        Task::ReleaseAll(42)
                    } else {
                        Task::ReleaseIos(42)
                    }))
            );
            assert!(app.runs.is_empty());
            app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
            assert!(app.dialog.is_none());
        }
    }
    #[test]
    fn publication_selection_requires_explicit_artifacts_target_and_confirmation() {
        let mut app = app();
        let dir = tempfile::tempdir().unwrap();
        app.root = dir.path().into();
        let build = dir.path().join("client/artifacts/apple-test");
        std::fs::create_dir_all(&build).unwrap();
        std::fs::write(build.join("manifest.json"), r#"{"version":"1.2.3","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"complete","distribution":"direct","artifacts":[{"platform":"macos"}]}"#).unwrap();
        app.key(key('R'));
        app.key(key('4'));
        assert_eq!(app.dialog, Some(Dialog::PublicationCandidates));
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.dialog, Some(Dialog::PublicationActions));
        app.key(key('3'));
        assert_eq!(app.dialog, Some(Dialog::PublicationActions));
        assert_eq!(app.notice, text::PUBLICATION_DESTINATION_FAILED);
        assert!(app.runs.is_empty());
        std::fs::create_dir_all(dir.path().join("infrastructure/releases")).unwrap();
        std::fs::write(
            dir.path().join("infrastructure/releases/publish.mjs"),
            r#"console.log(JSON.stringify({host: 'operator@host'}));"#,
        )
        .unwrap();
        app.key(key('3'));
        assert_eq!(
            app.dialog,
            Some(Dialog::PublicationTarget(PublicationAction::Publish))
        );
        assert_eq!(app.publication_target, "operator@host:1.2.3");
        app.key(key('x'));
        assert_eq!(app.publication_target, "operator@host:1.2.3");
        app.publication_target = "host:2.0.0".into();
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.notice, text::PUBLICATION_TARGET_INVALID);
        app.publication_target = "operator@host:1.2.3".into();
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(
            app.dialog,
            Some(Dialog::PublicationConfirm(PublicationAction::Publish))
        );
        assert!(app.runs.is_empty());
        app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.dialog.is_none());
        assert!(app.runs.is_empty());
        assert!(app.publication_target.is_empty());
    }
    #[tokio::test]
    async fn release_test_outcomes_never_start_a_release_automatically() {
        for (report, cancelled, passed) in [
            (br#"{"status":"passed","results":[{"id":"core","status":"passed","durationMs":1,"exitCode":0}]}"#.as_slice(), false, true),
            (br#"{"status":"failed","results":[{"id":"core","status":"failed","durationMs":1,"exitCode":1}]}"#.as_slice(), false, false),
            (br#"{"status":"no-tests","results":[]}"#.as_slice(), false, false),
            (b"not json".as_slice(), false, false),
            (b"".as_slice(), true, false),
        ] {
            let mut app = app();
            app.begin_release(Task::ReleaseIos(42));
            app.runs.push(fake_run(Task::Full));
            app.release_tests.as_mut().unwrap().run_id = Some(0);
            app.event(Event::Finished(0, Outcome { code: Some(0), report: report.to_vec(), cancelled, ..Outcome::default() }));
            assert_eq!(app.dialog, Some(Dialog::ReleaseTestResults(Task::ReleaseIos(42))));
            assert_eq!(app.release_tests_passed(), passed);
            assert_eq!(app.runs.len(), 1);
            app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            if !passed {
                assert_eq!(app.dialog, Some(Dialog::ReleaseTestResults(Task::ReleaseIos(42))));
                app.key(key('s'));
                assert!(app.release_test_summary.contains(text::RELEASE_TESTS_OVERRIDE));
            }
            assert_eq!(app.dialog, Some(Dialog::ReleaseConfirm(Task::ReleaseIos(42))));
            assert_eq!(app.runs.len(), 1);
        }
    }
    #[test]
    fn publication_confirmation_preserves_the_selected_artifacts_and_destination() {
        let mut app = app();
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("client/artifacts/apple-test");
        std::fs::create_dir_all(&build).unwrap();
        std::fs::write(build.join("manifest.json"), r#"{"version":"1.2.3","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"complete","distribution":"direct","artifacts":[{"platform":"macos"}]}"#).unwrap();
        app.publication_candidates = publication::discover(dir.path()).unwrap();
        app.publication_target = "host:1.2.3".into();
        app.release_test_summary = text::RELEASE_TESTS_SKIPPED.into();
        app.dialog = Some(Dialog::PublicationTarget(PublicationAction::Publish));
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(
            app.dialog,
            Some(Dialog::PublicationConfirm(PublicationAction::Publish))
        );
        assert_eq!(app.publication_candidates[0].directory, build);
        assert_eq!(app.publication_target, "host:1.2.3");
        assert!(app.release_tests.is_none());
        assert!(app.runs.is_empty());
    }
    #[tokio::test]
    async fn inspection_requires_pi_and_targets_the_release_test_run() {
        let mut app = app();
        let root = tempfile::tempdir().unwrap();
        app.root = root.path().into();
        app.runs.push(fake_run(Task::Full));
        app.key(key('i'));
        assert!(!app.quitting);
        assert_eq!(app.notice, text::INSPECTION_PI_MISSING);
        std::fs::create_dir_all(root.path().join("node_modules/.bin")).unwrap();
        std::fs::write(root.path().join("node_modules/.bin/pi"), "fixture").unwrap();
        app.runs[0].status = Status::Failed;
        app.begin_release(Task::ReleaseMacos);
        app.release_tests.as_mut().unwrap().run_id = Some(0);
        let mut other = fake_run(Task::Website);
        other.id = 1;
        app.runs.push(other);
        app.selected = text::ACTIONS.len() + 1;
        app.dialog = Some(Dialog::ReleaseTestResults(Task::ReleaseMacos));
        app.key(key('i'));
        assert!(app.quitting);
        assert_eq!(app.inspect_run_id, Some(0));
        assert_eq!(app.runs[1].status, Status::Stopping);
        assert!(app.dialog.is_none());
    }
    #[test]
    fn build_current_version_skips_preparation_without_rewriting_files() {
        for task in [Task::ReleaseMacos, Task::ReleaseIos(5), Task::ReleaseAll(5)] {
            for preparation in [false, true] {
                let mut app = app();
                let original =
                    std::fs::read(app.root.join("client/app/src-tauri/tauri.conf.json")).unwrap();
                if preparation {
                    app.dialog = Some(Dialog::Preparation);
                    app.release.build_task = Some(task);
                    app.release.error = "Preparation incomplete".into();
                    app.release.version = "0.2.0".into();
                } else {
                    app.choose_version(task);
                    app.version_input = "0.2.0".into();
                }
                app.key(key('c'));
                assert_eq!(app.dialog, Some(Dialog::ReleaseTestPrompt(task)));
                assert_eq!(app.release_app_version, "0.1.1");
                assert!(app.release.build_task.is_none());
                assert!(app.runs.is_empty());
                assert_eq!(
                    std::fs::read(app.root.join("client/app/src-tauri/tauri.conf.json")).unwrap(),
                    original
                );
            }
        }
    }

    #[tokio::test]
    async fn newer_version_requires_changelog_preparation_without_changing_version_files() {
        let mut app = app();
        app.key(key('R'));
        app.key(key('1'));
        assert_eq!(app.current_version, "0.1.1");
        assert!(app.version_input.is_empty());
        assert_eq!(app.dialog, Some(Dialog::ReleaseVersion(Task::ReleaseMacos)));
        for input in ["", "0.1", "01.2.3", "0.1.0", "1.2.3-beta"] {
            app.version_input = input.into();
            app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            assert_eq!(app.notice, text::VERSION_INVALID);
            assert!(app.runs.is_empty());
        }
        app.version_input = "0.2.0".into();
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.dialog, Some(Dialog::Preparation));
        assert_eq!(app.release.build_task, Some(Task::ReleaseMacos));
        assert_eq!(app.release.version, "0.2.0");
        assert_eq!(version::current(&app.root).unwrap(), "0.1.1");
        assert_eq!(app.runs.len(), 1);
        assert_eq!(
            app.runs[0].task,
            Task::Preparation(crate::release::Operation::Status)
        );
        app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.dialog.is_none());
        assert!(app.release.build_task.is_none());
        assert_eq!(version::current(&app.root).unwrap(), "0.1.1");
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn changed_app_version_blocks_build_and_dependency_setup() {
        let mut app = app();
        app.key(key('R'));
        app.key(key('1'));
        select_current_version(&mut app);
        app.key(key('s'));
        std::fs::write(
            app.root.join("client/app/src-tauri/tauri.conf.json"),
            r#"{"version":"0.1.2"}"#,
        )
        .unwrap();
        app.key(key('y'));
        assert_eq!(app.notice, text::VERSION_CHANGED);
        assert!(app.dialog.is_none());
        assert!(app.runs.is_empty());
    }
    #[test]
    fn release_test_prompt_can_be_cancelled_without_running_anything() {
        let mut app = app();
        app.key(key('R'));
        app.key(key('1'));
        select_current_version(&mut app);
        app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.release_tests.is_none());
        assert!(app.dialog.is_none());
        assert!(app.runs.is_empty());
    }
    #[test]
    fn publication_navigation_selects_exact_build_without_launching() {
        let mut app = app();
        let dir = tempfile::tempdir().unwrap();
        app.root = dir.path().into();
        for name in ["apple-a", "apple-b"] {
            let directory = dir.path().join("client/artifacts").join(name);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("manifest.json"), r#"{"version":"1.2.3","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"complete","distribution":"direct","artifacts":[{"platform":"macos"}]}"#).unwrap();
        }
        app.key(key('R'));
        app.key(key('4'));
        assert_eq!(app.publication_index, 0);
        assert!(app.publication_description().contains("apple-a"));
        app.key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        app.key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(app.publication_index, 1);
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(app.publication_description().contains("apple-b"));
        app.key(key('1'));
        assert_eq!(
            app.dialog,
            Some(Dialog::PublicationConfirm(PublicationAction::Check))
        );
        assert!(app.runs.is_empty());
    }
    #[test]
    fn empty_release_list_cannot_continue() {
        let mut app = app();
        app.key(key('R'));
        app.key(key('4'));
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.dialog, Some(Dialog::PublicationCandidates));
        assert!(app.runs.is_empty());
    }
    #[tokio::test]
    async fn publication_conflicts_with_builds_and_rerun_reopens_selection() {
        let mut app = app();
        let task = Task::Publication(PublicationAction::Publish);
        for other in [
            Task::Desktop,
            Task::Design,
            Task::Unit,
            Task::Full,
            Task::ReleaseMacos,
        ] {
            app.runs = vec![fake_run(other)];
            assert_eq!(app.conflict(task), Some(text::RELEASE_CONFLICT));
            app.runs[0].task = task;
            assert_eq!(app.conflict(other), Some(text::RELEASE_CONFLICT));
        }
        app.runs[0].status = Status::Failed;
        app.selected = text::ACTIONS.len();
        app.key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        assert_eq!(app.dialog, Some(Dialog::PublicationCandidates));
        assert_eq!(app.runs.len(), 1);
    }
    #[tokio::test]
    async fn cancelled_and_failed_publications_preserve_uncertainty() {
        for action in [PublicationAction::Publish, PublicationAction::Reconcile] {
            for cancelled in [true, false] {
                let mut run = fake_run(Task::Publication(action));
                run.finish(Outcome {
                    code: Some(if cancelled { 0 } else { 1 }),
                    cancelled,
                    ..Outcome::default()
                });
                assert!(
                    run.logs
                        .iter()
                        .any(|line| line == "Remote publication state may be uncertain.")
                );
            }
        }
    }
    #[test]
    fn release_confirmation_checks_host_and_dependency_setup() {
        let mut app = app();
        app.key(key('R'));
        app.key(key('1'));
        select_current_version(&mut app);
        app.key(key('s'));
        app.key(key('y'));
        if cfg!(target_os = "macos") {
            assert!(app.dialog == Some(Dialog::Install(Task::ReleaseMacos)));
        } else {
            assert_eq!(app.notice, text::RELEASE_HOST);
            assert!(app.dialog.is_none());
        }
        assert!(app.runs.is_empty());
    }
    #[tokio::test]
    async fn releases_exclude_shared_build_and_setup_work_in_both_directions() {
        let mut app = app();
        for other in [
            Task::Desktop,
            Task::Design,
            Task::Unit,
            Task::Quick,
            Task::Full,
            Task::ReleaseIos(2),
            Task::Preparation(crate::release::Operation::StartLocal),
            Task::Preparation(crate::release::Operation::Status),
        ] {
            app.runs = vec![fake_run(other)];
            assert_eq!(
                app.conflict(Task::ReleaseAll(3)),
                Some(text::RELEASE_CONFLICT)
            );
            app.runs[0].task = Task::ReleaseAll(3);
            assert_eq!(app.conflict(other), Some(text::RELEASE_CONFLICT));
        }
        assert!(app.conflict(Task::Docs).is_none());
        app.runs[0].status = Status::Failed;
        assert!(app.conflict(Task::Desktop).is_none());
        app.selected = text::ACTIONS.len();
        app.key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        assert!(app.dialog == Some(Dialog::ReleaseNumber { all: true }));
        assert_eq!(app.release_number, "3");
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        select_current_version(&mut app);
        app.key(key('s'));
        assert!(app.dialog == Some(Dialog::ReleaseConfirm(Task::ReleaseAll(3))));
        assert_eq!(app.runs.len(), 1);
    }
    #[test]
    fn scrolling_pauses_follow_and_end_restores_it() {
        let mut app = app();
        app.output_focus = true;
        app.scroll = 40;
        app.key(key('k'));
        assert!(!app.follow);
        assert_eq!(app.scroll, 39);
        app.key(KeyEvent::new(KeyCode::End, KeyModifiers::NONE));
        assert!(app.follow);
    }
    #[tokio::test]
    async fn prevents_duplicate_clients_tests_and_full_suite_resource_conflicts() {
        let mut app = app();
        app.runs.push(fake_run(Task::Desktop));
        assert_eq!(app.conflict(Task::Desktop), Some(text::DUPLICATE));
        assert_eq!(app.conflict(Task::Full), Some(text::FULL_CLIENT_CONFLICT));
        assert!(app.conflict(Task::Unit).is_none());
        app.runs[0].task = Task::Quick;
        assert_eq!(app.conflict(Task::Unit), Some(text::TEST_CONFLICT));
        app.runs[0].task = Task::Full;
        assert_eq!(
            app.conflict(Task::Desktop),
            Some(text::TEST_CLIENT_CONFLICT)
        );
    }
    #[tokio::test]
    async fn quit_confirms_and_stop_is_not_a_pass() {
        let mut app = app();
        app.runs.push(fake_run(Task::Desktop));
        app.key(key('q'));
        assert!(app.dialog == Some(Dialog::Quit));
        assert!(!app.quitting);
        app.key(key('y'));
        assert!(app.quitting);
        assert_eq!(app.runs[0].status, Status::Stopping);
        app.event(Event::Finished(
            0,
            Outcome {
                code: Some(0),
                cancelled: true,
                ..Outcome::default()
            },
        ));
        assert_eq!(app.runs[0].status, Status::Cancelled);
    }
    #[tokio::test]
    async fn bounded_logs_preserve_paused_position_when_old_lines_expire() {
        let mut app = app();
        app.runs.push(fake_run(Task::Desktop));
        app.selected = text::ACTIONS.len();
        app.follow = false;
        app.scroll = 10;
        for i in 0..=LOG_LIMIT {
            app.event(Event::Output(0, i.to_string()));
        }
        assert_eq!(app.runs[0].logs.len(), LOG_LIMIT);
        assert_eq!(app.runs[0].discarded, 1);
        assert_eq!(app.scroll, 9);
    }
    #[tokio::test]
    async fn cancelled_runs_keep_completed_suite_results() {
        let mut run = fake_run(Task::Full);
        run.finish(Outcome { cancelled: true, report: br#"{"status":"cancelled","results":[{"id":"core","status":"passed","durationMs":1,"exitCode":0}]}"#.to_vec(), ..Outcome::default() });
        assert_eq!(run.status, Status::Cancelled);
        assert_eq!(run.report.unwrap().results[0].id, "core");
    }
    #[tokio::test]
    async fn output_controls_target_the_visible_run() {
        let mut app = app();
        app.runs.push(fake_run(Task::Desktop));
        app.selected = 0;
        app.output_focus = true;
        assert_eq!(app.controlled_run(), Some(0));
        app.key(key('s'));
        assert_eq!(app.runs[0].status, Status::Stopping);
        app.runs[0].task = Task::Full;
        app.key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        assert!(app.dialog == Some(Dialog::Full));
    }
    #[tokio::test]
    async fn exit_zero_with_bad_report_fails_and_empty_selection_is_distinct() {
        let mut run = fake_run(Task::Unit);
        run.finish(Outcome {
            code: Some(0),
            ..Outcome::default()
        });
        assert_eq!(run.status, Status::Failed);
        run.finish(Outcome {
            code: Some(0),
            report: br#"{"status":"no-tests","results":[]}"#.to_vec(),
            ..Outcome::default()
        });
        assert_eq!(run.status, Status::NoTests);
    }
}
