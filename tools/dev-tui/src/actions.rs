use crate::text;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Task {
    Desktop,
    Preparation(crate::release::Operation),
    Unit,
    Quick,
    Full,
    Docs,
    Design,
    Website,
    Requirements,
    Publication(crate::publication::Action),
    ReleaseMacos,
    ReleaseIos(u16),
    ReleaseAll(u16),
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
    pub release_validation: Option<PathBuf>,
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
            release_validation: None,
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
            Self::Preparation(op) => op.name(),
            Self::Desktop => text::TASK_NAMES[0],
            Self::Unit => text::TASK_NAMES[1],
            Self::Quick => text::TASK_NAMES[2],
            Self::Full => text::TASK_NAMES[3],
            Self::Docs => text::TASK_NAMES[4],
            Self::Design => text::TASK_NAMES[5],
            Self::Website => text::TASK_NAMES[6],
            Self::Requirements => text::REQUIREMENTS,
            Self::Publication(action) => action.name(),
            Self::ReleaseMacos => text::RELEASE_MACOS,
            Self::ReleaseIos(_) => text::RELEASE_IOS,
            Self::ReleaseAll(_) => text::RELEASE_ALL,
        }
    }
    pub fn is_test(self) -> bool {
        matches!(self, Self::Unit | Self::Quick | Self::Full)
    }
    pub fn is_client(self) -> bool {
        matches!(self, Self::Desktop | Self::Design)
    }
    pub fn is_release(self) -> bool {
        self.is_apple_release() || matches!(self, Self::Publication(_) | Self::Preparation(_))
    }
    pub fn is_apple_release(self) -> bool {
        matches!(
            self,
            Self::ReleaseMacos | Self::ReleaseIos(_) | Self::ReleaseAll(_)
        )
    }
    pub fn command(self, root: &Path) -> CommandSpec {
        match self {
            Self::Preparation(op) => crate::release::command(root, op.name(), ""),
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
            Self::Publication(action) => CommandSpec::new(
                "node",
                &[
                    "tools/run-coordinated.mjs",
                    "--",
                    "node",
                    "infrastructure/releases/publish.mjs",
                    action.argument(),
                ],
                root,
            ),
            Self::ReleaseMacos | Self::ReleaseIos(_) | Self::ReleaseAll(_) => {
                let platform = match self {
                    Self::ReleaseMacos => "macos",
                    Self::ReleaseIos(_) => "ios",
                    _ => "all",
                };
                let mut spec = CommandSpec::new(
                    "npm",
                    &["run", "release:apple", "--", "--platform", platform],
                    &root.join("client"),
                );
                spec.args.extend([
                    "--distribution".into(),
                    if matches!(self, Self::ReleaseIos(_)) {
                        "external"
                    } else {
                        "direct"
                    }
                    .into(),
                ]);
                if let Self::ReleaseIos(number) | Self::ReleaseAll(number) = self {
                    spec.args.extend([
                        "--build-number".into(),
                        number.to_string(),
                        "--upload-testflight".into(),
                    ]);
                }
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
    fn publication_reuses_the_existing_entry_point_without_client_setup() {
        let root = Path::new("/checkout with spaces");
        let task = Task::Publication(crate::publication::Action::Check);
        let command = task.command(root);
        assert_eq!(command.program, "node");
        assert_eq!(
            command.args,
            [
                "tools/run-coordinated.mjs",
                "--",
                "node",
                "infrastructure/releases/publish.mjs",
                "check"
            ]
        );
        assert_eq!(command.cwd, root);
        assert!(!command.report);
        assert!(!command.handoff);
        assert!(!command.open_browser);
        assert!(task.is_release());
        assert!(!task.is_apple_release());
        assert!(!task.is_client());
    }
    #[test]
    fn apple_releases_upload_only_when_ios_is_selected() {
        let root = Path::new("/checkout with spaces");
        for (task, expected) in [
            (
                Task::ReleaseMacos,
                vec![
                    "run",
                    "release:apple",
                    "--",
                    "--platform",
                    "macos",
                    "--distribution",
                    "direct",
                ],
            ),
            (
                Task::ReleaseIos(42),
                vec![
                    "run",
                    "release:apple",
                    "--",
                    "--platform",
                    "ios",
                    "--distribution",
                    "external",
                    "--build-number",
                    "42",
                    "--upload-testflight",
                ],
            ),
            (
                Task::ReleaseAll(9999),
                vec![
                    "run",
                    "release:apple",
                    "--",
                    "--platform",
                    "all",
                    "--distribution",
                    "direct",
                    "--build-number",
                    "9999",
                    "--upload-testflight",
                ],
            ),
        ] {
            let command = task.command(root);
            assert_eq!(command.program, "npm");
            assert_eq!(command.args, expected);
            assert_eq!(command.cwd, root.join("client"));
            assert!(!command.report);
            assert!(!command.handoff);
            assert!(task.is_release());
            assert!(!task.is_test());
        }
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
