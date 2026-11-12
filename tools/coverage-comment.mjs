import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { percentage, delta } from "./coverage.mjs";

export const marker = "<!-- situate-coverage-v1 -->";
const sha = /^[a-f0-9]{40}$/;
export function validateReport(text, expected) {
  if (Buffer.byteLength(text) > 4096)
    throw new Error("Oversized coverage report");
  const data = JSON.parse(text);
  const keys = [
    "version",
    "repository",
    "run",
    "attempt",
    "pr",
    "head",
    "main",
    "side",
    "status",
    "vue",
    "rust",
  ];
  if (
    !data ||
    Object.keys(data).some((key) => !keys.includes(key)) ||
    data.version !== 1 ||
    typeof data.head !== "string" ||
    typeof data.main !== "string" ||
    !sha.test(data.head) ||
    !sha.test(data.main) ||
    !["measured", "unavailable", "failed"].includes(data.status)
  )
    throw new Error("Invalid coverage report");
  for (const [key, value] of Object.entries(expected))
    if (data[key] !== value) throw new Error("Coverage identity mismatch");
  for (const name of ["vue", "rust"]) {
    const metric = data[name];
    if (data.status !== "measured") {
      if (metric !== undefined) throw new Error("Unexpected coverage counts");
    } else if (
      !metric ||
      Object.keys(metric).sort().join() !== "found,hit" ||
      !Number.isSafeInteger(metric.found) ||
      !Number.isSafeInteger(metric.hit) ||
      metric.found < 1 ||
      metric.found > 100000000 ||
      metric.hit < 0 ||
      metric.hit > metric.found
    )
      throw new Error("Invalid coverage counts");
  }
  return data;
}

export function eligible(run, pr, repository, workflowId) {
  return (
    run.repository?.full_name === repository &&
    run.workflow_id === workflowId &&
    run.path === ".github/workflows/coverage.yml" &&
    run.event === "pull_request" &&
    run.status === "completed" &&
    pr.state === "open" &&
    pr.base?.repo?.full_name === repository &&
    pr.head?.sha === run.head_sha &&
    pr.head?.repo?.full_name === run.head_repository?.full_name
  );
}

export function render(head, main, conclusion) {
  const lines = [
    marker,
    "## Coverage",
    "",
    `PR head: \`${head.head}\``,
    `Main baseline: \`${head.main}\``,
    "",
    "Line coverage, measured independently at these revisions. No percentage gate.",
    "",
  ];
  if (conclusion !== "success" || head.status !== "measured")
    lines.push(
      "**Current coverage run failed or did not complete.** Counts from an incomplete run are not compared.",
    );
  else if (main.status !== "measured")
    lines.push(
      main.status === "unavailable"
        ? "**Main baseline unavailable:** this revision does not support coverage. No delta is calculated."
        : "**Main baseline failed:** no delta is calculated.",
    );
  if (head.status === "measured" && conclusion === "success") {
    lines.push(
      "",
      "| Source | PR head | Main | Change |",
      "| --- | ---: | ---: | ---: |",
    );
    for (const [name, label] of [
      ["vue", "Vue"],
      ["rust", "Rust workspace"],
    ]) {
      const current = head[name];
      const baseline = main.status === "measured" ? main[name] : null;
      const change = baseline ? delta(current, baseline) : null;
      lines.push(
        `| ${label} | ${percentage(current).toFixed(2)}% (${current.hit}/${current.found}) | ${baseline ? `${percentage(baseline).toFixed(2)}% (${baseline.hit}/${baseline.found})` : "Unavailable"} | ${change === null ? "Unavailable" : `${change >= 0 ? "+" : ""}${change.toFixed(2)} pp`} |`,
      );
    }
  }
  return lines.join("\n");
}
export function ownComment(comment) {
  return (
    comment.user?.login === "github-actions[bot]" &&
    comment.user?.type === "Bot" &&
    comment.body?.startsWith(marker)
  );
}

export function validArtifact(artifact, run) {
  return (
    !artifact.expired &&
    Number.isSafeInteger(artifact.size_in_bytes) &&
    artifact.size_in_bytes > 0 &&
    artifact.size_in_bytes <= 16384 &&
    artifact.workflow_run?.id === run.id &&
    artifact.workflow_run?.repository_id === run.repository.id &&
    artifact.workflow_run?.head_repository_id === run.head_repository.id &&
    artifact.workflow_run?.head_sha === run.head_sha
  );
}

export function readArchive(buffer) {
  if (buffer.length > 16384) throw new Error("Oversized coverage archive");
  return execFileSync(
    "python3",
    [
      "-c",
      "import sys,io,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.namelist()==['report.json']\ni=z.getinfo('report.json')\nassert i.file_size<=4096\nsys.stdout.buffer.write(z.read(i))",
    ],
    {
      input: buffer,
      maxBuffer: 4096,
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).toString();
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const api = async (path, options = {}) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    return response;
  };
  await publishCoverage({ event, repository, api });
}

export async function publishCoverage({ event, repository, api }) {
  const run = await (await api(`actions/runs/${event.workflow_run.id}`)).json();
  const workflow = await (await api("actions/workflows/coverage.yml")).json();
  if (
    run.repository?.full_name !== repository ||
    run.workflow_id !== workflow.id ||
    run.event !== "pull_request" ||
    run.status !== "completed" ||
    !sha.test(run.head_sha) ||
    run.run_attempt !== event.workflow_run.run_attempt
  )
    return;
  let pr;
  let commitPulls;
  if (run.pull_requests?.length) {
    if (run.pull_requests.length !== 1) return;
    const number = run.pull_requests[0].number;
    if (!Number.isSafeInteger(number) || number < 1) return;
    pr = await (await api(`pulls/${number}`)).json();
    if (pr.number !== number || !eligible(run, pr, repository, workflow.id))
      return;
  } else {
    commitPulls = await (
      await api(`commits/${run.head_sha}/pulls?per_page=100`)
    ).json();
    const candidates = commitPulls.filter((candidate) =>
      eligible(run, candidate, repository, workflow.id),
    );
    if (candidates.length !== 1) return;
    pr = candidates[0];
  }
  let body;
  let invalidReports = false;
  try {
    const artifacts = await (
      await api(`actions/runs/${run.id}/artifacts?per_page=100`)
    ).json();
    const reports = {};
    for (const side of ["head", "main"]) {
      const matches = artifacts.artifacts.filter(
        (item) =>
          item.name === `coverage-${side}-${run.run_attempt}` && !item.expired,
      );
      if (matches.length === 0) continue;
      if (matches.length !== 1) throw new Error("Ambiguous coverage artifact");
      const artifact = matches[0];
      if (!validArtifact(artifact, run))
        throw new Error("Invalid coverage artifact provenance");
      const response = await api(`actions/artifacts/${artifact.id}/zip`);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 16384) throw new Error("Oversized coverage archive");
        chunks.push(chunk);
      }
      // Read a single member without extracting paths or executing artifact content.
      const text = readArchive(Buffer.concat(chunks));
      reports[side] = validateReport(text, {
        repository,
        run: run.id,
        attempt: run.run_attempt,
        pr: pr.number,
        head: run.head_sha,
        side,
      });
    }
    if (!reports.head || !reports.main) {
      body = [
        marker,
        "## Coverage",
        "",
        `PR head: \`${run.head_sha}\``,
        "",
        run.conclusion === "success"
          ? "**Coverage unavailable:** the run did not provide both coverage reports."
          : "**Coverage failed or did not complete:** one or both coverage reports are unavailable.",
        "No baseline revision or delta can be reported.",
      ].join("\n");
    } else {
      if (reports.head.main !== reports.main.main)
        throw new Error("Baseline mismatch");
      const currentMain = await (await api("commits/main")).json();
      if (!sha.test(currentMain.sha)) throw new Error("Invalid main revision");
      const comparison = await (
        await api(`compare/${reports.head.main}...${currentMain.sha}`)
      ).json();
      if (
        !["ahead", "identical"].includes(comparison.status) ||
        comparison.merge_base_commit?.sha !== reports.head.main ||
        comparison.base_commit?.sha !== reports.head.main
      )
        throw new Error("Baseline is not on main history");
      body = render(reports.head, reports.main, run.conclusion);
    }
  } catch {
    invalidReports = true;
    body = [
      marker,
      "## Coverage",
      "",
      `PR head: \`${run.head_sha}\``,
      "",
      "**Coverage unavailable:** coverage reports could not be downloaded or verified.",
      "No baseline revision, counts or delta can be reported.",
    ].join("\n");
  }
  body += `\n\n[Coverage run](https://github.com/${repository}/actions/runs/${run.id})`;
  const comments = [];
  for (let page = 1; ; page++) {
    const batch = await (
      await api(`issues/${pr.number}/comments?per_page=100&page=${page}`)
    ).json();
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const existing = comments.find(ownComment);
  const fresh = await (await api(`pulls/${pr.number}`)).json();
  if (!eligible(run, fresh, repository, workflow.id)) return;
  const latest = await (await api(`actions/runs/${run.id}`)).json();
  if (latest.run_attempt !== run.run_attempt) return;
  const recent = await (
    await api(
      `actions/workflows/${workflow.id}/runs?event=pull_request&head_sha=${run.head_sha}&per_page=100`,
    )
  ).json();
  for (const other of recent.workflow_runs) {
    if (
      other.id <= run.id ||
      other.head_repository?.full_name !== run.head_repository.full_name
    )
      continue;
    if (other.pull_requests?.length) {
      if (
        other.pull_requests.some(
          (associated) => associated.number === pr.number,
        )
      )
        return;
    } else {
      commitPulls ??= await (
        await api(`commits/${run.head_sha}/pulls?per_page=100`)
      ).json();
      const candidates = commitPulls.filter((candidate) =>
        eligible(run, candidate, repository, workflow.id),
      );
      if (candidates.length === 1 && candidates[0].number === pr.number) return;
    }
  }
  await api(
    existing
      ? `issues/comments/${existing.id}`
      : `issues/${pr.number}/comments`,
    { method: existing ? "PATCH" : "POST", body: JSON.stringify({ body }) },
  );
  if (invalidReports)
    throw new Error(
      "Coverage reports could not be verified; the comment was marked unavailable.",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
