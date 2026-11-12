use crate::{
    app::{App, Dialog},
    process::clean,
    selection::Selection,
    text,
    theme::Theme,
};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Key(KeyCode),
    Select(usize),
    Focus(bool),
    Results(bool),
    Stop,
    Rerun,
    Follow,
    Copy,
}
#[derive(Clone, Copy)]
struct Hit {
    area: Rect,
    action: Action,
}

pub struct Ui {
    theme: Theme,
    hits: Vec<Hit>,
    list: ListState,
    list_area: Rect,
    output_area: Rect,
    dialog: Option<Dialog>,
    dialog_area: Rect,
    dialog_scroll: u16,
    dialog_max_scroll: u16,
    log_buffer: Option<ratatui::buffer::Buffer>,
    log_run: Option<usize>,
    selection: Option<Selection>,
}
impl Default for Ui {
    fn default() -> Self {
        Self::new(!std::env::var_os("NO_COLOR").is_some_and(|value| !value.is_empty()))
    }
}
impl Ui {
    pub fn new(color: bool) -> Self {
        Self {
            theme: Theme::new(color),
            hits: vec![],
            list: ListState::default(),
            list_area: Rect::default(),
            output_area: Rect::default(),
            dialog: None,
            dialog_area: Rect::default(),
            dialog_scroll: 0,
            dialog_max_scroll: 0,
            log_buffer: None,
            log_run: None,
            selection: None,
        }
    }
    fn panel<'a>(&self, title: &'a str, focused: bool) -> Block<'a> {
        Block::default()
            .borders(Borders::ALL)
            .title(title)
            .style(self.theme.surface)
            .border_style(if focused {
                self.theme.focus
            } else {
                self.theme.border
            })
            .title_style(if focused {
                self.theme.accent
            } else {
                self.theme.muted
            })
    }
    pub fn render(&mut self, frame: &mut Frame, app: &mut App) {
        self.hits.clear();
        if app.dialog.is_some()
            || app.show_results
            || self.log_run != app.viewed_run().map(|run| run.id)
        {
            self.selection = None;
        }
        self.log_run = app.viewed_run().map(|run| run.id);
        self.log_buffer = None;
        self.list_area = Rect::default();
        self.output_area = Rect::default();
        if self.dialog != app.dialog {
            self.dialog_scroll = 0;
        }
        self.dialog = app.dialog;
        let area = frame.area();
        frame.render_widget(Block::default().style(self.theme.base), area);
        let regions = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(if area.width < 76 { 5 } else { 4 }),
        ])
        .split(area);
        let checkout = app.root.file_name().unwrap_or_default().to_string_lossy();
        frame.render_widget(
            Paragraph::new(format!(
                " {}  |  {}  |  {}",
                text::TITLE,
                clean(checkout.as_bytes()),
                clean(app.branch.as_bytes())
            ))
            .style(self.theme.header),
            regions[0],
        );
        if area.width >= 76 {
            let columns =
                Layout::horizontal([Constraint::Length(29), Constraint::Min(1)]).split(regions[1]);
            self.actions(frame, app, columns[0]);
            self.output(frame, app, columns[1]);
        } else if app.output_focus {
            self.output(frame, app, regions[1]);
        } else {
            self.actions(frame, app, regions[1]);
        }
        let footer = Layout::vertical([
            Constraint::Length(if area.width < 40 { 2 } else { 1 }),
            Constraint::Min(0),
        ])
        .split(regions[2]);
        self.buttons(
            frame,
            footer[0],
            &[
                (
                    text::BUTTON_ACTIONS,
                    Action::Focus(false),
                    true,
                    !app.output_focus,
                ),
                (
                    text::BUTTON_OUTPUT,
                    Action::Focus(true),
                    true,
                    app.output_focus,
                ),
                (
                    text::BUTTON_HELP,
                    Action::Key(KeyCode::Char('?')),
                    true,
                    false,
                ),
                (
                    text::BUTTON_QUIT,
                    Action::Key(KeyCode::Char('q')),
                    true,
                    false,
                ),
            ],
        );
        frame.render_widget(
            Paragraph::new(if app.notice.is_empty() {
                text::FOOTER
            } else {
                &app.notice
            })
            .style(if app.notice.is_empty() {
                self.theme.muted
            } else {
                self.theme.accent
            })
            .wrap(Wrap { trim: false }),
            footer[1],
        );
        if let Some(dialog) = app.dialog {
            self.modal(frame, dialog, app);
        }
    }
    fn buttons(&mut self, frame: &mut Frame, area: Rect, buttons: &[(&str, Action, bool, bool)]) {
        let mut x = area.x;
        let mut y = area.y;
        for (label, action, enabled, selected) in buttons {
            let width = (Line::from(*label).width() as u16).min(area.width);
            if x.saturating_add(width) > area.right() {
                x = area.x;
                y = y.saturating_add(1);
            }
            if y >= area.bottom() || width == 0 {
                break;
            }
            let rect = Rect::new(x, y, width, 1);
            frame.render_widget(
                Paragraph::new(*label).style(if !enabled {
                    self.theme.muted
                } else if *selected {
                    self.theme.selected
                } else {
                    self.theme.button
                }),
                rect,
            );
            if *enabled {
                self.hits.push(Hit {
                    area: rect,
                    action: *action,
                });
            }
            x = x.saturating_add(width).saturating_add(1);
        }
    }
    fn actions(&mut self, frame: &mut Frame, app: &App, area: Rect) {
        self.list_area = area;
        let block = self.panel(text::ACTIONS_TITLE, !app.output_focus);
        let inner = block.inner(area);
        let mut items = text::ACTIONS
            .iter()
            .map(|name| ListItem::new(Line::styled(*name, self.theme.accent)))
            .collect::<Vec<_>>();
        items.extend(app.runs.iter().map(|run| {
            ListItem::new(vec![
                Line::from(run.task.name()),
                Line::from(vec![
                    Span::raw("  "),
                    Span::styled(run.status.label(), self.theme.status(run.status)),
                ]),
            ])
        }));
        self.list.select(Some(app.selected));
        let list = List::new(items)
            .block(block)
            .highlight_symbol("› ")
            .highlight_style(self.theme.selected);
        frame.render_stateful_widget(list, area, &mut self.list);
        let mut y = inner.y;
        for index in self.list.offset()..text::ACTIONS.len() + app.runs.len() {
            let height = (if index < text::ACTIONS.len() { 1 } else { 2 })
                .min(inner.bottom().saturating_sub(y));
            if height == 0 {
                break;
            }
            self.hits.push(Hit {
                area: Rect::new(inner.x, y, inner.width, height),
                action: Action::Select(index),
            });
            y += height;
        }
    }
    fn output(&mut self, frame: &mut Frame, app: &mut App, area: Rect) {
        self.output_area = area;
        if app.show_application {
            self.application_logs(frame, app, area);
            return;
        }
        let Some(run) = app.viewed_run() else {
            frame.render_widget(
                Paragraph::new(text::EMPTY)
                    .block(self.panel(text::OUTPUT_TITLE, app.output_focus))
                    .wrap(Wrap { trim: false }),
                area,
            );
            return;
        };
        let duration = run.duration.unwrap_or_else(|| run.started.elapsed());
        let title = format!(
            "{} · {} · {}s · {} {}",
            run.task.name(),
            run.status.label(),
            duration.as_secs(),
            text::EXIT,
            run.code.map_or_else(|| "—".into(), |code| code.to_string())
        );
        let block = self
            .panel(&title, app.output_focus)
            .title_style(self.theme.status(run.status));
        let inner = block.inner(area);
        frame.render_widget(block, area);
        let parts = Layout::vertical([
            Constraint::Length(2),
            Constraint::Length(1),
            Constraint::Min(0),
        ])
        .split(inner);
        let mut controls = vec![
            (
                text::BUTTON_INSPECT_PI,
                Action::Key(KeyCode::Char('i')),
                true,
                false,
            ),
            (text::BUTTON_STOP, Action::Stop, run.status.active(), false),
            (
                text::BUTTON_RERUN,
                Action::Rerun,
                !run.status.active(),
                false,
            ),
            (
                text::BUTTON_LOGS,
                Action::Results(false),
                true,
                !app.show_results,
            ),
            (
                text::BUTTON_RESULTS,
                Action::Results(true),
                run.task.is_test(),
                app.show_results,
            ),
            (
                text::BUTTON_FOLLOW,
                Action::Follow,
                true,
                app.follow && self.selection.is_none(),
            ),
            (
                text::APPLICATION_BUTTON,
                Action::Key(KeyCode::Char('o')),
                true,
                false,
            ),
        ];
        if self.selection.as_ref().is_some_and(|s| s.moved) {
            controls.push((text::BUTTON_COPY, Action::Copy, true, false));
        }
        self.buttons(frame, parts[0], &controls);
        let heading = if app.show_results {
            text::RESULTS.to_string()
        } else if run.discarded > 0 {
            format!("{} · {}: {}", text::LOGS, text::TRIMMED, run.discarded)
        } else {
            text::LOGS.to_string()
        };
        frame.render_widget(Paragraph::new(heading).style(self.theme.muted), parts[1]);
        let results = app.show_results.then(|| {
            run.report
                .as_ref()
                .map_or_else(|| vec![text::NO_REPORT.into()], |report| report.lines())
        });
        let count = results.as_ref().map_or(run.logs.len(), Vec::len);
        let max_scroll = count.saturating_sub(parts[2].height as usize);
        let scroll = if app.follow {
            max_scroll
        } else {
            app.scroll.min(max_scroll)
        };
        let lines: Vec<Line> = if let Some(results) = &results {
            results
                .iter()
                .skip(scroll)
                .take(parts[2].height as usize)
                .map(|s| Line::from(clean(s.as_bytes())))
                .collect()
        } else {
            run.logs
                .iter()
                .skip(scroll)
                .take(parts[2].height as usize)
                .map(|s| Line::from(s.as_str()))
                .collect()
        };
        frame.render_widget(Paragraph::new(lines).scroll((0, app.horizontal)), parts[2]);
        if self
            .selection
            .as_ref()
            .is_some_and(|s| s.buffer.area != parts[2])
        {
            self.selection = None;
        }
        if let Some(selection) = &self.selection {
            selection.paint(frame.buffer_mut(), self.theme.selected);
        } else {
            app.scroll = scroll;
        }
        if !app.show_results && parts[2].width > 0 && parts[2].height > 0 {
            let mut buffer = ratatui::buffer::Buffer::empty(parts[2]);
            for y in parts[2].y..parts[2].bottom() {
                for x in parts[2].x..parts[2].right() {
                    buffer[(x, y)] = frame.buffer_mut()[(x, y)].clone();
                }
            }
            self.log_buffer = Some(self.selection.as_ref().map_or(buffer, |s| s.buffer.clone()));
        }
    }
    fn application_logs(&mut self, frame: &mut Frame, app: &mut App, area: Rect) {
        let block = self.panel(text::APPLICATION_TITLE, app.output_focus);
        let inner = block.inner(area);
        frame.render_widget(block, area);
        let parts = Layout::vertical([
            Constraint::Length(2),
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(0),
        ])
        .split(inner);
        self.buttons(
            frame,
            parts[0],
            &[
                (
                    text::PROCESS_BUTTON,
                    Action::Key(KeyCode::Char('o')),
                    true,
                    false,
                ),
                (
                    text::PAUSE_BUTTON,
                    Action::Key(KeyCode::Char('p')),
                    true,
                    false,
                ),
                (
                    text::LEVEL_BUTTON,
                    Action::Key(KeyCode::Char('l')),
                    true,
                    false,
                ),
                (
                    text::CATEGORY_BUTTON,
                    Action::Key(KeyCode::Char('g')),
                    true,
                    false,
                ),
                (
                    text::TRACE_BUTTON,
                    Action::Key(KeyCode::Char('x')),
                    true,
                    false,
                ),
                (text::BUTTON_FOLLOW, Action::Follow, true, app.follow),
            ],
        );
        let Some(logs) = app
            .viewed_run()
            .and_then(|run| run.application_logs.as_ref())
        else {
            frame.render_widget(Paragraph::new(text::APPLICATION_NO_COLLECTOR), parts[1]);
            return;
        };
        frame.render_widget(
            Paragraph::new(if logs.paused {
                format!("{} · {}", logs.status, text::APPLICATION_PAUSED)
            } else {
                logs.status.to_string()
            }),
            parts[1],
        );
        frame.render_widget(
            Paragraph::new(text::application_session(logs.session.as_deref())),
            parts[2],
        );
        frame.render_widget(
            Paragraph::new(text::application_filters(
                logs.level_label(),
                logs.category.as_deref(),
                logs.trace.as_deref(),
            )),
            parts[3],
        );
        frame.render_widget(
            Paragraph::new(text::application_omissions(
                logs.omitted,
                logs.unsupported,
                logs.evicted,
            ))
            .style(self.theme.muted),
            parts[4],
        );
        let records = logs.visible();
        let max_scroll = records.len().saturating_sub(parts[5].height as usize);
        let scroll = if app.follow {
            max_scroll
        } else {
            app.scroll.min(max_scroll)
        };
        let lines: Vec<Line> = records
            .iter()
            .skip(scroll)
            .take(parts[5].height as usize)
            .map(|r| Line::from(r.line()))
            .collect();
        frame.render_widget(Paragraph::new(lines).scroll((0, app.horizontal)), parts[5]);
        app.scroll = scroll;
    }
    fn modal(&mut self, frame: &mut Frame, dialog: Dialog, app: &App) {
        self.hits.clear();
        let release_message = match dialog {
            Dialog::Preparation => format!("{}\n{}", app.release_text(), app.notice),
            Dialog::PreparationInput(baseline) => format!(
                "{}\n\n{}_\n{}",
                if baseline {
                    "Comparison Git SHA. Leave empty for the highest earlier version with committed release notes. The first preparation needs an explicit SHA. The analysis uses HEAD."
                } else {
                    "Product version (major.minor.patch). Version files are updated only when you confirm the reviewed changelog."
                },
                app.release.input,
                app.notice
            ),
            Dialog::PreparationConfirm(op) => format!(
                "{}\n\n{}\n\nVersion: {}\nBaseline: {}",
                match op {
                    crate::release::Operation::StartLocal => "Start Pi agent",
                    crate::release::Operation::CompleteLocal => "Changelog prepared",
                    crate::release::Operation::Status => "Refresh status",
                },
                match op {
                    crate::release::Operation::StartLocal =>
                        "Open a Herdr pane with your local Pi setup to write the draft? Review it there, then ask the agent to translate. No editor, commit or build starts.",
                    crate::release::Operation::CompleteLocal =>
                        "Have you reviewed the changelog and all translations? Validate the files and commit the new version and changelog together? No build or publication starts.",
                    _ => "Refresh saved preparation status?",
                },
                app.release.version,
                if app.release.baseline.is_empty() {
                    "automatic (committed release notes)"
                } else {
                    &app.release.baseline
                }
            ),
            Dialog::ReleaseVersion(task) => format!(
                "{}\n\n{}: {}\n{}: {}_\n\n{}\n{}",
                task.name(),
                text::VERSION_CURRENT,
                app.current_version,
                text::VERSION_NEXT,
                app.version_input,
                text::VERSION_PROMPT,
                app.notice
            ),
            Dialog::ReleaseTestPrompt(task) => format!(
                "{}\n\n{}\n{}",
                task.name(),
                text::RELEASE_TESTS_PROMPT,
                app.notice
            ),
            Dialog::ReleaseTestResults(task) => format!(
                "{}\n\n{}\n\n{}\n{}",
                task.name(),
                text::RELEASE_TESTS_REVIEW,
                app.release_test_results(),
                app.notice
            ),
            Dialog::ReleaseNumber { .. } => format!(
                "{}: {}_\n\n{}\n{}",
                text::RELEASE_NUMBER,
                app.release_number,
                text::RELEASE_NUMBER_HELP,
                app.notice
            ),
            Dialog::PublicationCandidates => format!(
                "{}\n\n{}",
                text::PUBLICATION_SELECT,
                app.publication_description()
            ),
            Dialog::PublicationActions => format!(
                "{}\n\n{}\n{}",
                app.publication_description(),
                text::PUBLICATION_LOCAL,
                app.notice
            ),
            Dialog::PublicationTarget(action) => format!(
                "{}\n\n{}\n\n{}\n{}\n{}",
                action.name(),
                app.publication_description(),
                text::PUBLICATION_TARGET,
                app.publication_target,
                app.notice
            ),
            Dialog::PublicationConfirm(action) => format!(
                "{}\n\n{}\n\n{}\n{}\n{}",
                action.name(),
                app.publication_description(),
                app.publication_target,
                if action.writes_remote() {
                    text::PUBLICATION_APPROVAL
                } else if action == crate::publication::Action::Inspect {
                    text::PUBLICATION_INSPECT_CONFIRM
                } else {
                    text::PUBLICATION_LOCAL
                },
                if action == crate::publication::Action::Reconcile {
                    text::PUBLICATION_RECOVERY
                } else {
                    ""
                }
            ),
            Dialog::ReleaseConfirm(task) => {
                let number = match task {
                    crate::actions::Task::ReleaseIos(n) | crate::actions::Task::ReleaseAll(n) => {
                        format!("\n{}: {}", text::RELEASE_NUMBER, n)
                    }
                    _ => String::new(),
                };
                let upload = if matches!(
                    task,
                    crate::actions::Task::ReleaseIos(_) | crate::actions::Task::ReleaseAll(_)
                ) {
                    format!("\n{}", text::RELEASE_UPLOAD_CONFIRM)
                } else {
                    String::new()
                };
                format!(
                    "{}{}\n{}: {}\n\n{}{}\n{}",
                    task.name(),
                    number,
                    text::VERSION_NEXT,
                    app.release_app_version,
                    text::RELEASE_CONFIRM,
                    upload,
                    app.release_test_summary
                )
            }
            _ => String::new(),
        };
        let (title, message) = match dialog {
            Dialog::Install(task) => (
                text::INSTALL_TITLE,
                if task.is_apple_release() {
                    text::INSTALL_RELEASE_CONFIRM
                } else {
                    text::INSTALL_CONFIRM
                },
            ),
            Dialog::Preparation | Dialog::PreparationInput(_) | Dialog::PreparationConfirm(_) => {
                ("Release preparation", release_message.as_str())
            }
            Dialog::Releases => (text::RELEASES, text::RELEASE_MENU),
            Dialog::ReleaseNumber { .. }
            | Dialog::ReleaseConfirm(_)
            | Dialog::ReleaseVersion(_)
            | Dialog::ReleaseTestPrompt(_)
            | Dialog::ReleaseTestResults(_)
            | Dialog::PublicationCandidates
            | Dialog::PublicationActions
            | Dialog::PublicationTarget(_)
            | Dialog::PublicationConfirm(_) => (text::RELEASES, release_message.as_str()),
            Dialog::Tests => (text::TESTS, text::TEST_MENU),
            Dialog::Full => (text::CONFIRM, text::FULL_CONFIRM),
            Dialog::Quit => (text::CONFIRM, text::QUIT_CONFIRM),
            Dialog::Help => (text::HELP_TITLE, text::HELP),
        };
        let area = frame.area();
        let width = area.width.min(74);
        let height = area.height.min(
            if matches!(
                dialog,
                Dialog::Preparation | Dialog::PreparationInput(_) | Dialog::PreparationConfirm(_)
            ) {
                34
            } else if matches!(
                dialog,
                Dialog::ReleaseVersion(_)
                    | Dialog::ReleaseTestPrompt(_)
                    | Dialog::ReleaseTestResults(_)
                    | Dialog::PublicationCandidates
                    | Dialog::PublicationActions
                    | Dialog::PublicationTarget(_)
                    | Dialog::PublicationConfirm(_)
            ) {
                30
            } else if dialog == Dialog::Help {
                24
            } else if matches!(
                dialog,
                Dialog::Releases | Dialog::ReleaseConfirm(_) | Dialog::ReleaseNumber { .. }
            ) {
                16
            } else {
                12
            },
        );
        let rect = Rect::new(
            area.x + (area.width - width) / 2,
            area.y + (area.height - height) / 2,
            width,
            height,
        );
        self.dialog_area = rect;
        let block = self.panel(title, true);
        let inner = block.inner(rect);
        frame.render_widget(Clear, rect);
        frame.render_widget(block, rect);
        let choices: Vec<(&str, KeyCode)> = match dialog {
            Dialog::Preparation if app.release_blocked() => vec![
                (text::VERSION_BUILD_CURRENT, KeyCode::Char('c')),
                ("9 Refresh", KeyCode::Char('9')),
                (text::BUTTON_CLOSE, KeyCode::Esc),
            ],
            Dialog::Preparation => vec![
                ("1 Start Pi agent", KeyCode::Char('1')),
                ("2 Changelog prepared", KeyCode::Char('2')),
                (text::VERSION_BUILD_CURRENT, KeyCode::Char('c')),
                ("9 Refresh", KeyCode::Char('9')),
                (text::BUTTON_CLOSE, KeyCode::Esc),
            ],
            Dialog::PreparationConfirm(crate::release::Operation::CompleteLocal) => vec![
                ("y Confirm and commit", KeyCode::Char('y')),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::PreparationInput(_) => vec![
                (text::BUTTON_CONTINUE, KeyCode::Enter),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::PreparationConfirm(crate::release::Operation::StartLocal) => vec![
                (text::BUTTON_RUN, KeyCode::Char('y')),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::ReleaseVersion(_) => vec![
                (text::VERSION_BUILD_CURRENT, KeyCode::Char('c')),
                (text::BUTTON_CONTINUE, KeyCode::Enter),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::ReleaseTestPrompt(_) => vec![
                (text::RELEASE_TESTS_RUN, KeyCode::Char('y')),
                (text::RELEASE_TESTS_SKIP, KeyCode::Char('s')),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::ReleaseTestResults(_) => vec![
                (text::BUTTON_INSPECT_PI, KeyCode::Char('i')),
                if app.release_tests_passed() {
                    (text::BUTTON_CONTINUE, KeyCode::Enter)
                } else {
                    (text::RELEASE_TESTS_OVERRIDE_BUTTON, KeyCode::Char('s'))
                },
                (text::RELEASE_TESTS_RETRY, KeyCode::Char('r')),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::Tests => vec![
                (text::TEST_OPTIONS[0], KeyCode::Char('1')),
                (text::TEST_OPTIONS[1], KeyCode::Char('2')),
                (text::TEST_OPTIONS[2], KeyCode::Char('3')),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::Releases => vec![
                (text::RELEASE_OPTIONS[0], KeyCode::Char('1')),
                (text::RELEASE_OPTIONS[1], KeyCode::Char('2')),
                (text::RELEASE_OPTIONS[2], KeyCode::Char('3')),
                (text::RELEASE_OPTIONS[3], KeyCode::Char('4')),
                ("5 Prepare release notes", KeyCode::Char('5')),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::PublicationCandidates => vec![
                (text::PUBLICATION_PREVIOUS, KeyCode::Up),
                (text::PUBLICATION_NEXT, KeyCode::Down),
                (text::BUTTON_CONTINUE, KeyCode::Enter),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::PublicationActions => vec![
                (text::PUBLICATION_OPTIONS[0], KeyCode::Char('1')),
                (text::PUBLICATION_OPTIONS[1], KeyCode::Char('2')),
                (text::PUBLICATION_OPTIONS[2], KeyCode::Char('3')),
                (text::PUBLICATION_OPTIONS[3], KeyCode::Char('4')),
                (text::PUBLICATION_OPTIONS[4], KeyCode::Char('5')),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::PublicationTarget(_) | Dialog::ReleaseNumber { .. } => vec![
                (text::BUTTON_CONTINUE, KeyCode::Enter),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
            Dialog::Help => vec![(text::BUTTON_CLOSE, KeyCode::Esc)],
            _ => vec![
                (
                    match dialog {
                        Dialog::Install(_) => text::BUTTON_INSTALL,
                        Dialog::Quit => text::BUTTON_STOP_QUIT,
                        _ => text::BUTTON_RUN,
                    },
                    KeyCode::Char('y'),
                ),
                (text::BUTTON_CANCEL, KeyCode::Esc),
            ],
        };
        let parts =
            Layout::vertical([Constraint::Min(0), Constraint::Length(choices.len() as u16)])
                .split(inner);
        let paragraph = Paragraph::new(message).wrap(Wrap { trim: false });
        self.dialog_max_scroll = paragraph
            .line_count(parts[0].width)
            .saturating_sub(parts[0].height as usize)
            .min(u16::MAX as usize) as u16;
        self.dialog_scroll = self.dialog_scroll.min(self.dialog_max_scroll);
        frame.render_widget(paragraph.scroll((self.dialog_scroll, 0)), parts[0]);
        for (index, (label, key)) in choices.iter().enumerate().take(parts[1].height as usize) {
            self.buttons(
                frame,
                Rect::new(parts[1].x, parts[1].y + index as u16, parts[1].width, 1),
                &[(*label, Action::Key(*key), true, false)],
            );
        }
    }
    fn copy_selection(&self, app: &mut App) {
        if let Some(selection) = &self.selection
            && selection.moved
        {
            app.notice = if crate::selection::copy(&selection.text()).is_ok() {
                text::COPIED
            } else {
                text::COPY_FAILED
            }
            .into();
        }
    }
    pub fn key(&mut self, key: KeyEvent, app: &mut App) {
        if self.selection.is_some() && app.dialog.is_none() {
            if key.code == KeyCode::Char('c')
                && (key.modifiers.contains(KeyModifiers::SUPER)
                    || key
                        .modifiers
                        .contains(KeyModifiers::CONTROL | KeyModifiers::SHIFT))
            {
                self.copy_selection(app);
                return;
            }
            self.selection = None;
            if key.code == KeyCode::Esc {
                return;
            }
        }
        if app.dialog.is_some() && matches!(key.code, KeyCode::PageUp | KeyCode::PageDown) {
            self.scroll_dialog(if key.code == KeyCode::PageUp { -5 } else { 5 });
        } else {
            app.key(key);
        }
    }
    fn scroll_dialog(&mut self, delta: i16) {
        self.dialog_scroll = self
            .dialog_scroll
            .saturating_add_signed(delta)
            .min(self.dialog_max_scroll);
    }
    pub fn mouse(&mut self, mouse: MouseEvent, app: &mut App) -> bool {
        if app.quitting || self.dialog != app.dialog {
            return false;
        }
        let position = (mouse.column, mouse.row).into();
        if app.dialog.is_none() {
            if let Some(selection) = &mut self.selection
                && selection.dragging
                && matches!(
                    mouse.kind,
                    MouseEventKind::Drag(MouseButton::Left) | MouseEventKind::Up(MouseButton::Left)
                )
            {
                selection.extend(mouse.column, mouse.row);
                if mouse.kind == MouseEventKind::Up(MouseButton::Left) {
                    selection.dragging = false;
                    if !selection.moved {
                        self.selection = None;
                    }
                }
                return true;
            }
            if mouse.kind == MouseEventKind::Down(MouseButton::Left) {
                if self
                    .hits
                    .iter()
                    .any(|hit| hit.action == Action::Copy && hit.area.contains(position))
                {
                    self.copy_selection(app);
                    return true;
                }
                self.selection = None;
                if let Some(buffer) = &self.log_buffer
                    && buffer.area.contains(position)
                {
                    self.selection = Some(Selection::new(buffer.clone(), mouse.column, mouse.row));
                    app.output_focus = true;
                    return true;
                }
            }
            if matches!(
                mouse.kind,
                MouseEventKind::ScrollUp
                    | MouseEventKind::ScrollDown
                    | MouseEventKind::ScrollLeft
                    | MouseEventKind::ScrollRight
            ) {
                self.selection = None;
            }
        }
        if mouse.kind == MouseEventKind::Down(MouseButton::Left) {
            if let Some(hit) = self.hits.iter().find(|hit| hit.area.contains(position)) {
                match hit.action {
                    Action::Copy => self.copy_selection(app),
                    Action::Key(code) => app.key(KeyEvent::new(code, KeyModifiers::NONE)),
                    Action::Select(index) => {
                        app.select(index);
                        if index < text::ACTIONS.len() {
                            app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
                        }
                    }
                    Action::Focus(output) => app.output_focus = output,
                    Action::Results(results) => {
                        app.show_application = false;
                        app.output_focus = true;
                        if results != app.show_results {
                            app.key(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::NONE));
                        }
                    }
                    Action::Stop | Action::Rerun => {
                        app.output_focus = true;
                        app.key(KeyEvent::new(
                            KeyCode::Char(if hit.action == Action::Stop { 's' } else { 'r' }),
                            if hit.action == Action::Rerun {
                                KeyModifiers::CONTROL
                            } else {
                                KeyModifiers::NONE
                            },
                        ));
                    }
                    Action::Follow => {
                        app.output_focus = true;
                        app.follow = true;
                    }
                }
                return true;
            }
            if app.dialog.is_none() {
                if self.output_area.contains(position) {
                    app.output_focus = true;
                    return true;
                }
                if self.list_area.contains(position) {
                    app.output_focus = false;
                    return true;
                }
            }
        }
        if app.dialog.is_none()
            && self.output_area.contains(position)
            && matches!(
                mouse.kind,
                MouseEventKind::ScrollLeft | MouseEventKind::ScrollRight
            )
        {
            app.output_focus = true;
            app.key(KeyEvent::new(
                if mouse.kind == MouseEventKind::ScrollLeft {
                    KeyCode::Left
                } else {
                    KeyCode::Right
                },
                KeyModifiers::NONE,
            ));
            return true;
        }
        let delta = match mouse.kind {
            MouseEventKind::ScrollUp => -3,
            MouseEventKind::ScrollDown => 3,
            _ => return false,
        };
        if app.dialog.is_some() {
            if self.dialog_area.contains(position) {
                self.scroll_dialog(delta);
                return true;
            }
            return false;
        }
        if self.output_area.contains(position) {
            app.output_focus = true;
        } else if self.list_area.contains(position) {
            app.output_focus = false;
        } else {
            return false;
        }
        for _ in 0..3 {
            app.key(KeyEvent::new(
                if delta < 0 {
                    KeyCode::Up
                } else {
                    KeyCode::Down
                },
                KeyModifiers::NONE,
            ));
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};
    fn app() -> App {
        let mut app = crate::app::tests::app();
        app.branch = "feature".into();
        app
    }
    fn draw(width: u16, height: u16, focus: bool, dialog: Option<Dialog>) -> String {
        let mut app = app();
        app.output_focus = focus;
        app.dialog = dialog;
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        let mut ui = Ui::new(true);
        terminal.draw(|f| ui.render(f, &mut app)).unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
    }
    fn paint(ui: &mut Ui, app: &mut App, width: u16, height: u16) -> ratatui::buffer::Buffer {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|f| ui.render(f, app)).unwrap();
        terminal.backend().buffer().clone()
    }
    fn mouse(kind: MouseEventKind, column: u16, row: u16) -> MouseEvent {
        MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        }
    }
    fn click(ui: &mut Ui, app: &mut App, action: Action) {
        let area = ui
            .hits
            .iter()
            .find(|hit| hit.action == action)
            .expect("visible control")
            .area;
        assert!(ui.mouse(
            mouse(MouseEventKind::Down(MouseButton::Left), area.x, area.y),
            app
        ));
    }
    #[test]
    fn workshop_action_can_be_clicked() {
        let mut app = app();
        let mut ui = Ui::new(true);
        let buffer = paint(&mut ui, &mut app, 100, 30);
        assert!(
            buffer
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>()
                .contains("[d] Design workshop")
        );
        click(&mut ui, &mut app, Action::Select(3));
        assert!(app.dialog == Some(Dialog::Install(crate::actions::Task::Design)));
        assert!(app.runs.is_empty());
    }
    #[test]
    fn release_controls_show_platforms_number_errors_and_confirmation() {
        let mut app = app();
        let mut ui = Ui::new(true);
        paint(&mut ui, &mut app, 100, 30);
        click(&mut ui, &mut app, Action::Select(text::ACTIONS.len() - 1));
        assert!(app.dialog == Some(Dialog::Releases));
        paint(&mut ui, &mut app, 100, 30);
        click(&mut ui, &mut app, Action::Key(KeyCode::Char('3')));
        paint(&mut ui, &mut app, 100, 30);
        click(&mut ui, &mut app, Action::Key(KeyCode::Enter));
        let buffer = paint(&mut ui, &mut app, 100, 30);
        let screen = buffer
            .content
            .iter()
            .map(|c| c.symbol())
            .collect::<String>();
        assert!(screen.contains("Enter a build number from 1 to 9999"));
        app.key(KeyEvent::new(KeyCode::Char('2'), KeyModifiers::NONE));
        click(&mut ui, &mut app, Action::Key(KeyCode::Enter));
        paint(&mut ui, &mut app, 100, 30);
        app.version_input = "0.1.1".into();
        click(&mut ui, &mut app, Action::Key(KeyCode::Enter));
        paint(&mut ui, &mut app, 100, 30);
        click(&mut ui, &mut app, Action::Key(KeyCode::Char('s')));
        let buffer = paint(&mut ui, &mut app, 100, 30);
        let screen = buffer
            .content
            .iter()
            .map(|c| c.symbol())
            .collect::<String>();
        assert!(screen.contains("Release · macOS + iOS"));
        assert!(screen.contains("iOS build number (1–9999): 2"));
        assert!(screen.contains("The new iOS build will be uploaded to TestFlight."));
        assert!(screen.contains("No public App Store release will be submitted."));
        click(&mut ui, &mut app, Action::Key(KeyCode::Esc));
        assert!(app.runs.is_empty());
    }
    #[test]
    fn publication_menu_and_confirmation_show_artifacts_and_effects() {
        let mut app = app();
        let mut ui = Ui::new(true);
        app.dialog = Some(Dialog::Releases);
        paint(&mut ui, &mut app, 100, 30);
        click(&mut ui, &mut app, Action::Key(KeyCode::Char('4')));
        assert_eq!(app.dialog, Some(Dialog::PublicationCandidates));
        let buffer = paint(&mut ui, &mut app, 100, 30);
        let screen = buffer
            .content
            .iter()
            .map(|c| c.symbol())
            .collect::<String>();
        assert!(screen.contains("No readable Apple release manifests"));
        assert!(!screen.contains("Deploy landing page"));
        app.publication_target = "operator@host:1.2.3".into();
        app.dialog = Some(Dialog::PublicationConfirm(
            crate::publication::Action::Publish,
        ));
        let buffer = paint(&mut ui, &mut app, 100, 30);
        let screen = buffer
            .content
            .iter()
            .map(|c| c.symbol())
            .collect::<String>();
        assert!(screen.contains("operator@host:1.2.3"));
        assert!(screen.contains("exact-artifact native update"));
        assert!(screen.contains("No automatic retry or rollback."));
        assert!(app.runs.is_empty());
    }
    #[test]
    fn dialogs_block_underlying_controls_and_stale_hit_regions() {
        let mut app = app();
        let mut ui = Ui::new(true);
        paint(&mut ui, &mut app, 100, 30);
        click(&mut ui, &mut app, Action::Select(1));
        assert!(app.dialog == Some(Dialog::Tests));
        assert!(!ui.mouse(
            mouse(MouseEventKind::Down(MouseButton::Left), 2, 2),
            &mut app
        ));
        paint(&mut ui, &mut app, 100, 30);
        assert!(!ui.mouse(
            mouse(MouseEventKind::Down(MouseButton::Left), 2, 2),
            &mut app
        ));
        click(&mut ui, &mut app, Action::Key(KeyCode::Char('3')));
        assert!(app.dialog == Some(Dialog::Full));
        assert!(app.runs.is_empty());
        paint(&mut ui, &mut app, 100, 30);
        click(&mut ui, &mut app, Action::Key(KeyCode::Esc));
        assert!(app.dialog.is_none());
    }
    #[test]
    fn narrow_views_and_resize_rebuild_click_targets() {
        let mut app = app();
        let mut ui = Ui::new(true);
        paint(&mut ui, &mut app, 100, 30);
        paint(&mut ui, &mut app, 45, 20);
        assert!(!ui.mouse(
            mouse(MouseEventKind::Down(MouseButton::Left), 99, 28),
            &mut app
        ));
        click(&mut ui, &mut app, Action::Focus(true));
        paint(&mut ui, &mut app, 45, 20);
        assert!(app.output_focus);
        assert!(
            !ui.hits
                .iter()
                .any(|hit| matches!(hit.action, Action::Select(_)))
        );
        click(&mut ui, &mut app, Action::Focus(false));
        paint(&mut ui, &mut app, 45, 20);
        assert!(ui.hits.iter().any(|hit| hit.action == Action::Select(0)));
    }
    #[test]
    fn wheel_and_page_keys_scroll_dialog_text_without_starting_actions() {
        let mut app = app();
        app.dialog = Some(Dialog::Help);
        let mut ui = Ui::new(true);
        paint(&mut ui, &mut app, 40, 12);
        assert!(ui.dialog_max_scroll > 0);
        for _ in 0..100 {
            ui.mouse(mouse(MouseEventKind::ScrollDown, 2, 2), &mut app);
        }
        assert_eq!(ui.dialog_scroll, ui.dialog_max_scroll);
        let buffer = paint(&mut ui, &mut app, 40, 12);
        assert!(
            buffer
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>()
                .contains("expire")
        );
        ui.key(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE), &mut app);
        assert!(ui.dialog_scroll < ui.dialog_max_scroll);
        assert!(app.runs.is_empty());
    }
    #[test]
    fn wheel_selects_actions_without_executing_them_and_other_buttons_are_ignored() {
        let mut app = app();
        let mut ui = Ui::new(false);
        paint(&mut ui, &mut app, 100, 30);
        ui.mouse(mouse(MouseEventKind::ScrollDown, 2, 2), &mut app);
        assert_eq!(app.selected, 3);
        assert!(app.runs.is_empty());
        assert!(app.dialog.is_none());
        for kind in [
            MouseEventKind::Moved,
            MouseEventKind::Up(MouseButton::Left),
            MouseEventKind::Down(MouseButton::Right),
        ] {
            assert!(!ui.mouse(mouse(kind, 2, 2), &mut app));
        }
    }
    #[tokio::test]
    async fn clicks_use_the_visible_scrolled_run_rows_including_the_status_line() {
        use crate::{
            actions::Task,
            app::{Status, tests::fake_run},
        };
        let mut app = app();
        for index in 0..20 {
            let mut run = fake_run(Task::Docs);
            run.status = Status::Passed;
            run.logs.push_back(format!("run-{index}"));
            app.runs.push(run);
        }
        app.select(23);
        let mut ui = Ui::new(true);
        paint(&mut ui, &mut app, 100, 15);
        let index = ui.list.offset();
        assert!(index >= text::ACTIONS.len());
        let area = ui
            .hits
            .iter()
            .find(|hit| hit.action == Action::Select(index))
            .unwrap()
            .area;
        assert_eq!(area.height, 2);
        ui.mouse(
            mouse(MouseEventKind::Down(MouseButton::Left), area.x, area.y + 1),
            &mut app,
        );
        assert_eq!(app.selected, index);
        let buffer = paint(&mut ui, &mut app, 100, 15);
        assert!(
            buffer
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>()
                .contains(&format!("run-{}", index - text::ACTIONS.len()))
        );
        app.select(0);
        paint(&mut ui, &mut app, 100, 15);
        assert_eq!(ui.list.offset(), 0);
    }
    #[tokio::test]
    async fn log_wheel_pauses_follow_until_the_follow_button_is_clicked() {
        use crate::{actions::Task, app::tests::fake_run};
        let mut app = app();
        let mut run = fake_run(Task::Desktop);
        run.logs.extend((0..100).map(|i| format!("line-{i}")));
        app.runs.push(run);
        app.select(text::ACTIONS.len());
        let mut ui = Ui::new(true);
        paint(&mut ui, &mut app, 100, 30);
        let tail = app.scroll;
        ui.mouse(mouse(MouseEventKind::ScrollRight, 40, 10), &mut app);
        assert_eq!(app.horizontal, 8);
        ui.mouse(mouse(MouseEventKind::ScrollLeft, 40, 10), &mut app);
        assert_eq!(app.horizontal, 0);
        ui.mouse(mouse(MouseEventKind::ScrollUp, 40, 10), &mut app);
        assert!(!app.follow);
        assert_eq!(app.scroll, tail - 3);
        app.runs[0].logs.push_back("new output".into());
        paint(&mut ui, &mut app, 100, 30);
        assert_eq!(app.scroll, tail - 3);
        click(&mut ui, &mut app, Action::Follow);
        paint(&mut ui, &mut app, 100, 30);
        assert!(app.follow);
        assert_eq!(app.scroll, tail + 1);
        click(&mut ui, &mut app, Action::Stop);
        assert_eq!(app.runs[0].status, crate::app::Status::Stopping);
    }
    #[tokio::test]
    async fn dragging_selects_only_logs_and_freezes_the_view_while_output_continues() {
        use crate::{actions::Task, app::tests::fake_run, process::Event};
        let mut app = app();
        let mut run = fake_run(Task::Desktop);
        run.logs.extend(["first line".into(), "second line".into()]);
        let id = run.id;
        app.runs.push(run);
        let mut ui = Ui::new(false);
        paint(&mut ui, &mut app, 100, 30);
        assert!(!ui.hits.iter().any(|h| h.action == Action::Copy));
        let area = ui.log_buffer.as_ref().unwrap().area;
        ui.mouse(
            mouse(MouseEventKind::Down(MouseButton::Left), area.x + 6, area.y),
            &mut app,
        );
        ui.mouse(
            mouse(
                MouseEventKind::Drag(MouseButton::Left),
                area.x + 5,
                area.y + 1,
            ),
            &mut app,
        );
        ui.mouse(
            mouse(
                MouseEventKind::Up(MouseButton::Left),
                area.x + 5,
                area.y + 1,
            ),
            &mut app,
        );
        assert_eq!(ui.selection.as_ref().unwrap().text(), "line\nsecond");
        let before = paint(&mut ui, &mut app, 100, 30);
        assert!(
            before[(area.x + 6, area.y)]
                .modifier
                .contains(ratatui::style::Modifier::REVERSED)
        );
        assert!(
            !before[(area.x, area.y)]
                .modifier
                .contains(ratatui::style::Modifier::REVERSED)
        );
        assert!(ui.hits.iter().any(|h| h.action == Action::Copy));
        for i in 0..crate::app::LOG_LIMIT + 5 {
            app.event(Event::Output(id, format!("new-{i}")));
        }
        assert!(app.runs[0].discarded > 0);
        let after = paint(&mut ui, &mut app, 100, 30);
        assert_eq!(
            before[(area.x, area.y)].symbol(),
            after[(area.x, area.y)].symbol()
        );
        assert_eq!(ui.selection.as_ref().unwrap().text(), "line\nsecond");
        assert!(app.follow);
        ui.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE), &mut app);
        let resumed = paint(&mut ui, &mut app, 100, 30);
        assert!(ui.selection.is_none());
        assert!(
            resumed
                .content
                .iter()
                .map(|c| c.symbol())
                .collect::<String>()
                .contains("new-3004")
        );
        assert!(!ui.hits.iter().any(|h| h.action == Action::Copy));
    }
    #[tokio::test]
    async fn selection_uses_horizontal_view_and_clears_on_click_resize_and_results() {
        use crate::{actions::Task, app::tests::fake_run};
        let mut app = app();
        let mut run = fake_run(Task::Desktop);
        run.logs.push_back("0123456789abcdef".into());
        app.runs.push(run);
        app.horizontal = 8;
        let mut ui = Ui::new(true);
        paint(&mut ui, &mut app, 100, 30);
        let area = ui.log_buffer.as_ref().unwrap().area;
        for clear in 0..4 {
            ui.mouse(
                mouse(MouseEventKind::Down(MouseButton::Left), area.x, area.y),
                &mut app,
            );
            ui.mouse(
                mouse(MouseEventKind::Drag(MouseButton::Left), area.x + 2, area.y),
                &mut app,
            );
            ui.mouse(
                mouse(MouseEventKind::Up(MouseButton::Left), area.x + 2, area.y),
                &mut app,
            );
            assert_eq!(ui.selection.as_ref().unwrap().text(), "89a");
            match clear {
                0 => {
                    ui.mouse(
                        mouse(MouseEventKind::Down(MouseButton::Left), area.x, area.y),
                        &mut app,
                    );
                    ui.mouse(
                        mouse(MouseEventKind::Up(MouseButton::Left), area.x, area.y),
                        &mut app,
                    );
                }
                1 => {
                    paint(&mut ui, &mut app, 90, 30);
                }
                2 => {
                    app.show_results = true;
                    paint(&mut ui, &mut app, 100, 30);
                }
                _ => {
                    app.dialog = Some(Dialog::Help);
                    paint(&mut ui, &mut app, 100, 30);
                }
            }
            assert!(ui.selection.is_none());
            app.show_results = false;
            app.dialog = None;
            paint(&mut ui, &mut app, 100, 30);
        }
        ui.mouse(
            mouse(MouseEventKind::Down(MouseButton::Left), 2, 1),
            &mut app,
        );
        ui.mouse(
            mouse(MouseEventKind::Drag(MouseButton::Left), area.x, area.y),
            &mut app,
        );
        assert!(ui.selection.is_none());
    }
    #[test]
    fn wide_terminal_shows_actions_and_output() {
        let screen = draw(100, 30, false, None);
        assert!(
            screen.contains("Desktop client")
                && screen.contains("Choose an action")
                && screen.contains("feature")
        );
    }
    #[test]
    fn narrow_terminal_switches_with_focus() {
        assert!(draw(45, 22, false, None).contains("Desktop client"));
        let output = draw(45, 22, true, None);
        assert!(output.contains("Choose an action"));
        assert!(!output.contains("Desktop client"));
    }
    #[test]
    fn dialogs_and_tiny_terminals_render_without_panicking() {
        assert!(draw(100, 30, false, Some(Dialog::Quit)).contains("Stop all tasks"));
        assert!(draw(100, 30, false, Some(Dialog::Tests)).contains("Changed unit tests"));
        for size in [(1, 1), (20, 6), (40, 12)] {
            for dialog in [
                None,
                Some(Dialog::Help),
                Some(Dialog::Full),
                Some(Dialog::Releases),
                Some(Dialog::ReleaseTestPrompt(
                    crate::actions::Task::ReleaseMacos,
                )),
                Some(Dialog::ReleaseTestResults(
                    crate::actions::Task::ReleaseMacos,
                )),
                Some(Dialog::ReleaseVersion(crate::actions::Task::ReleaseMacos)),
                Some(Dialog::ReleaseNumber { all: true }),
                Some(Dialog::ReleaseConfirm(crate::actions::Task::ReleaseAll(2))),
                Some(Dialog::PublicationCandidates),
                Some(Dialog::PublicationActions),
                Some(Dialog::PublicationTarget(
                    crate::publication::Action::Publish,
                )),
                Some(Dialog::PublicationConfirm(
                    crate::publication::Action::Reconcile,
                )),
            ] {
                draw(size.0, size.1, true, dialog);
            }
        }
    }
}
