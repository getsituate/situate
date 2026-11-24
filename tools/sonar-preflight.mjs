import { execFileSync, spawn } from "node:child_process";
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

export async function preflight({
  publish = false,
  env = process.env,
  cwd = process.cwd(),
  signal,
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

  const run = async (command, args, cwd, childEnv = localEnv) => {
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: childEnv,
        stdio: ["ignore", "inherit", "inherit"],
        detached: true,
      });
      let killTimer;
      function killGroup(name) {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, name);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      function cancel() {
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
      }
      signal?.addEventListener("abort", cancel, { once: true });
      child.once("error", reject);
      child.once("close", (code) => {
        signal?.removeEventListener("abort", cancel);
        clearTimeout(killTimer);
        if (signal?.aborted) {
          killGroup("SIGKILL");
          reject(signal.reason);
        } else if (code === 0) resolve();
        else
          reject(
            new Error(
              `${command} failed${code === null ? "." : ` (exit ${code}).`}`,
            ),
          );
      });
    });
  };

  const { branch, head } = candidate();
  const fetchBase = async () => {
    await run(
      "git",
      ["fetch", "--no-tags", "origin", `refs/heads/main:${base}`],
      root,
    );
    return atRoot("rev-parse", base);
  };
  console.log("Fetching main from GitHub…");
  const target = await fetchBase();
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

  await run("sonar-scanner", ["--version"], root);
  const scratch = mkdtempSync(join(tmpdir(), "situate-sonar-"));
  const checkout = join(scratch, "checkout");
  let added = false;
  try {
    atRoot("worktree", "add", "--detach", checkout, head);
    added = true;
    console.log("Measuring Vue coverage…");
    await run(
      "volta",
      ["run", "node", "tools/actions-adapter.mjs", "sonar-coverage"],
      checkout,
      {
        ...localEnv,
        RUNNER_TEMP: scratch,
      },
    );
    console.log(
      "Scanning the branch and waiting for the SonarCloud quality gate…",
    );
    await run(
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
    (await fetchBase()) !== target
  )
    throw new Error(
      "The branch or main changed during analysis. Run the preflight again.",
    );
  console.log("Pushing the checked commit…");
  await run(
    "git",
    ["push", "--no-follow-tags", pushUrl, `${head}:refs/heads/${branch}`],
    root,
  );
  console.log("Opening the pull request…");
  await run(
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
  const controller = new AbortController();
  const stop = () => controller.abort();
  for (const name of ["SIGTERM", "SIGINT"]) process.on(name, stop);
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length || !["check", "open"].includes(mode))
      throw new Error("Usage: node tools/sonar-preflight.mjs check|open");
    await preflight({ publish: mode === "open", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted)
      console.error("SonarCloud preflight cancelled.");
    else if (error.code === "ENOENT" && error.path === "sonar-scanner")
      console.error("Install SonarScanner CLI and add sonar-scanner to PATH.");
    else console.error(error.message);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    for (const name of ["SIGTERM", "SIGINT"]) process.off(name, stop);
  }
}
