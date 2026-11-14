import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCommitMessage } from "./commit-policy.mjs";

const policyPath = "tools/commit-policy.mjs";
class CommitCheckError extends Error {}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trimEnd();
}

function revision(cwd, ref) {
  return git(cwd, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]);
}

function ancestor(cwd, older, newer) {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", older, newer],
    {
      cwd,
      stdio: "ignore",
    },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error("Could not inspect commit ancestry.");
}

export function checkCommitRange({
  cwd = process.cwd(),
  base,
  head = "HEAD",
} = {}) {
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]) === "true")
    throw new Error(
      "Commit checks require full history; fetch the complete repository first.",
    );
  const target = revision(cwd, head);
  const start = base === undefined ? undefined : revision(cwd, base);
  // Ancestry, not author dates, also grandfathers commits on pre-adoption branches.
  const introductions = git(cwd, [
    "log",
    "--full-history",
    "--diff-filter=A",
    "--format=%H",
    target,
    "--",
    policyPath,
  ])
    .split("\n")
    .filter(Boolean);
  if (!introductions.length)
    throw new Error(
      "No commit-policy adoption boundary exists in the requested history.",
    );
  const commits = git(cwd, [
    "rev-list",
    "--reverse",
    start ? `${start}..${target}` : target,
  ])
    .split("\n")
    .filter(Boolean);
  const failures = [];
  let checked = 0;
  for (const commit of commits) {
    if (!introductions.some((boundary) => ancestor(cwd, boundary, commit)))
      continue;
    checked++;
    const parents = git(cwd, ["show", "-s", "--format=%P", commit]).split(" ");
    const message = git(cwd, ["show", "-s", "--format=%B", commit]);
    const error = validateCommitMessage(message, { merge: parents.length > 1 });
    if (error) failures.push({ commit, error });
  }
  return { checked, grandfathered: commits.length - checked, failures };
}

export function checkCommitHeads({ cwd = process.cwd(), base, heads } = {}) {
  if (
    !Array.isArray(heads) ||
    !heads.length ||
    heads.length > 1000 ||
    heads.some(
      (head) =>
        typeof head !== "string" ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head),
    ) ||
    new Set(heads).size !== heads.length
  )
    throw new Error("Select a nonempty unique list of exact commit SHAs.");
  const results = heads.map((head) => {
    if (revision(cwd, head) !== head)
      throw new Error("Each selected head must identify a commit object.");
    return checkCommitRange({ cwd, base, head });
  });
  return {
    checked: results.reduce((total, result) => total + result.checked, 0),
    grandfathered: results.reduce(
      (total, result) => total + result.grandfathered,
      0,
    ),
    failures: results.flatMap(({ failures }) => failures),
  };
}

export function checkMessageFile(file, cwd = process.cwd()) {
  const mergeHead = git(cwd, ["rev-parse", "--git-path", "MERGE_HEAD"]);
  return validateCommitMessage(readFileSync(file, "utf8"), {
    merge: existsSync(resolve(cwd, mergeHead)),
  });
}

export function main(args) {
  const options = {};
  let messageFile;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (
      !["--base", "--head", "--heads", "--message-file"].includes(flag) ||
      !args[index + 1]
    )
      throw new Error(
        "Usage: node tools/commit-check.mjs [--base REF] [--head REF | --heads JSON] | --message-file PATH",
      );
    const value = args[++index];
    if (flag === "--message-file") messageFile = value;
    else options[flag.slice(2)] = value;
  }
  if (messageFile) {
    if (Object.keys(options).length)
      throw new Error("Choose a message file or a commit range, not both.");
    const error = checkMessageFile(messageFile);
    if (error) throw new CommitCheckError(error);
    return;
  }
  if (options.head !== undefined && options.heads !== undefined)
    throw new Error("Select one head or a list of heads, not both.");
  if (options.heads !== undefined && Buffer.byteLength(options.heads) > 65536)
    throw new Error("Commit head list exceeds the supported limit.");
  const result =
    options.heads === undefined
      ? checkCommitRange(options)
      : checkCommitHeads({
          base: options.base,
          heads: JSON.parse(options.heads),
        });
  for (const { commit, error } of result.failures)
    console.error(`${commit}: ${error}`);
  console.log(
    `Commit messages: ${result.checked} checked, ${result.grandfathered} grandfathered, ${result.failures.length} invalid.`,
  );
  if (result.failures.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    // Do not echo commit contents, file contents, or subprocess diagnostics.
    console.error(
      error instanceof CommitCheckError
        ? error.message
        : "Commit check failed. Verify the arguments, full Git history, and adoption boundary. See docs/development/commit-conventions.md.",
    );
    process.exitCode = 1;
  }
}
