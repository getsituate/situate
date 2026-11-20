import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function hostingState(runs, { repository, sha }) {
  const matches = runs.filter(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.event === "push" &&
      run.head_repository?.full_name === repository,
  );
  if (!matches.length) return "waiting";
  assert.equal(matches.length, 1, "Multiple hosting runs match this revision");
  const [run] = matches;
  return run.status === "completed" ? run.conclusion : "waiting";
}

async function main({
  GITHUB_REPOSITORY: repository,
  GITHUB_SHA: sha,
  GH_TOKEN: token,
}) {
  assert.equal(repository, "getsituate/situate");
  assert.match(sha ?? "", /^[a-f0-9]{40}$/);
  assert(token, "GitHub Actions read access is required");
  const url = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/deploy-hosting.yml/runs`,
  );
  url.search = new URLSearchParams({
    branch: "main",
    event: "push",
    head_sha: sha,
  });
  // The workflow job timeout also bounds the wait when hosting has not started.
  for (;;) {
    const response = await fetch(url, {
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    assert(
      response.ok,
      `Cannot read hosting run status (HTTP ${response.status})`,
    );
    const { workflow_runs: runs } = await response.json();
    const state = hostingState(runs, { repository, sha });
    if (state === "success") return;
    assert.equal(
      state,
      "waiting",
      "Hosting did not complete successfully for this revision",
    );
    await delay(20_000);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
