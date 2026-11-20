use crate::actions::{CommandSpec, Task};
use crossterm::event::KeyCode;
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize)]
struct Scenario {
    id: String,
    label: String,
}

#[derive(Deserialize)]
struct Catalog {
    create: Vec<Scenario>,
    apply: Vec<Scenario>,
}

#[derive(Default)]
enum Step {
    #[default]
    Start,
    Workspace,
    Path,
    Scenario(Task),
    Name,
    Confirm,
}

#[derive(Default)]
pub struct Menu {
    step: Step,
    parent: PathBuf,
    workspaces: Vec<PathBuf>,
    target: String,
    input: String,
    scenarios: Vec<Scenario>,
    selected: usize,
    pub error: String,
}

fn path_text(path: &Path) -> Option<&str> {
    path.to_str()
        .filter(|value| !value.chars().any(char::is_control))
}

fn start_folder(root: &Path) -> PathBuf {
    let folder = std::env::var_os("SITUATE_TEST_WORKSPACES_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Documents")))
        .unwrap_or_else(|| root.to_owned());
    root.join(folder)
}

fn list(parent: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<_> = fs::read_dir(parent)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path_text(path).is_some() && path.join(".situate").is_dir())
        .collect();
    entries.sort();
    entries
}

impl Menu {
    fn scenario(&mut self, task: Task) -> Result<(), String> {
        let catalog: Catalog = serde_json::from_str(include_str!(
            "../../../client/crates/situate-fixtures/src/catalog.json"
        ))
        .map_err(|error| error.to_string())?;
        self.scenarios = if task == Task::FixtureCreate {
            catalog.create
        } else {
            catalog.apply
        };
        if self.scenarios.is_empty() {
            return Err("No fixtures available for this action.".into());
        }
        self.selected = 0;
        self.step = Step::Scenario(task);
        Ok(())
    }

    fn target(&mut self, path: &Path) -> Result<(), String> {
        let path = path.canonicalize().map_err(|error| error.to_string())?;
        let target = path_text(&path).ok_or("Unsupported workspace path.")?;
        if !path.join(".situate").is_dir() {
            return Err("Select a Situate workspace folder.".into());
        }
        self.target = target.into();
        self.scenario(Task::FixtureApply)
    }

    pub fn key(
        &mut self,
        key: KeyCode,
        root: &Path,
    ) -> Result<Option<(Task, CommandSpec)>, String> {
        self.error.clear();
        match (&self.step, key) {
            (Step::Start, KeyCode::Char('1') | KeyCode::Enter) => {
                self.parent = start_folder(root)
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                self.scenario(Task::FixtureCreate)?;
            }
            (Step::Start, KeyCode::Char('2')) => {
                self.parent = start_folder(root);
                self.workspaces = list(&self.parent);
                self.selected = 0;
                self.step = Step::Workspace;
            }
            (Step::Workspace, KeyCode::Char('p')) => {
                self.input =
                    path_text(&self.parent).map_or_else(String::new, |path| format!("{path}/"));
                self.step = Step::Path;
            }
            (Step::Workspace, KeyCode::Enter) => {
                let path = self
                    .workspaces
                    .get(self.selected)
                    .ok_or("No workspaces here. Enter a path instead.")?
                    .clone();
                self.target(&path)?;
            }
            (Step::Path, KeyCode::Enter) => {
                let path = root.join(&self.input);
                self.target(&path)?;
            }
            (Step::Scenario(Task::FixtureCreate), KeyCode::Enter) => {
                let time = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default();
                self.input = format!("Test Workspace {}", time.as_millis());
                self.step = Step::Name;
            }
            (Step::Scenario(_), KeyCode::Enter) => self.step = Step::Confirm,
            (Step::Name, KeyCode::Enter) => {
                let parent = path_text(&self.parent).ok_or("Unsupported destination path.")?;
                let task = Task::FixtureCreate;
                let mut spec = task.command(root);
                spec.args.extend([
                    "create".into(),
                    self.scenarios[self.selected].id.clone(),
                    parent.into(),
                    self.input.clone(),
                ]);
                return Ok(Some((task, spec)));
            }
            (Step::Confirm, KeyCode::Char('y')) => {
                let task = Task::FixtureApply;
                let mut spec = task.command(root);
                spec.args.extend([
                    "apply".into(),
                    self.scenarios[self.selected].id.clone(),
                    self.target.clone(),
                ]);
                return Ok(Some((task, spec)));
            }
            (Step::Workspace | Step::Scenario(_), KeyCode::Up | KeyCode::Down) => {
                let len = if matches!(self.step, Step::Workspace) {
                    self.workspaces.len()
                } else {
                    self.scenarios.len()
                };
                self.selected = if key == KeyCode::Up {
                    self.selected.saturating_sub(1)
                } else {
                    (self.selected + 1).min(len.saturating_sub(1))
                };
            }
            (Step::Path | Step::Name, KeyCode::Char(c))
                if !c.is_control() && self.input.len() < 4096 =>
            {
                self.input.push(c)
            }
            (Step::Path | Step::Name, KeyCode::Backspace) => {
                self.input.pop();
            }
            (Step::Path | Step::Name, KeyCode::Delete) => self.input.clear(),
            _ => {}
        }
        Ok(None)
    }

    pub fn message(&self) -> String {
        let text = match self.step {
            Step::Start => "Create a test workspace or add a fixture to an existing one.".into(),
            Step::Workspace => {
                let rows = self
                    .workspaces
                    .iter()
                    .enumerate()
                    .skip(self.selected.saturating_sub(5))
                    .take(10)
                    .map(|(i, path)| {
                        format!(
                            "{} {}",
                            if i == self.selected { ">" } else { " " },
                            path.file_name()
                                .unwrap_or(path.as_os_str())
                                .to_string_lossy()
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                format!(
                    "Select a workspace in {} (↑/↓)\n\n{rows}",
                    path_text(&self.parent).unwrap_or("<unsupported path>")
                )
            }
            Step::Path => format!("Workspace path (Delete to clear):\n\n{}▏", self.input),
            Step::Scenario(task) => {
                let kind = if task == Task::FixtureCreate {
                    "template"
                } else {
                    "action"
                };
                let rows = self
                    .scenarios
                    .iter()
                    .enumerate()
                    .skip(self.selected.saturating_sub(5))
                    .take(10)
                    .map(|(i, item)| {
                        format!(
                            "{} {}",
                            if i == self.selected { ">" } else { " " },
                            item.label
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                format!("Select a {kind} (↑/↓)\n\n{rows}")
            }
            Step::Name => format!(
                "New workspace in {}\nName (Delete to clear):\n\n{}▏",
                self.parent.display(),
                self.input
            ),
            Step::Confirm => format!(
                "{} in this test workspace?\n\n{}\n\nClose the workspace in all clients before applying.",
                self.scenarios[self.selected].label, self.target
            ),
        };
        if self.error.is_empty() {
            text
        } else {
            format!("{text}\n\n{}", self.error)
        }
    }

    pub fn buttons(&self) -> Vec<(&'static str, KeyCode)> {
        let mut buttons = match self.step {
            Step::Start => vec![
                ("[1] New workspace", KeyCode::Char('1')),
                ("[2] Existing workspace", KeyCode::Char('2')),
            ],
            Step::Workspace => vec![
                ("[Enter] Select", KeyCode::Enter),
                ("[p] Enter path", KeyCode::Char('p')),
            ],
            Step::Name => vec![("[Enter] Create workspace", KeyCode::Enter)],
            Step::Confirm => vec![("[y] Apply", KeyCode::Char('y'))],
            _ => vec![("[Enter] Continue", KeyCode::Enter)],
        };
        buttons.push((crate::text::BUTTON_CANCEL, KeyCode::Esc));
        buttons
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_workspace_runs_only_the_fixture_generator() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let mut menu = Menu {
            parent: parent.clone(),
            ..Default::default()
        };
        menu.scenario(Task::FixtureCreate).unwrap();
        assert_eq!(menu.scenarios[0].label, "Full Workspace");
        assert!(menu.key(KeyCode::Enter, dir.path()).unwrap().is_none());
        menu.key(KeyCode::Delete, dir.path()).unwrap();
        for c in "Sample workspace".chars() {
            menu.key(KeyCode::Char(c), dir.path()).unwrap();
        }
        let (task, spec) = menu.key(KeyCode::Enter, dir.path()).unwrap().unwrap();
        assert!(!task.is_client());
        assert_eq!(spec.program, "cargo");
        assert_eq!(spec.cwd, dir.path().join("client"));
        assert_eq!(
            spec.args,
            [
                "run",
                "--locked",
                "-p",
                "situate-fixtures",
                "--",
                "create",
                "used-workspace",
                parent.to_str().unwrap(),
                "Sample workspace",
            ]
        );
    }

    #[test]
    fn typed_workspace_path_requires_explicit_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("Test space");
        fs::create_dir_all(target.join(".situate")).unwrap();
        let mut menu = Menu {
            step: Step::Path,
            input: target.to_string_lossy().into(),
            ..Default::default()
        };
        assert!(menu.key(KeyCode::Enter, dir.path()).unwrap().is_none());
        assert!(menu.key(KeyCode::Enter, dir.path()).unwrap().is_none());
        let canonical = target.canonicalize().unwrap();
        assert!(menu.message().contains(canonical.to_str().unwrap()));
        assert!(menu.key(KeyCode::Enter, dir.path()).unwrap().is_none());
        let (task, spec) = menu.key(KeyCode::Char('y'), dir.path()).unwrap().unwrap();
        assert_eq!(task, Task::FixtureApply);
        assert_eq!(
            spec.args[5..],
            ["apply", "chat-draft", canonical.to_str().unwrap()]
        );
    }
}
