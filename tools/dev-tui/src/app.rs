use crate::{
    actions::{Task, browser, client_dependencies_ready, prepare_client},
    application_logs::ApplicationLogs,
    inspection::{self, Evidence},
    process::{self, Event, Outcome},
    release,
    report::Report,
    text,
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
    WorkflowInput,
    WorkflowConfirm,
    HistoricalArtifacts,
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
        if matches!(self.task, Task::Workflow(action) if action.writes())
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
    pub workflow: release::Workflow,
    pub historical_artifacts: String,
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
            workflow: release::Workflow::default(),
            historical_artifacts: String::new(),
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
        if task.is_release() {
            self.notice = "Select a workflow and review its plan first.".into();
            return;
        }
        if task.is_client() && !client_dependencies_ready(&self.root) {
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
        if let Some(reason) = self.conflict(task) {
            self.notice = reason.into();
            return;
        }
        let mut spec = if install {
            prepare_client(&self.root)
        } else {
            task.command(&self.root)
        };
        let mut after_success = if install {
            Some(task.command(&self.root))
        } else {
            (task == Task::Docs).then(|| browser(&self.root))
        };
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
                    let action = match run.task {
                        Task::Workflow(action) => Some(action),
                        _ => None,
                    };
                    run.finish(outcome.clone());
                    if let Some(action) = action {
                        self.workflow_finished(id, action, &outcome);
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
    pub fn key(&mut self, key: KeyEvent) {
        if self.quitting {
            return;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.request_quit();
            return;
        }
        if let Some(dialog) = self.dialog {
            if matches!(dialog, Dialog::WorkflowInput | Dialog::WorkflowConfirm) {
                self.workflow_key(key);
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
                KeyCode::Char('y') => {
                    if let Dialog::Install(task) = dialog {
                        self.dialog = None;
                        self.launch_with_setup(task, true);
                    }
                }
                KeyCode::Char('1' | '2' | '3') if dialog == Dialog::Releases => {
                    self.open_workflow(match key.code {
                        KeyCode::Char('1') => "create",
                        KeyCode::Char('2') => "publish",
                        _ => "verify",
                    });
                }
                KeyCode::Char('4') if dialog == Dialog::Releases => {
                    self.historical_artifacts = crate::publication::discover(&self.root)
                        .map(|items| {
                            items
                                .iter()
                                .map(crate::publication::Candidate::description)
                                .collect::<Vec<_>>()
                                .join("\n\n")
                        })
                        .unwrap_or_else(|error| error.to_string());
                    if let Ok(version) = crate::version::current(&self.root) {
                        self.historical_artifacts
                            .push_str(&format!("\n\nCheckout version: {version}"));
                    }
                    self.historical_artifacts
                        .push_str(&crate::publication::drafts(&self.root));
                    self.dialog = Some(Dialog::HistoricalArtifacts);
                }
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
                        Task::Full => self.dialog = Some(Dialog::Full),
                        Task::Workflow(_) => {
                            self.workflow.plan = None;
                            self.dialog = Some(Dialog::WorkflowInput);
                            self.notice =
                                "Inspect the existing operation before continuing.".into();
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
