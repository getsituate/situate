use crate::text;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Task {
    Desktop,
    Workflow(crate::release::Action),
    Unit,
    Quick,
    Full,
    Docs,
    Design,
    Website,
    Requirements,
}

#[derive(Clone, Debug)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub report: bool,
    pub handoff: bool,
    pub diagnostics_manifest: Option<PathBuf>,
    pub open_browser: bool,
    pub events: bool,
    pub interactive: bool,
}

impl CommandSpec {
    pub fn new(program: &str, args: &[&str], cwd: &Path) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|s| (*s).into()).collect(),
            cwd: cwd.into(),
            report: false,
            handoff: false,
            diagnostics_manifest: None,
            open_browser: false,
            events: false,
            interactive: false,
        }
    }
    pub fn display(&self) -> String {
        std::iter::once(self.program.as_str())
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

impl Task {
    pub fn name(self) -> &'static str {
        match self {
            Self::Workflow(action) => action.name(),
            Self::Desktop => text::TASK_NAMES[0],
            Self::Unit => text::TASK_NAMES[1],
            Self::Quick => text::TASK_NAMES[2],
            Self::Full => text::TASK_NAMES[3],
            Self::Docs => text::TASK_NAMES[4],
            Self::Design => text::TASK_NAMES[5],
            Self::Website => text::TASK_NAMES[6],
            Self::Requirements => text::REQUIREMENTS,
        }
    }
    pub fn is_test(self) -> bool {
        matches!(self, Self::Unit | Self::Quick | Self::Full)
    }
    pub fn is_client(self) -> bool {
        matches!(self, Self::Desktop | Self::Design)
    }
    pub fn is_release(self) -> bool {
        matches!(self, Self::Workflow(_))
    }
    pub fn command(self, root: &Path) -> CommandSpec {
        match self {
            Self::Workflow(action) => crate::release::command(root, action, &[]),
            Self::Desktop => CommandSpec::new("npm", &["run", "dev:client"], &root.join("client")),
            Self::Design => CommandSpec::new("npm", &["run", "design"], &root.join("client")),
            Self::Website => {
                let mut spec =
                    CommandSpec::new("node", &["website/site.mjs", "--build", "--serve"], root);
                spec.open_browser = true;
                spec
            }
            Self::Requirements => {
                let mut spec = CommandSpec::new("node", &["requirements/scripts/preview.js"], root);
                spec.open_browser = true;
                spec
            }
            Self::Docs => CommandSpec::new(
                "asciidoctor",
                &[
                    "--failure-level",
                    "WARN",
                    "-o",
                    "docs/architecture/index.html",
                    "docs/architecture/index.adoc",
                ],
                root,
            ),
            _ => {
                let mut spec = CommandSpec::new("node", &["tools/test.mjs", "--json"], root);
                spec.report = true;
                match self {
                    Self::Unit => spec.args.extend(["--unit".into(), "--changed".into()]),
                    Self::Quick => spec.args.push("--quick".into()),
                    _ => {}
                }
                spec
            }
        }
    }
}

pub fn client_dependencies_ready(root: &Path) -> bool {
    let entries: Vec<String> = serde_json::from_str(include_str!("../client-dependencies.json"))
        .expect("valid client dependency entrypoints");
    entries
        .iter()
        .all(|entry| root.join("client/node_modules").join(entry).is_file())
}

pub fn prepare_client(root: &Path) -> CommandSpec {
    CommandSpec::new("node", &["tools/prepare-client.mjs"], root)
}

pub fn find_root(start: &Path) -> Option<PathBuf> {
    start
        .canonicalize()
        .ok()?
        .ancestors()
        .find(|p| p.join("tools/test.mjs").is_file() && p.join("client/package.json").is_file())
        .map(Path::to_path_buf)
}

pub fn browser(root: &Path) -> CommandSpec {
    browser_target(root, "docs/architecture/index.html")
}

pub fn browser_target(root: &Path, target: &str) -> CommandSpec {
    let mut spec = CommandSpec::new(
        if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        },
        &[target],
        root,
    );
    spec.handoff = true;
    spec
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_reuse_existing_entry_points() {
        let root = Path::new("/checkout with spaces");
        assert_eq!(Task::Desktop.command(root).cwd, root.join("client"));
        assert_eq!(
            Task::Unit.command(root).args,
            ["tools/test.mjs", "--json", "--unit", "--changed"]
        );
        let design = Task::Design.command(root);
        assert_eq!(design.args, ["run", "design"]);
        assert_eq!(design.cwd, root.join("client"));
        assert!(!design.report);
        assert!(Task::Design.is_client());
        assert!(!Task::Design.is_test());
        let website = Task::Website.command(root);
        assert_eq!(website.program, "node");
        assert_eq!(website.args, ["website/site.mjs", "--build", "--serve"]);
        assert_eq!(website.cwd, root);
        assert!(website.open_browser);
        assert!(!website.handoff);
        assert!(!website.report);
        assert!(!Task::Website.is_client());
        assert!(!Task::Website.is_test());
        assert!(!Task::Website.is_release());
        let requirements = Task::Requirements.command(root);
        assert_eq!(requirements.args, ["requirements/scripts/preview.js"]);
        assert_eq!(requirements.cwd, root);
        assert!(requirements.open_browser);
        assert!(!Task::Requirements.is_client());
        assert!(!Task::Requirements.is_test());
        assert!(Task::Full.command(root).report);
        assert_eq!(Task::Docs.command(root).args[0], "--failure-level");
    }
    #[test]
    fn dependency_check_requires_all_client_entrypoints() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!client_dependencies_ready(dir.path()));
        let entries: Vec<String> =
            serde_json::from_str(include_str!("../client-dependencies.json")).unwrap();
        for entry in &entries {
            let path = dir.path().join("client/node_modules").join(entry);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "fixture").unwrap();
        }
        assert!(client_dependencies_ready(dir.path()));
        for entry in &entries {
            let path = dir.path().join("client/node_modules").join(entry);
            std::fs::remove_file(&path).unwrap();
            assert!(!client_dependencies_ready(dir.path()), "missing {entry}");
            std::fs::write(path, "fixture").unwrap();
        }
        assert_eq!(
            prepare_client(dir.path()).args,
            ["tools/prepare-client.mjs"]
        );
    }
    #[test]
    fn root_discovery_uses_nearest_checkout_not_git_common_dir() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("tools/dev-tui/src")).unwrap();
        std::fs::create_dir_all(dir.path().join("client")).unwrap();
        std::fs::write(dir.path().join("tools/test.mjs"), "").unwrap();
        std::fs::write(dir.path().join("client/package.json"), "{}").unwrap();
        assert_eq!(
            find_root(&dir.path().join("tools/dev-tui/src")),
            Some(dir.path().canonicalize().unwrap())
        );
        assert!(find_root(&dir.path().join("..")).is_none());
    }
}
