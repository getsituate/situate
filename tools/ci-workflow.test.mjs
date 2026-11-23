import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { laneHosts } from "./actions-adapter.mjs";

const read = (name) =>
  readFileSync(
    new URL(`../.github/workflows/${name}.yml`, import.meta.url),
    "utf8",
  );
const pipelineWorkflows = [
  "verify",
  "deploy-website",
  "release-macos",
  "publish-macos",
  "dependency-monitoring",
  "diagnostics",
  "verify-hosting",
  "deploy-hosting",
  "sonarcloud",
];
function job(workflow, id) {
  const body = workflow.match(
    new RegExp(`\\n  ${id}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:|$)`),
  )?.[1];
  assert.ok(body, `Missing job ${id}`);
  return body;
}

test("workflows use the shared CLI and pinned checkout, cache and evidence actions", () => {
  assert.deepEqual(
    readdirSync(new URL("../.github/workflows/", import.meta.url)).sort(),
    [...pipelineWorkflows, "notify-slack", "slack-notify"]
      .map((name) => `${name}.yml`)
      .sort(),
  );
  assert.equal(
    existsSync(new URL("../.github/actions", import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL("../.github/disabled-workflows", import.meta.url)),
    false,
  );
  for (const name of pipelineWorkflows) {
    const workflow = read(name);
    const allowed = new Set([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      ...(name === "release-macos"
        ? [
            "actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
            "actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
          ]
        : []),
      ...(["deploy-hosting", "verify-hosting"].includes(name)
        ? ["hashicorp/setup-terraform@b9cd54a3c349d3f38e8881555d616ced269862dd"]
        : []),
      ...(name === "deploy-website"
        ? ["actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9"]
        : []),
      ...(name === "verify"
        ? [
            "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
            "actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8",
          ]
        : []),
    ]);
    if (["publish-macos", "release-macos"].includes(name))
      allowed.add("./.github/workflows/slack-notify.yml");
    if (name === "sonarcloud")
      allowed.add(
        "SonarSource/sonarqube-scan-action@59202af334b4ba7b5db01b701b8e79f8b3bef0f4",
      );
    for (const match of workflow.matchAll(/uses: (\S+)/g))
      assert(allowed.has(match[1]), match[1]);
    for (const step of workflow.split(/\n {6}- /).slice(1))
      if (step.includes("continue-on-error: true"))
        assert.match(step, /release-build-cache\.mjs|actions\/cache\//);
    assert.doesNotMatch(workflow, /run: \||run: >|pull_request_target/);
    for (const match of workflow.matchAll(/run: ([^\n]+)/g))
      assert.match(
        match[1],
        name === "deploy-hosting" &&
          match[1].includes("infrastructure/production/")
          ? /^(?:node infrastructure\/production\/immutable\/continuous-deploy\.mjs|(?:timeout --signal=TERM --kill-after=30s 24m )?python3 -B infrastructure\/production\/immutable\/github-rehearsal\.py(?: cleanup)?)$/
          : name === "deploy-website"
            ? /^(?:node tools\/wait-for-hosting\.mjs(?: --check)?|python3 tools\/pipeline-bootstrap\.py|node website\/site\.mjs --build|python3 tools\/pipeline-container\.py website prepared website\/dist|python3 infrastructure\/production\/immutable\/website_content\.py deploy website\/dist "\$WEBSITE_SOURCE_REVISION")$/
            : name === "verify-hosting" && match[1].startsWith("terraform ")
              ? /^terraform -chdir=infrastructure\/production\/terraform (?:init -backend=false -input=false -lockfile=readonly|validate)$/
              : /^(?:python3 tools\/pipeline-(?:bootstrap|container)\.py|node tools\/[a-z-]+\.mjs)(?: [a-z-]+)*(?: --[a-z-]+(?: [a-z-]+)?)*$/,
      );
    assert.match(workflow, /persist-credentials: false/);
    for (const body of workflow
      .split(/\n {2}[a-z][a-z-]*:\n/)
      .slice(1)
      .filter((body) => body.includes("    steps:"))) {
      if (name === "deploy-hosting" && body.includes("github-rehearsal.py")) {
        assert.ok(
          body.indexOf("run: python3 tools/pipeline-bootstrap.py") >= 0,
        );
        assert.ok(
          body.indexOf("run: python3 tools/pipeline-bootstrap.py") <
            body.indexOf("github-rehearsal.py"),
        );
        assert.match(body, /environment: hosting-rehearsal/);
        assert.doesNotMatch(
          body,
          /HOSTING_(?:OPERATOR|PUBLISHER|HOST_CA)_KEY|secrets\.HCLOUD_TOKEN|TF_TOKEN/,
        );
      } else if (body.includes("run: node ")) {
        assert.ok(body.includes("run: python3 tools/pipeline-bootstrap.py"));
        assert.ok(
          body.indexOf("run: python3 tools/pipeline-bootstrap.py") <
            body.indexOf("run: node "),
        );
      } else {
        assert.match(body, /run: python3 tools\/pipeline-container\.py/);
      }
    }
    const otherJobs = ["verify", "release-macos"].includes(name)
      ? workflow.replace(job(workflow, "macos-compatibility"), "")
      : workflow;
    assert.doesNotMatch(otherJobs, /runs-on: macos-1[0-9]/);
    assert.doesNotMatch(workflow, /runs-on: windows|--target.*(?:ios|android)/);
  }
});

test("macOS delivery has no hosted checkpoint recovery workflow", () => {
  for (const workflow of ["release-recovery", "release-launch-trace"])
    assert.equal(
      existsSync(
        new URL(`../.github/workflows/${workflow}.yml`, import.meta.url),
      ),
      false,
    );
});

test("fixed independent families depend on planning and aggregate every selected receipt", () => {
  for (const name of ["verify", "release-macos"]) {
    const workflow = read(name);
    assert.doesNotMatch(
      workflow.split("\n  create:")[0],
      /secrets\.|actions: write|contents: write|packages: write|ACTIONS_RUNTIME/,
    );
    assert.match(
      job(workflow, "plan"),
      /outputs:[\s\S]*plan:.*steps\.plan\.outputs\.plan[\s\S]*digest:/,
    );
    for (const [id, host] of Object.entries(laneHosts)) {
      const lane = job(workflow, id);
      assert.match(lane, /needs: plan\n/);
      const runner =
        id === "macos-compatibility"
          ? "macos-15-intel"
          : host === "macos"
            ? "macos-latest"
            : "ubuntu-24.04";
      assert.ok(lane.includes(`runs-on: ${runner}\n`));
      if (id === "macos-compatibility")
        assert.match(
          lane,
          /DEVELOPER_DIR: \/Applications\/Xcode_26\.3\.app\/Contents\/Developer/,
        );
      assert.ok(lane.includes(`.lanes.*.id, '${id}')`));
      assert.match(lane, /receipt:.*steps\.lane\.outputs\.receipt/);
      assert.match(lane, /PIPELINE_PLAN_DIGEST:.*needs\.plan\.outputs\.digest/);
      assert.match(lane, /PIPELINE_PLAN:.*needs\.plan\.outputs\.plan/);
      assert.match(lane, /ref:.*github\.sha/);
      assert.doesNotMatch(lane, /needs: \[/);
      if (host === "macos" || id === "docker-integration") {
        assert.ok(
          lane.indexOf("actions-adapter.mjs setup") <
            lane.indexOf("actions-adapter.mjs lane"),
        );
        assert.match(lane, /pipeline-bootstrap\.py/);
      } else {
        assert.ok(
          lane.includes(
            `pipeline-container.py actions lane --workflow ${name === "verify" ? "verify" : "create"} --lane ${id}\n`,
          ),
        );
        assert.doesNotMatch(
          lane,
          /pipeline-bootstrap|run: node |actions-adapter\.mjs setup/,
        );
      }
    }
    const aggregate = job(workflow, "required");
    assert.match(
      aggregate,
      name === "verify"
        ? /if: always\(\)/
        : /needs\.plan\.outputs\.enabled == 'true'/,
    );
    for (const consumer of [
      aggregate,
      ...(name === "release-macos" ? [job(workflow, "create")] : []),
    ]) {
      for (const id of Object.keys(laneHosts)) {
        assert.ok(consumer.split("    if:")[0].includes(`        ${id},\n`));
        for (const line of consumer.match(/PIPELINE_NEEDS:.*$/gm) ?? [])
          assert.ok(line.includes(`toJSON(needs.${id})`));
      }
    }
    assert.match(aggregate, /PIPELINE_NEEDS:.*format\(/);
    assert.match(aggregate, /toJSON\(needs\.plan\.result\)/);
    assert.doesNotMatch(aggregate, /toJSON\(needs\)/);
    assert.match(aggregate, /pipeline-container\.py actions aggregate/);
  }
});

test("native source jobs declare one build slot in both PR and release verification", () => {
  for (const workflow of ["verify", "release-macos"])
    for (const id of ["macos-native", "macos-compatibility"])
      assert.match(job(read(workflow), id), /SITUATE_TOOL_BUILD_SLOTS: "1"/);
});

test("the Intel release job has more time for cold compilation than PR verification", () => {
  assert.match(
    job(read("release-macos"), "macos-compatibility"),
    /^ {4}timeout-minutes: 75$/m,
  );
  assert.match(
    job(read("verify"), "macos-compatibility"),
    /^ {4}timeout-minutes: 60$/m,
  );
});

test("only the release Intel lane persists its compiler cache after success and flush", () => {
  const intel = job(read("release-macos"), "macos-compatibility");
  assert.match(intel, /SITUATE_RELEASE_CACHE_SCOPE: intel-compatibility/);
  for (const step of ["prepare", "plan", "start", "report"])
    assert.match(
      intel,
      new RegExp(`run: node tools/release-build-cache.mjs ${step}`),
    );
  assert.match(
    intel,
    /SITUATE_SCCACHE: .*steps\.cache_start\.outputs\.ready == 'true'/,
  );
  assert.match(
    intel,
    /steps\.lane\.outcome == 'success' && steps\.cache_report\.outputs\.flushed == 'true'/,
  );
  assert.doesNotMatch(
    job(read("verify"), "macos-compatibility"),
    /release-build-cache|actions\/cache/,
  );
});

test("source reuse controllers can read merged pull-request associations", () => {
  const text = read("release-macos");
  for (const id of [
    "frontend",
    "rust",
    "macos-code",
    "browser",
    "browser-webkit",
    "macos-native",
  ]) {
    const body = job(text, id);
    assert.match(body, /pull-requests: read/);
    assert.match(body, /attestations: read/);
    assert.match(body, /actions: read/);
    assert.doesNotMatch(body, /(?:pull-requests|attestations|actions): write/);
    assert.match(body, /source-reuse --workflow create/);
  }
});

test("source attestation binds the exact digest without interpreting an external relative path as a glob", () => {
  const required = job(read("verify"), "required");
  assert.match(
    required,
    /subject-digest: sha256:\$\{\{ steps\.evidence\.outputs\.sha256 \}\}/,
  );
  assert.match(required, /subject-name: evidence\.json/);
  assert.doesNotMatch(required, /subject-path:/);
  assert.match(
    required,
    /path: \$\{\{ runner\.temp \}\}\/source-verification-\$\{\{ github\.run_attempt \}\}\/evidence\.json/,
  );
  assert.ok(
    required.indexOf("source-evidence --workflow") <
      required.indexOf("actions/attest-build-provenance"),
  );
  assert.ok(
    required.indexOf("actions/upload-artifact") <
      required.indexOf("source-evidence-check --workflow"),
  );
});

test("PR check covers draft, ready, fork and merge-queue events without path filtering or secrets", () => {
  const workflow = read("verify");
  assert.match(workflow, /ready_for_review, converted_to_draft/);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /name: PR verification/);
  assert.doesNotMatch(
    workflow,
    /paths:|paths-ignore:|secrets\.|environment:|schedule:|push:/,
  );
});

test("creator can follow a successful aggregate when unselected lanes were skipped", () => {
  const creator = job(read("release-macos"), "create");
  assert.match(
    creator,
    /if: \$\{\{ !cancelled\(\) && needs\.plan\.outputs\.enabled == 'true' && needs\.required\.result == 'success' && needs\.hosting-ready\.result == 'success' && needs\.plan\.outputs\.app_impact == 'true' \}\}/,
  );
});

test("macOS release serializes planning through automatic publication and keeps only one pending push", () => {
  const workflow = read("release-macos"),
    publisher = read("publish-macos");
  assert.match(
    workflow.split("jobs:")[0],
    /^concurrency:\n {2}group: situate-release-create\n {2}cancel-in-progress: false$/m,
  );
  assert.match(job(workflow, "publish"), /needs: create/);
  assert.match(
    job(workflow, "publish"),
    /if: \$\{\{ !cancelled\(\) && needs\.create\.result == 'success' \}\}/,
  );
  assert.match(
    job(workflow, "publish"),
    /PIPELINE_RELEASE_ID: \$\{\{ needs\.create\.outputs\.release_id \}\}/,
  );
  assert.match(
    job(workflow, "create"),
    /release_id: \$\{\{ steps\.github_release\.outputs\.release_id \}\}/,
  );
  assert.match(publisher, /workflow_dispatch:/);
  assert.doesNotMatch(publisher, /workflow_run:|workflow_call:/);
  for (const effect of [
    job(workflow, "create"),
    job(workflow, "publish"),
    job(publisher, "publish"),
  ]) {
    assert.match(effect, /group: situate-release-effects/);
    assert.match(effect, /cancel-in-progress: false/);
  }
});

test("paused releases skip planning and source work", () => {
  const workflow = read("release-macos");
  const plan = job(workflow, "plan");
  assert.match(plan, /environment: macos-release/);
  assert.match(plan, /release-selection --workflow create/);
  assert.match(plan, /PIPELINE_RELEASE_ENABLED:.*vars\.MACOS_RELEASE_ENABLED/);
  assert.match(plan, /if: steps\.selection\.outputs\.enabled == 'true'/);
  for (const id of Object.keys(laneHosts)) {
    assert.match(job(workflow, id), /needs\.plan\.outputs\.enabled == 'true'/);
    assert.doesNotMatch(job(workflow, id), /concurrency:/);
  }
});

test("hosting waiters can read producer runs without production write permissions", () => {
  for (const [workflow, id] of [
    ["deploy-website", "website"],
    ["release-macos", "hosting-ready"],
  ]) {
    const body = job(read(workflow), id);
    assert.match(
      body,
      /run: node tools\/wait-for-hosting\.mjs(?: --release)?\n/,
    );
    assert.match(body, /permissions:\n {6}actions: read\n/);
    assert.match(body, /^ {6}deployments: read$/m);
    assert.doesNotMatch(body, /(?:actions|contents|deployments): write/);
  }
});

test("website publication checks verified hosting independently of the hosting run", () => {
  const workflow = read("deploy-website");
  assert.match(workflow, /push:\n {4}branches: \[main\]/);
  assert.doesNotMatch(workflow, /workflow_run/);
  const body = job(workflow, "website");
  assert.match(body, /github.ref == 'refs\/heads\/main'/);
  assert.match(body, /environment: website-production/);
  assert.ok(
    body.indexOf("wait-for-hosting.mjs --check") <
      body.indexOf("website_content.py deploy"),
  );
  assert.deepEqual(
    [...body.matchAll(/secrets\.([A-Z_]+)/g)].map((match) => match[1]),
    ["WEBSITE_CONTENT_SSH_KEY"],
  );
});

test("the Slack failure notifier observes repository workflows on main", () => {
  const workflow = read("notify-slack");
  const sources = workflow.match(/workflows:\n([\s\S]*?)\n {4}types:/)?.[1];
  assert.ok(sources);
  assert.deepEqual(
    Array.from(sources.matchAll(/^ {6}- (.+)$/gm), ([, name]) => name).sort(),
    [
      ...pipelineWorkflows.map((name) => read(name).match(/^name: (.+)$/m)[1]),
      "Dependabot Updates",
    ].sort(),
  );
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /conclusion == 'failure'/);
  assert.match(workflow, /"pull_request","pull_request_target","merge_group"/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/slack-notify\.yml/);
  assert.match(workflow, /secrets\.SLACK_FAILURE_WEBHOOK_URL/);
});

test("automatic publication uses the same protected job as manual recovery", () => {
  const manual = job(read("publish-macos"), "publish");
  const automatic = job(read("release-macos"), "publish");
  assert.match(automatic, /^ {4}environment: macos-publication$/m);
  assert.doesNotMatch(automatic, /^ {4}uses:/m);
  assert.equal(
    automatic
      .replace(/^ {4}needs: create\n/m, "")
      .replace(/^ {4}if: .+\n/m, "")
      .replace("needs.create.outputs.release_id", "inputs.release_id"),
    manual.replace(/^ {4}if: .+\n/m, ""),
  );
  assert.equal(
    job(read("release-macos"), "notify-release"),
    job(read("publish-macos"), "notify-release"),
  );
});

test("the Slack changelog only follows a successful promotion of a selected release", () => {
  const workflow = read("publish-macos");
  const publish = job(workflow, "publish");
  const notify = job(workflow, "notify-release");
  assert.match(
    publish,
    /published_release_id: .*steps\.promote\.outcome == 'success' && steps\.plan\.outputs\.release_id/,
  );
  assert.match(
    publish,
    /id: promote\s+run: node tools\/actions-adapter\.mjs publish-run --workflow publish\s+if: steps\.plan\.outputs\.selected == 'true'/,
  );
  assert.match(notify, /needs: publish/);
  assert.doesNotMatch(notify, /vars\./);
  assert.match(notify, /needs\.publish\.outputs\.published_release_id != ''/);
  assert.match(
    notify,
    /release_id: .*needs\.publish\.outputs\.published_release_id/,
  );
  assert.match(notify, /uses: \.\/\.github\/workflows\/slack-notify\.yml/);
  assert.match(notify, /secrets\.SLACK_RELEASE_WEBHOOK_URL/);
  assert.doesNotMatch(publish, /SLACK_.*WEBHOOK/);
});

test("Slack notifications skip message composition and delivery without a webhook", () => {
  const notifier = read("slack-notify");
  assert.match(notifier, /SLACK_WEBHOOK_URL: .*secrets\.webhook_url/);
  assert.match(
    notifier,
    /\[\[ -n "\$SLACK_WEBHOOK_URL" \]\][\s\S]*?echo "configured=true" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    notifier,
    /id: message\s+if: steps\.webhook\.outputs\.configured == 'true'/,
  );
  assert.match(notifier, /id: post\s+if: steps\.message\.outcome == 'success'/);
});

test("Slack release notes show headings without exposing release metadata", (t) => {
  const notifier = read("slack-notify");
  const filter = notifier.match(
    /jq -e --arg id .*? '\n([\s\S]*?)' > "\$payload"/,
  )?.[1];
  assert.ok(filter);
  const marker = `<!-- situate-release:${"A".repeat(1500)}= -->`;
  const bodies = [
    `## Features\n\n### Chat dictation\n\nTranscribe on your Mac.\n\n## Changes\n\n### Plugins\n\nKeep <@U123> & *text* literal.\n\n${marker}`,
    `\r\n${marker}\r\n`,
    `## Fixes\n\n${"x".repeat(1500)}\n\n${marker}`,
  ];
  const result = spawnSync(
    "jq",
    [
      "-ce",
      "--arg",
      "id",
      "12",
      "--arg",
      "url",
      "https://github.com/example/app/releases/tag/",
      filter,
    ],
    {
      encoding: "utf8",
      input: bodies
        .map((body) =>
          JSON.stringify({
            id: 12,
            draft: false,
            published_at: "2026-11-10T00:00:00Z",
            tag_name: "v2026.11.10",
            body,
          }),
        )
        .join("\n"),
    },
  );
  if (result.error?.code === "ENOENT") return t.skip("jq is not installed");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /situate-release:/);
  const [formatted, empty, long] = result.stdout
    .trim()
    .split("\n")
    .map(JSON.parse);
  const notes = formatted.blocks[1].elements[0].elements;
  assert.deepEqual(
    notes.filter(({ style }) => style?.bold).map(({ text }) => text),
    ["Features", "• Chat dictation", "Changes", "• Plugins"],
  );
  assert.equal(
    notes.map(({ text }) => text).join(""),
    "Features\n\n• Chat dictation\nTranscribe on your Mac.\n\nChanges\n\n• Plugins\nKeep <@U123> & *text* literal.",
  );
  assert.equal(empty.blocks.length, 2);
  assert.equal(
    formatted.blocks.at(-1).text.text,
    "<https://github.com/example/app/releases/tag/v2026.11.10|View release on GitHub>",
  );
  assert.match(long.blocks[1].elements[0].elements.at(-1).text, /^x+…$/);
});

test("macOS release checks verified hosting before starting release effects", () => {
  const workflow = read("release-macos");
  const hosting = job(workflow, "hosting-ready");
  assert.match(hosting, /needs: plan/);
  assert.match(hosting, /deployments: read/);
  assert.match(hosting, /run: node tools\/wait-for-hosting\.mjs --release/);
  assert.doesNotMatch(hosting, /secrets\.|contents: write/);
  assert.match(job(workflow, "create"), /needs:[\s\S]*hosting-ready,/);
});

test("creator and publisher have gated execution paths with signing scoped to build only", () => {
  const creator = job(read("release-macos"), "create");
  assert.match(creator, /app_impact == 'true'/);
  assert.match(creator, /contents: write/);
  assert.match(creator, /create-prepare/);
  assert.ok(
    creator.indexOf("prepare-release") <
      creator.indexOf("create-stage --stage build"),
  );
  for (const stage of ["inputs", "build", "qualify", "github"])
    assert.ok(creator.includes(`create-stage --stage ${stage}`));
  const build = creator
    .split("run: node tools/actions-adapter.mjs create-stage --stage build")[1]
    .split("      - run:")[0];
  assert.match(build, /APPLE_DEVELOPER_ID_P12_BASE64/);
  assert.doesNotMatch(
    creator.split("create-stage --stage build")[0],
    /APPLE_DEVELOPER_ID_P12_BASE64/,
  );
  assert.equal(
    (creator.match(/APPLE_DEVELOPER_ID_P12_BASE64:/g) ?? []).length,
    1,
  );
  assert.match(build, /APPLE_API_PRIVATE_KEY/);
  assert.match(build, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(
    build,
    /SITUATE_POSTHOG_TOKEN: \$\{\{ vars\.SITUATE_POSTHOG_TOKEN \}\}/,
  );
  assert.match(
    read("deploy-website"),
    /SITUATE_POSTHOG_TOKEN: \$\{\{ vars\.SITUATE_POSTHOG_TOKEN \}\}/,
  );
  assert.equal((creator.match(/SITUATE_POSTHOG_TOKEN:/g) ?? []).length, 1);
  assert.doesNotMatch(
    creator.split("create-stage --stage qualify")[1],
    /APPLE_|TAURI_SIGNING/,
  );
  for (const name of ["release-macos", "publish-macos"])
    assert.match(read(name), /actions-adapter\.mjs release-gate/);
  const publisher = read("publish-macos");
  assert.match(
    publisher,
    /PIPELINE_RELEASE_ID: \$\{\{ inputs\.release_id \}\}/,
  );
  assert.match(job(publisher, "publish"), /environment: macos-publication/);
  assert.match(publisher, /github\.repository == 'getsituate\/situate'/);
  assert.match(publisher, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(creator, /PIPELINE_REQUIRE_LATEST_MAIN/);
  assert.match(publisher, /publish-prepare --workflow publish/);
  assert.match(publisher, /publish-run --workflow publish/);
  assert.match(job(publisher, "publish"), /runs-on: macos-latest/);
  assert.match(publisher, /APPLE_TEAM_ID:.*vars\.APPLE_TEAM_ID/);
  assert.doesNotMatch(
    creator.split("run: node tools/wait-for-hosting.mjs --probe")[0],
    /SITUATE_RELEASE_SSH_PRIVATE_KEY|SITUATE_RELEASE_SSH_KNOWN_HOSTS/,
  );
  const qualification = creator
    .split("create-stage --stage qualify")[1]
    .split("\n      - ")[0];
  assert.match(qualification, /SITUATE_RELEASE_SSH_PRIVATE_KEY/);
  assert.match(qualification, /SITUATE_RELEASE_SSH_KNOWN_HOSTS/);
  assert.doesNotMatch(
    qualification,
    /APPLE_API_|TAURI_SIGNING|GH_TOKEN|SSH_AUTH_SOCK/,
  );
  assert.ok(
    creator.indexOf("node tools/actions-adapter.mjs desktop") <
      creator.indexOf("create-prepare"),
  );
  assert.equal(
    (creator.match(/SITUATE_RELEASE_SSH_PRIVATE_KEY:/g) ?? []).length,
    7,
  );
  assert.equal(
    (
      publisher.match(/SITUATE_RELEASE_SSH_PRIVATE_KEY: \$\{\{ secrets\./g) ??
      []
    ).length,
    2,
  );
  assert.doesNotMatch(
    publisher,
    /releases\/latest|--release-id latest|APPLE_API_|APPLE_DEVELOPER_ID_|APPLE_MACOS_SIGNING|TAURI_SIGNING|contents: write|packages: write/,
  );
});

test("release environments use the same secret names and formats as local configuration", () => {
  for (const name of ["release-macos", "publish-macos"]) {
    const workflow = read(name);
    for (const [, target, secret] of workflow.matchAll(
      /([A-Z][A-Z_]+): \$\{\{ secrets\.([A-Z][A-Z_]+) \}\}/g,
    ))
      assert.equal(target, secret, `${name}: ${target}`);
    for (const canonical of [
      "SITUATE_RELEASE_CONFIG_JSON",
      "SITUATE_RELEASE_SSH_PRIVATE_KEY",
      "SITUATE_RELEASE_SSH_KNOWN_HOSTS",
    ])
      assert.ok(
        workflow.includes(`${canonical}: \${{ secrets.${canonical} }}`),
      );
    for (const canonical of [
      "SITUATE_RELEASE_CONFIG_SHA256",
      "WEBSITE_DEPLOY_HOST",
    ])
      assert.ok(workflow.includes(`${canonical}: \${{ vars.${canonical} }}`));
    assert.doesNotMatch(
      workflow,
      /MACOS_(?:RELEASE|PUBLICATION)_(?:CONFIGURATION|SSH|DESTINATION)/,
    );
  }
});

test("signing diagnostics use a separate trusted-main job with certificate-only credentials", () => {
  const workflow = read("diagnostics");
  assert.match(
    workflow,
    /options:\s+\[coverage, design, visual, provider, signing, qualification-route\]/,
  );
  assert.match(job(workflow, "native"), /inputs\.selection != 'signing'/);
  const signing = job(workflow, "signing");
  for (const guard of [
    "github.repository == 'getsituate/situate'",
    "github.ref == 'refs/heads/main'",
    "github.event_name == 'workflow_dispatch'",
    "inputs.selection == 'signing'",
  ])
    assert.ok(signing.includes(guard));
  assert.match(signing, /runs-on: macos-latest/);
  assert.match(signing, /environment: macos-release/);
  assert.match(signing, /timeout-minutes: 10/);
  assert.match(signing, /ref:.*github\.sha/);
  assert.match(
    signing,
    /run: node tools\/actions-adapter\.mjs diagnostics --lane signing/,
  );
  assert.match(signing, /DIAGNOSTIC_TARGET: native/);
  assert.match(
    signing,
    /APPLE_DEVELOPER_ID_P12_BASE64:.*secrets\.APPLE_DEVELOPER_ID_P12_BASE64/,
  );
  assert.match(
    signing,
    /APPLE_DEVELOPER_ID_P12_PASSWORD:.*secrets\.APPLE_DEVELOPER_ID_P12_PASSWORD/,
  );
  assert.match(signing, /APPLE_TEAM_ID:.*secrets\.APPLE_TEAM_ID/);
  assert.match(
    signing,
    /APPLE_MACOS_SIGNING_IDENTITY:.*secrets\.APPLE_MACOS_SIGNING_IDENTITY/,
  );
  assert.doesNotMatch(
    signing,
    /APPLE_API_|TAURI_SIGNING|GH_TOKEN|SSH|PAID_|contents: write|packages: write|create-stage|publish-run/,
  );
});

test("qualification route diagnostics use protected hosted dispatch and only SSH/configuration credentials", () => {
  const workflow = read("diagnostics");
  const route = job(workflow, "qualification-route");
  for (const guard of [
    "github.repository == 'getsituate/situate'",
    "github.ref == 'refs/heads/main'",
    "github.event_name == 'workflow_dispatch'",
    "inputs.selection == 'qualification-route'",
  ])
    assert(route.includes(guard));
  assert.match(
    job(workflow, "native"),
    /inputs\.selection != 'qualification-route'/,
  );
  assert.match(route, /runs-on: macos-latest/);
  assert.match(route, /environment: macos-release/);
  assert.match(route, /timeout-minutes: 10/);
  assert.match(route, /ref:.*github\.sha/);
  assert.match(route, /diagnostics --lane qualification-route/);
  for (const name of [
    "SITUATE_RELEASE_CONFIG_JSON",
    "SITUATE_RELEASE_SSH_PRIVATE_KEY",
    "SITUATE_RELEASE_SSH_KNOWN_HOSTS",
  ])
    assert(route.includes(`secrets.${name}`));
  assert.doesNotMatch(
    route,
    /APPLE_|TAURI_SIGNING|GH_TOKEN|PAID_|contents: write|packages: write|create-stage|publish-run/,
  );
});
