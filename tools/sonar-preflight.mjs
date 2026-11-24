import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readPrivateDotenv } from "../client/scripts/private-dotenv.mjs";

const repository = "getsituate/situate";
const base = "refs/remotes/origin/main";
const originUrls = [
  `git@github.com:${repository}.git`,
  `ssh://git@github.com/${repository}.git`,
  `https://github.com/${repository}.git`,
  `https://github.com/${repository}`,
];

export function preflight({
  publish = false,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const {
    SONAR_TOKEN: exportedToken,
    SONARQUBE_MCP_TOKEN: _,
    ...localEnv
  } = env;
  const git = (...args) =>
    execFileSync("git", args, { cwd, env: localEnv, encoding: "utf8" }).trim();
  const root = git("rev-parse", "--show-toplevel");
  const atRoot = (...args) => git("-C", root, ...args);
  if (!originUrls.includes(atRoot("remote", "get-url", "origin")))
    throw new Error(`Expected origin to point to github.com/${repository}.`);
  const pushUrl =
    publish && atRoot("remote", "get-url", "--push", "--all", "origin");
  if (publish && !originUrls.includes(pushUrl))
    throw new Error(`Expected a single push URL for github.com/${repository}.`);

  function candidate() {
    if (atRoot("status", "--porcelain", "--untracked-files=all"))
      throw new Error(
        "Commit or remove local changes before running the preflight.",
      );
    const branch = atRoot("branch", "--show-current");
    if (!branch || branch === "main")
      throw new Error(
        "Switch to a feature branch before running the preflight.",
      );
    return { branch, head: atRoot("rev-parse", "HEAD") };
  }

  const { branch, head } = candidate();
  const fetchBase = () => {
    atRoot("fetch", "--no-tags", "origin", `refs/heads/main:${base}`);
    return atRoot("rev-parse", base);
  };
  const target = fetchBase();
  if (head === target)
    throw new Error("The branch has no commits ahead of main.");
  if (atRoot("merge-base", target, head) !== target)
    throw new Error(
      "Integrate current origin/main first so the scan covers the files that would merge.",
    );

  const token =
    exportedToken ??
    (env.CI
      ? undefined
      : readPrivateDotenv(join(root, ".env"), ["SONAR_TOKEN"]).SONAR_TOKEN);
  if (!token?.trim())
    throw new Error(
      "Set SONAR_TOKEN with Execute Analysis permission on the SonarCloud project.",
    );

  const run = (command, args, cwd, childEnv = localEnv) =>
    execFileSync(command, args, { cwd, env: childEnv, stdio: "inherit" });
  run("sonar-scanner", ["--version"], root);
  const scratch = mkdtempSync(join(tmpdir(), "situate-sonar-"));
  const checkout = join(scratch, "checkout");
  let added = false;
  try {
    atRoot("worktree", "add", "--detach", checkout, head);
    added = true;
    run(
      "volta",
      ["run", "node", "tools/actions-adapter.mjs", "sonar-coverage"],
      checkout,
      {
        ...localEnv,
        RUNNER_TEMP: scratch,
      },
    );
    run(
      "sonar-scanner",
      [
        "-Dsonar.organization=getsituate",
        "-Dsonar.projectKey=getsituate_situate",
        "-Dsonar.scanner.autoconfig.enabled=false",
        `-Dsonar.javascript.lcov.reportPaths=${join(scratch, "situate-vue.lcov")}`,
        `-Dsonar.branch.name=preflight/${branch}`,
        "-Dsonar.branch.target=main",
        "-Dsonar.qualitygate.wait=true",
      ],
      checkout,
      {
        ...localEnv,
        SONAR_HOST_URL: "https://sonarcloud.io",
        SONAR_TOKEN: token,
      },
    );
  } finally {
    if (added) atRoot("worktree", "remove", "--force", checkout);
    rmSync(scratch, { recursive: true, force: true });
  }

  if (!publish) return;
  const current = candidate();
  if (
    current.branch !== branch ||
    current.head !== head ||
    fetchBase() !== target
  )
    throw new Error(
      "The branch or main changed during analysis. Run the preflight again.",
    );
  run(
    "git",
    ["push", "--no-follow-tags", pushUrl, `${head}:refs/heads/${branch}`],
    root,
  );
  run(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      `github.com/${repository}`,
      "--base",
      "main",
      "--head",
      branch,
      "--fill",
    ],
    root,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length || !["check", "open"].includes(mode))
      throw new Error("Usage: node tools/sonar-preflight.mjs check|open");
    preflight({ publish: mode === "open" });
  } catch (error) {
    if (error.code === "ENOENT" && error.path === "sonar-scanner")
      console.error("Install SonarScanner CLI and add sonar-scanner to PATH.");
    else console.error(error.message);
    process.exitCode = 1;
  }
}
