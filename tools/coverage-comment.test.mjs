import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { publishCoverage, marker } from "./coverage-comment.mjs";

const repository = "owner/project";
const head = "a".repeat(40);
const baseline = "b".repeat(40);
const main = "c".repeat(40);

function fixture(options = {}) {
  const run = {
    id: 123,
    run_attempt: 1,
    workflow_id: 7,
    repository: { id: 1, full_name: repository },
    head_repository: { id: 2, full_name: "contributor/fork" },
    head_sha: head,
    path: ".github/workflows/coverage.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    ...options.run,
  };
  const pull = {
    number: 42,
    state: "open",
    base: { ref: "main", repo: { full_name: repository } },
    head: { sha: head, repo: { full_name: "contributor/fork" } },
    ...options.pull,
  };
  const artifacts = ["head", "main"].map((side, index) => ({
    id: index + 10,
    name: `coverage-${side}-${run.run_attempt}`,
    expired: false,
    size_in_bytes: 600,
    workflow_run: {
      id: 123,
      head_sha: head,
      repository_id: 1,
      head_repository_id: 2,
    },
    ...options.artifact,
  }));
  const comments = options.comments ?? [];
  const writes = [],
    reads = [];
  const api = async (path, request = {}) => {
    if (request.method) {
      writes.push({ path, ...request, body: JSON.parse(request.body).body });
      return Response.json({ id: 99 });
    }
    reads.push(path);
    if (path === "actions/runs/123")
      return Response.json(
        reads.filter((item) => item === path).length > 1
          ? { ...run, ...options.latest }
          : run,
      );
    if (path === "actions/workflows/coverage.yml")
      return Response.json({ id: 7 });
    if (path === `commits/${head}/pulls?per_page=100`)
      return Response.json(options.pulls ?? [pull]);
    if (path === "actions/runs/123/artifacts?per_page=100")
      return Response.json({ artifacts: options.missing ? [] : artifacts });
    if (/^actions\/artifacts\/(10|11)\/zip$/.test(path)) {
      if (options.downloadFailure)
        throw new Error("untrusted download diagnostic @everyone");
      if (options.archive) return new Response(options.archive);
      const side = path.includes("/10/") ? "head" : "main";
      const report = {
        version: 1,
        repository,
        run: 123,
        attempt: run.run_attempt,
        pr: pull.number,
        head,
        main: baseline,
        side,
        status: "measured",
        vue: { found: 4, hit: side === "head" ? 3 : 2 },
        rust: { found: 10, hit: side === "head" ? 2 : 5 },
        ...options.report,
      };
      if (side === "main" && options.unavailable) {
        report.status = "unavailable";
        delete report.vue;
        delete report.rust;
      }
      const zip = execFileSync(
        "python3",
        [
          "-c",
          "import sys,io,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z: z.writestr('report.json',sys.stdin.buffer.read())\nsys.stdout.buffer.write(b.getvalue())",
        ],
        { input: options.rawReport ?? JSON.stringify(report) },
      );
      return new Response(zip);
    }
    if (path === "commits/main") return Response.json({ sha: main });
    if (path === `compare/${baseline}...${main}`)
      return Response.json({
        status: "ahead",
        base_commit: { sha: baseline },
        merge_base_commit: { sha: baseline },
        ...options.comparison,
      });
    if (path === `issues/${pull.number}/comments?per_page=100&page=1`)
      return Response.json(comments);
    if (path === `pulls/${pull.number}`)
      return Response.json({ ...pull, ...options.fresh });
    if (
      path ===
      `actions/workflows/7/runs?event=pull_request&head_sha=${head}&per_page=100`
    )
      return Response.json({
        workflow_runs:
          options.recent ?? (options.newer ? [{ ...run, id: 124 }] : [run]),
      });
    throw new Error(`Unexpected test API call: ${path}`);
  };
  return {
    writes,
    reads,
    execute: () =>
      publishCoverage({
        event: {
          workflow_run: { id: 123, run_attempt: options.eventAttempt ?? 1 },
        },
        repository,
        api,
      }),
  };
}

test("fork posting flow validates artifacts and main ancestry before creating a comparison", async () => {
  const f = fixture();
  await f.execute();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].method, "POST");
  assert.equal(f.writes[0].path, "issues/42/comments");
  assert.match(f.writes[0].body, /\+25\.00 pp/);
  assert.match(f.writes[0].body, /-30\.00 pp/);
  assert.ok(f.reads.includes(`compare/${baseline}...${main}`));
  assert.ok(f.writes[0].body.includes(baseline));
});

test("PRs targeting another branch in the same repository still compare with main", async () => {
  const f = fixture({
    pull: { base: { ref: "release", repo: { full_name: repository } } },
  });
  await f.execute();
  assert.equal(f.writes.length, 1);
  assert.ok(f.reads.includes("commits/main"));
  assert.ok(f.writes[0].body.includes(baseline));
});

test("trusted run association distinguishes two PRs sharing a head commit", async () => {
  const pulls = [42, 43].map((number) => ({
    number,
    state: "open",
    base: {
      ref: number === 42 ? "main" : "release",
      repo: { full_name: repository },
    },
    head: { sha: head, repo: { full_name: "contributor/fork" } },
  }));
  for (const pull of pulls) {
    const otherNumber = pull.number === 42 ? 43 : 42;
    const f = fixture({
      pull,
      pulls,
      run: { pull_requests: [{ number: pull.number }] },
      recent: [
        {
          id: 124,
          head_repository: { full_name: "contributor/fork" },
          pull_requests: [{ number: otherNumber }],
        },
      ],
    });
    await f.execute();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].path, `issues/${pull.number}/comments`);
    assert.match(f.writes[0].body, /\+25\.00 pp/);
    assert.ok(!f.reads.includes(`commits/${head}/pulls?per_page=100`));
  }
  const unassociatedNewer = fixture({
    pulls,
    run: { pull_requests: [{ number: 42 }] },
    recent: [
      {
        id: 124,
        head_repository: { full_name: "contributor/fork" },
        pull_requests: [],
      },
    ],
  });
  await unassociatedNewer.execute();
  assert.equal(unassociatedNewer.writes.length, 1);
  const samePrNewer = fixture({
    pulls,
    run: { pull_requests: [{ number: 42 }] },
    newer: true,
  });
  await samePrNewer.execute();
  assert.equal(samePrNewer.writes.length, 0);
  const ambiguous = fixture({ pulls, run: { pull_requests: [] } });
  await ambiguous.execute();
  assert.equal(ambiguous.writes.length, 0);
});

test("trusted PR association must still belong to the repository and current head", async () => {
  for (const pull of [
    { state: "closed" },
    { head: { sha: main, repo: { full_name: "contributor/fork" } } },
    { base: { ref: "main", repo: { full_name: "other/project" } } },
  ]) {
    const f = fixture({ run: { pull_requests: [{ number: 42 }] }, pull });
    await f.execute();
    assert.equal(f.writes.length, 0);
    assert.ok(!f.reads.includes(`commits/${head}/pulls?per_page=100`));
  }
});

test("invalid reports cannot update stale or superseded runs", async () => {
  for (const options of [
    { fresh: { head: { sha: main, repo: { full_name: "contributor/fork" } } } },
    { latest: { run_attempt: 2 } },
    { newer: true },
  ]) {
    const f = fixture({ ...options, rawReport: "malformed" });
    await f.execute();
    assert.equal(f.writes.length, 0);
  }
});

test("sticky posting updates only the marked github-actions bot comment", async () => {
  const f = fixture({
    comments: [
      { id: 1, user: { login: "attacker", type: "User" }, body: marker },
      { id: 2, user: { login: "another[bot]", type: "Bot" }, body: marker },
      {
        id: 3,
        user: { login: "github-actions[bot]", type: "Bot" },
        body: "Other report",
      },
      {
        id: 4,
        user: { login: "github-actions[bot]", type: "Bot" },
        body: `${marker}\nOld report`,
      },
    ],
  });
  await f.execute();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].method, "PATCH");
  assert.equal(f.writes[0].path, "issues/comments/4");
});

test("missing reports replace old success without claiming a baseline revision", async () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "success"]) {
    const f = fixture({
      missing: true,
      run: { conclusion },
      comments: [
        {
          id: 4,
          user: { login: "github-actions[bot]", type: "Bot" },
          body: marker,
        },
      ],
    });
    await f.execute();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].method, "PATCH");
    assert.match(f.writes[0].body, /unavailable/);
    assert.doesNotMatch(f.writes[0].body, /\| Vue/);
    assert.ok(f.writes[0].body.includes(head));
    assert.ok(!f.writes[0].body.includes(baseline));
    assert.ok(!f.reads.includes("commits/main"));
  }
});

test("unsupported main produces current counts but no fake baseline or delta", async () => {
  const f = fixture({ unavailable: true });
  await f.execute();
  assert.match(f.writes[0].body, /Main baseline unavailable/);
  assert.match(f.writes[0].body, /75\.00%/);
  assert.doesNotMatch(f.writes[0].body, /[+-]\d+\.\d+ pp/);
});

test("posting refuses stale head, closed PR, cross-repository and other workflow runs", async () => {
  for (const options of [
    { run: { workflow_id: 8 } },
    { run: { path: ".github/workflows/other.yml" } },
    { run: { repository: { full_name: "attacker/project", id: 3 } } },
    { run: { event: "workflow_dispatch" } },
    { run: { run_attempt: 2 } },
    { pull: { state: "closed" } },
    { pull: { head: { sha: main, repo: { full_name: "contributor/fork" } } } },
    { fresh: { head: { sha: main, repo: { full_name: "contributor/fork" } } } },
    { latest: { run_attempt: 2 } },
    { newer: true },
  ]) {
    const f = fixture(options);
    await f.execute();
    assert.equal(f.writes.length, 0, JSON.stringify(options));
  }
});

test("invalid or unreadable reports replace sticky success with bounded unavailable text and fail visibly", async () => {
  for (const options of [
    { downloadFailure: true },
    { rawReport: "not JSON @everyone" },
    {
      run: { run_attempt: 2 },
      eventAttempt: 2,
      rawReport: "malformed rerun report",
    },
    { rawReport: "x".repeat(4097) },
    { archive: Buffer.alloc(16385) },
    { archive: Buffer.from("not a ZIP archive") },
    { artifact: { size_in_bytes: 16385 } },
    { report: { pr: 43 } },
    { report: { repository: "attacker/project" } },
    { report: { body: "@everyone" } },
    { report: { main: "<script>" } },
    {
      artifact: {
        workflow_run: {
          id: 124,
          head_sha: head,
          repository_id: 1,
          head_repository_id: 2,
        },
      },
    },
    {
      artifact: {
        workflow_run: {
          id: 123,
          head_sha: head,
          repository_id: 3,
          head_repository_id: 2,
        },
      },
    },
    { comparison: { status: "diverged" } },
    { comparison: { merge_base_commit: { sha: head } } },
  ]) {
    const f = fixture({
      ...options,
      comments: [
        {
          id: 4,
          user: { login: "github-actions[bot]", type: "Bot" },
          body: `${marker}\nPrevious success`,
        },
      ],
    });
    await assert.rejects(f.execute(), /Coverage reports could not be verified/);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].method, "PATCH");
    assert.equal(f.writes[0].path, "issues/comments/4");
    assert.match(f.writes[0].body, /Coverage unavailable/);
    assert.doesNotMatch(
      f.writes[0].body,
      /@everyone|<script>|Previous success|\| Vue/,
    );
    assert.ok(!f.writes[0].body.includes(baseline));
    assert.ok(f.writes[0].body.length < 500);
  }
});
