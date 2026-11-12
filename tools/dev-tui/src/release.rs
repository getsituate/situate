use crate::{
    actions::CommandSpec,
    app::{App, Dialog},
    process,
};
use crossterm::event::{KeyCode, KeyEvent};
use serde::Deserialize;
use std::{collections::BTreeMap, path::Path};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Status,
    StartLocal,
    CompleteLocal,
}
impl Operation {
    pub fn name(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::StartLocal => "start-local",
            Self::CompleteLocal => "complete-local",
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preparation {
    pub version: String,
    pub phase: String,
    pub source_path: String,
    pub locale_paths: BTreeMap<String, String>,
    pub baseline: Option<String>,
    pub revision: Option<String>,
    pub locales: Vec<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub checkout_changes: String,
}
#[derive(Default)]
pub struct Release {
    pub saved: Option<Preparation>,
    pub version: String,
    pub baseline: String,
    pub input: String,
    pub error: String,
    pub build_task: Option<crate::actions::Task>,
}
pub fn command(root: &Path, operation: &str, version: &str) -> CommandSpec {
    let mut spec = CommandSpec::new("node", &["tools/release.mjs", operation], root);
    if !version.is_empty() {
        spec.args.extend(["--version".into(), version.into()]);
    }
    if operation == "status" {
        spec.args.push("--json".into());
        spec.report = true;
    }
    spec
}

fn sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
impl App {
    pub fn release_refresh(&mut self) {
        self.release_start(Operation::Status, vec![]);
    }
    fn release_start(&mut self, operation: Operation, extra: Vec<String>) {
        let task = crate::actions::Task::Preparation(operation);
        let mut spec = command(&self.root, operation.name(), &self.release.version);
        spec.args.extend(extra);
        if self.conflict(task).is_none() {
            self.release.saved = None;
            if operation != Operation::Status {
                self.release.error.clear();
            }
        }
        self.launch_spec(task, spec);
    }
    pub fn release_finished(&mut self, operation: Operation, outcome: &process::Outcome) {
        if operation == Operation::Status {
            self.release.saved = None;
            match serde_json::from_slice::<Preparation>(&outcome.report) {
                Ok(saved) if outcome.success() => {
                    if self.release.version.is_empty() {
                        self.release.version = saved.version.clone();
                    }
                    if let Some(error) = &saved.error {
                        self.release.error = error.clone();
                    } else if saved.phase == "ready" {
                        self.release.error.clear();
                    }
                    self.release.baseline = saved.baseline.clone().unwrap_or_default();
                    let ready = saved.phase == "ready" && saved.error.is_none();
                    let needs_baseline = saved.phase == "unprepared"
                        && saved.checkout_changes.is_empty()
                        && self.release.build_task.is_some()
                        && self.dialog == Some(Dialog::Preparation);
                    self.release.saved = Some(saved);
                    if ready {
                        self.resume_prepared_release();
                    } else if needs_baseline {
                        self.release.input.clear();
                        self.dialog = Some(Dialog::PreparationInput(true));
                    }
                }
                _ => {
                    self.release.error =
                        "Cannot read release status. Check command output and refresh.".into()
                }
            }
        } else {
            self.release.saved = None;
            self.release.error = if outcome.success() {
                String::new()
            } else {
                "Preparation incomplete. Check command output before retrying.".into()
            };
            if !self.quitting {
                self.release_refresh();
            }
        }
    }
    pub fn release_text(&self) -> String {
        if let Some(saved) = self
            .release
            .saved
            .as_ref()
            .filter(|_| self.release_blocked())
        {
            let changes = saved
                .checkout_changes
                .lines()
                .take(8)
                .collect::<Vec<_>>()
                .join("\n");
            return format!(
                "Version: {}\n\nRelease preparation requires a clean checkout. Commit or preserve your changes, then refresh (9).\n\nChanged files (up to 8):\n{changes}\n\nRun git status in this checkout for the full list.",
                saved.version
            );
        }
        let state = if let Some(s) = &self.release.saved {
            format!(
                "Version: {}\nState: {}\nBaseline: {}\nAnalysis revision: {}\nLanguages: {}\nSource: {}\n{}",
                s.version,
                s.phase,
                s.baseline.as_deref().unwrap_or("not selected"),
                s.revision.as_deref().unwrap_or("not captured"),
                s.locales.join(", "),
                s.source_path,
                s.locale_paths
                    .iter()
                    .map(|(l, p)| format!("{l}: {p}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        } else if let Some(run) =
            self.runs.iter().rev().find(|r| {
                r.status.active() && matches!(r.task, crate::actions::Task::Preparation(_))
            })
        {
            format!(
                "Version: {}\nState: {} ({})",
                self.release.version,
                run.task.name(),
                run.status.label()
            )
        } else {
            "No validated preparation status. Refresh to read saved files.".into()
        };
        if self
            .release
            .saved
            .as_ref()
            .is_some_and(|s| s.phase == "ready")
            && self.release.error.is_empty()
        {
            return format!(
                "{state}\n\nThe changelog is committed. Choose Build current version to continue to the release build options."
            );
        }
        let guidance = if self
            .release
            .saved
            .as_ref()
            .is_some_and(|s| s.phase == "unprepared")
        {
            "No changelog draft exists yet. Start the Pi agent to write the English notes."
        } else {
            "Review the draft in the Pi pane. Ask the agent to translate when ready."
        };
        format!(
            "{state}\n{}\n{guidance}\nConfirm below after reviewing all languages to commit the version and changelog together. Builds remain separate.",
            self.release.error
        )
    }
    pub fn release_blocked(&self) -> bool {
        self.release
            .saved
            .as_ref()
            .is_some_and(|s| !s.checkout_changes.is_empty())
    }
    pub fn release_key(&mut self, key: KeyEvent, dialog: Dialog) {
        if self.release_blocked()
            && matches!(
                (dialog, key.code),
                (Dialog::Preparation, KeyCode::Char('1' | '2'))
                    | (Dialog::PreparationConfirm(_), KeyCode::Char('y'))
            )
        {
            self.dialog = Some(Dialog::Preparation);
            self.notice = "Commit or preserve the listed changes, then refresh (9).".into();
            return;
        }
        match dialog {
            Dialog::Preparation => match key.code {
                KeyCode::Esc => {
                    self.release.build_task = None;
                    self.dialog = None;
                }
                KeyCode::Char('1') => {
                    self.release.input.clear();
                    self.dialog = Some(Dialog::PreparationInput(self.release.build_task.is_some()));
                }
                KeyCode::Char('2') => {
                    self.dialog = Some(Dialog::PreparationConfirm(Operation::CompleteLocal))
                }
                KeyCode::Char('c') => {
                    if let Some(task) = self.release.build_task {
                        self.build_current_release(task);
                    } else {
                        self.dialog = Some(Dialog::Releases);
                    }
                }
                KeyCode::Char('9') => self.release_refresh(),
                _ => {}
            },
            Dialog::PreparationInput(baseline) => match key.code {
                KeyCode::Esc => self.dialog = Some(Dialog::Preparation),
                KeyCode::Backspace => {
                    self.release.input.pop();
                }
                KeyCode::Char(c) if self.release.input.len() < 64 && !c.is_control() => {
                    self.release.input.push(c)
                }
                KeyCode::Enter => {
                    if baseline {
                        let input = self.release.input.trim();
                        if !input.is_empty() && !sha(input) {
                            self.notice = "Enter a full 40-character Git SHA, or leave empty to select the previous release automatically.".into();
                            return;
                        }
                        self.release.baseline = input.into();
                        self.dialog = Some(Dialog::PreparationConfirm(Operation::StartLocal));
                    } else {
                        if crate::version::number(&self.release.input).is_none() {
                            self.notice = "Enter a numeric major.minor.patch version.".into();
                            return;
                        }
                        self.release.version = self.release.input.clone();
                        self.release.input.clear();
                        self.dialog = Some(Dialog::PreparationInput(true));
                    }
                    self.notice.clear();
                }
                _ => {}
            },
            Dialog::PreparationConfirm(op) => match key.code {
                KeyCode::Esc | KeyCode::Char('n') => self.dialog = Some(Dialog::Preparation),
                KeyCode::Char('y') => {
                    let extra = if op == Operation::StartLocal && !self.release.baseline.is_empty()
                    {
                        vec!["--baseline".into(), self.release.baseline.clone()]
                    } else {
                        vec![]
                    };
                    self.dialog = Some(Dialog::Preparation);
                    self.release_start(op, extra);
                }
                _ => {}
            },
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::Outcome;

    #[test]
    fn status_restores_saved_identity_and_never_starts_work() {
        let (tx, _) = tokio::sync::mpsc::channel(8);
        let mut app = App::new("/checkout".into(), String::new(), tx);
        let json = br#"{"version":"1.2.3","phase":"ready-to-commit","sourcePath":"/checkout/source.json","localePaths":{"en":"/checkout/source.json","de":"/checkout/de.json"},"baseline":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locales":["en","de"]}"#;
        app.release_finished(
            Operation::Status,
            &Outcome {
                code: Some(0),
                report: json.to_vec(),
                ..Outcome::default()
            },
        );
        assert_eq!(app.release.version, "1.2.3");
        assert!(app.release_text().contains("State: ready-to-commit"));
        assert!(app.release_text().contains("de: /checkout/de.json"));
        assert!(
            app.release_text()
                .contains("version and changelog together")
        );
        assert!(app.runs.is_empty());
        app.release_finished(
            Operation::Status,
            &Outcome {
                code: Some(0),
                report: b"{}".to_vec(),
                ..Outcome::default()
            },
        );
        assert!(app.release.saved.is_none());
        assert!(app.release_text().contains("Cannot read release status"));
        assert!(app.runs.is_empty());
    }

    fn status_outcome(phase: &str) -> Outcome {
        Outcome {
            code: Some(0),
            report: serde_json::to_vec(&serde_json::json!({
                "version": "0.1.1", "phase": phase,
                "sourcePath": "/checkout/en.json", "localePaths": {},
                "locales": ["en", "de"]
            }))
            .unwrap(),
            ..Outcome::default()
        }
    }

    #[test]
    fn only_ready_notes_continue_to_tests_for_the_selected_build() {
        use crate::actions::Task;
        for task in [Task::ReleaseMacos, Task::ReleaseIos(5), Task::ReleaseAll(5)] {
            let mut app = crate::app::tests::app();
            app.dialog = Some(Dialog::Preparation);
            app.release.build_task = Some(task);
            for phase in [
                "draft",
                "awaiting-approval",
                "approved",
                "translated",
                "ready-to-commit",
                "stale",
            ] {
                app.release_finished(Operation::Status, &status_outcome(phase));
                assert_eq!(app.dialog, Some(Dialog::Preparation));
                assert_eq!(app.release.build_task, Some(task));
                assert!(app.runs.is_empty());
            }
            app.release_finished(Operation::Status, &status_outcome("ready"));
            assert_eq!(app.dialog, Some(Dialog::ReleaseTestPrompt(task)));
            assert!(app.release.build_task.is_none());
            assert_eq!(app.release_app_version, "0.1.1");
            assert!(app.runs.is_empty());
        }
    }

    #[test]
    fn dirty_checkout_shows_files_and_blocks_preparation_until_refreshed() {
        let mut app = crate::app::tests::app();
        app.dialog = Some(Dialog::Preparation);
        app.release.build_task = Some(crate::actions::Task::ReleaseMacos);
        let mut outcome = status_outcome("unprepared");
        let mut status: serde_json::Value = serde_json::from_slice(&outcome.report).unwrap();
        status["checkoutChanges"] = serde_json::json!(" M client/package.json\n?? scratch.txt");
        outcome.report = serde_json::to_vec(&status).unwrap();
        app.release_finished(Operation::Status, &outcome);
        assert_eq!(app.dialog, Some(Dialog::Preparation));
        assert!(app.release_blocked());
        assert!(app.release_text().contains("clean checkout"));
        assert!(app.release_text().contains(" M client/package.json"));
        assert!(app.release_text().contains("?? scratch.txt"));
        assert!(!app.release_text().contains("Start the Pi agent"));
        for (dialog, key) in [
            (Dialog::Preparation, '1'),
            (Dialog::Preparation, '2'),
            (Dialog::PreparationConfirm(Operation::StartLocal), 'y'),
            (Dialog::PreparationConfirm(Operation::CompleteLocal), 'y'),
        ] {
            app.release_key(KeyEvent::from(KeyCode::Char(key)), dialog);
            assert_eq!(app.dialog, Some(Dialog::Preparation));
            assert!(app.runs.is_empty());
        }
        app.release_finished(Operation::Status, &status_outcome("unprepared"));
        assert!(!app.release_blocked());
        assert_eq!(app.dialog, Some(Dialog::PreparationInput(true)));
        assert!(app.runs.is_empty());
    }

    #[test]
    fn unprepared_release_prompts_for_baseline_without_an_extra_start_action() {
        use crate::actions::Task;
        for task in [Task::ReleaseMacos, Task::ReleaseIos(5), Task::ReleaseAll(5)] {
            let mut app = crate::app::tests::app();
            app.dialog = Some(Dialog::Preparation);
            app.release.build_task = Some(task);
            app.release_finished(Operation::Status, &status_outcome("unprepared"));
            assert_eq!(app.dialog, Some(Dialog::PreparationInput(true)));
            assert!(app.release_text().contains("No changelog draft exists yet"));
            assert!(
                !app.release_text()
                    .contains("Review the draft in the Pi pane")
            );
            assert!(app.runs.is_empty());
            app.release.input = "a".repeat(40);
            app.release_key(KeyEvent::from(KeyCode::Enter), app.dialog.unwrap());
            assert_eq!(
                app.dialog,
                Some(Dialog::PreparationConfirm(Operation::StartLocal))
            );
            assert_eq!(app.release.baseline, "a".repeat(40));
            assert!(app.runs.is_empty());
        }
    }

    #[test]
    fn closing_preparation_cancels_the_build_continuation() {
        let mut app = crate::app::tests::app();
        app.dialog = Some(Dialog::Preparation);
        app.release.build_task = Some(crate::actions::Task::ReleaseMacos);
        app.release_key(KeyEvent::from(KeyCode::Esc), Dialog::Preparation);
        app.release_finished(Operation::Status, &status_outcome("ready"));
        assert!(app.dialog.is_none());
        assert!(app.release.build_task.is_none());
        assert!(app.runs.is_empty());
    }

    #[test]
    fn failed_completion_keeps_build_current_available_even_with_dirty_status() {
        use crate::actions::Task;
        let mut app = crate::app::tests::app();
        app.dialog = Some(Dialog::Preparation);
        app.release.build_task = Some(Task::ReleaseMacos);
        app.quitting = true;
        app.release_finished(
            Operation::CompleteLocal,
            &Outcome {
                code: Some(1),
                ..Outcome::default()
            },
        );
        app.quitting = false;
        let mut outcome = status_outcome("draft");
        let mut status: serde_json::Value = serde_json::from_slice(&outcome.report).unwrap();
        status["checkoutChanges"] = serde_json::json!("?? scratch.txt");
        outcome.report = serde_json::to_vec(&status).unwrap();
        app.release_finished(Operation::Status, &outcome);
        assert_eq!(app.release.build_task, Some(Task::ReleaseMacos));
        assert!(app.release_blocked());
        assert_eq!(app.dialog, Some(Dialog::Preparation));
        app.release_key(KeyEvent::from(KeyCode::Char('c')), Dialog::Preparation);
        assert_eq!(
            app.dialog,
            Some(Dialog::ReleaseTestPrompt(Task::ReleaseMacos))
        );
        assert!(app.runs.is_empty());
    }

    #[test]
    fn committed_completion_recovers_when_status_is_ready() {
        let mut app = crate::app::tests::app();
        app.dialog = Some(Dialog::Preparation);
        app.release.build_task = Some(crate::actions::Task::ReleaseMacos);
        app.quitting = true;
        app.release_finished(
            Operation::CompleteLocal,
            &Outcome {
                code: Some(1),
                ..Outcome::default()
            },
        );
        app.quitting = false;
        app.release_finished(Operation::Status, &status_outcome("ready"));
        assert_eq!(
            app.dialog,
            Some(Dialog::ReleaseTestPrompt(
                crate::actions::Task::ReleaseMacos
            ))
        );
        assert!(app.release.build_task.is_none());
        assert!(app.release.error.is_empty());
        assert!(app.runs.is_empty());
    }

    #[test]
    fn commands_use_local_agent_and_explicit_completion() {
        let root = Path::new("/checkout with spaces");
        let status = command(root, "status", "");
        assert_eq!(status.args, ["tools/release.mjs", "status", "--json"]);
        assert!(status.report);
        assert_eq!(status.cwd, root);
        for operation in [Operation::StartLocal, Operation::CompleteLocal] {
            let spec = command(root, operation.name(), "1.2.3");
            assert_eq!(
                spec.args,
                ["tools/release.mjs", operation.name(), "--version", "1.2.3"]
            );
            assert!(!spec.report);
        }
    }

    #[test]
    fn selecting_version_only_updates_input_until_start_is_confirmed() {
        let (tx, _) = tokio::sync::mpsc::channel(8);
        let mut app = App::new("/checkout".into(), String::new(), tx);
        app.release.input = "1.2.4".into();
        app.release_key(
            KeyEvent::from(KeyCode::Enter),
            Dialog::PreparationInput(false),
        );
        assert_eq!(app.release.version, "1.2.4");
        assert_eq!(app.dialog, Some(Dialog::PreparationInput(true)));
        app.release_key(
            KeyEvent::from(KeyCode::Enter),
            Dialog::PreparationInput(true),
        );
        assert_eq!(
            app.dialog,
            Some(Dialog::PreparationConfirm(Operation::StartLocal))
        );
        app.release_key(KeyEvent::from(KeyCode::Char('n')), app.dialog.unwrap());
        assert_eq!(app.dialog, Some(Dialog::Preparation));
        assert!(app.runs.is_empty());
    }
}
