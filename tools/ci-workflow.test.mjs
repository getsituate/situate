import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { laneHosts } from "./actions-adapter.mjs";

const read = (name) =>
  readFileSync(
    new URL(`../.github/workflows/${name}.yml`, import.meta.url),
    "utf8",
  );
const names = [
  "verify",
  "release-macos",
  "publish-macos",
  "dependency-monitoring",
  "ci-tool-image",
  "diagnostics",
  "release-recovery",
];
function job(workflow, id) {
  const body = workflow.match(
    new RegExp(`\\n  ${id}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:|$)`),
  )?.[1];
  assert.ok(body, `Missing job ${id}`);
  return body;
}

test("only replacement workflows remain and pinned checkout is the sole action", () => {
  assert.deepEqual(
    readdirSync(new URL("../.github/workflows/", import.meta.url)).sort(),
    names.map((name) => `${name}.yml`).sort(),
  );
  assert.equal(
    existsSync(new URL("../.github/actions", import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL("../.github/disabled-workflows", import.meta.url)),
    false,
  );
  for (const name of names) {
    const workflow = read(name);
    for (const match of workflow.matchAll(/uses: (\S+)/g))
      assert.match(match[1], /^actions\/checkout@[a-f0-9]{40}$/);
    assert.doesNotMatch(
      workflow,
      /run: \||run: >|continue-on-error|pull_request_target/,
    );
    for (const match of workflow.matchAll(/run: ([^\n]+)/g))
      assert.match(
        match[1],
        /^(?:python3 tools\/pipeline-(?:bootstrap|container)\.py|node tools\/[a-z-]+\.mjs)(?: [a-z-]+)*(?: --[a-z-]+ [a-z-]+)*$/,
      );
    assert.match(workflow, /persist-credentials: false/);
    for (const body of workflow
      .split(/\n {2}[a-z][a-z-]*:\n/)
      .slice(1)
      .filter((body) => body.includes("    steps:"))) {
      if (body.includes("run: node ")) {
        assert.ok(body.includes("run: python3 tools/pipeline-bootstrap.py"));
        assert.ok(
          body.indexOf("run: python3 tools/pipeline-bootstrap.py") <
            body.indexOf("run: node "),
        );
      } else {
        assert.match(body, /run: python3 tools\/pipeline-container\.py/);
      }
    }
    assert.doesNotMatch(
      workflow,
      /runs-on: (?:windows|macos-1[0-9])|--target.*(?:ios|android)/,
    );
  }
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
      assert.match(
        lane,
        new RegExp(
          `runs-on: ${host === "macos" ? "macos-latest" : "ubuntu-24.04"}`,
        ),
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
        assert.match(lane, /pipeline-container\.py actions lane/);
        assert.doesNotMatch(
          lane,
          /pipeline-bootstrap|run: node |actions-adapter\.mjs setup/,
        );
      }
    }
    const aggregate = job(workflow, "required");
    assert.match(aggregate, /if: always\(\)/);
    for (const id of Object.keys(laneHosts))
      assert.ok(aggregate.split("    if:")[0].includes(id));
    assert.match(aggregate, /PIPELINE_NEEDS:.*toJSON\(needs\)/);
    assert.match(aggregate, /pipeline-container\.py actions aggregate/);
  }
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
    .split(
      "      - run: node tools/actions-adapter.mjs create-stage --stage build",
    )[1]
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
  assert.doesNotMatch(
    creator.split("create-stage --stage qualify")[1],
    /APPLE_|TAURI_SIGNING/,
  );
  for (const name of ["release-macos", "publish-macos"])
    assert.match(read(name), /actions-adapter\.mjs release-gate/);
  assert.match(
    read("release-recovery"),
    /run: node tools\/actions-adapter\.mjs recovery/,
  );
  const publisher = read("publish-macos");
  assert.match(publisher, /workflow_run:[\s\S]*workflows: \[Release macOS\]/);
  assert.match(publisher, /release_id:/);
  assert.match(
    publisher,
    /head_repository\.full_name == 'getsituate\/situate'/,
  );
  assert.match(publisher, /head_branch == 'main'/);
  assert.match(publisher, /publish-prepare --workflow publish/);
  assert.match(publisher, /publish-run --workflow publish/);
  assert.match(job(publisher, "publish"), /runs-on: macos-latest/);
  assert.match(publisher, /APPLE_TEAM_ID:.*vars\.APPLE_TEAM_ID/);
  assert.doesNotMatch(
    creator.split("create-prepare")[0],
    /SITUATE_RELEASE_SSH_PRIVATE_KEY|SITUATE_RELEASE_SSH_KNOWN_HOSTS/,
  );
  const qualification = creator
    .split("create-stage --stage qualify")[1]
    .split("create-stage --stage github")[0];
  assert.match(qualification, /SITUATE_RELEASE_SSH_PRIVATE_KEY/);
  assert.match(qualification, /SITUATE_RELEASE_SSH_KNOWN_HOSTS/);
  assert.doesNotMatch(
    qualification,
    /APPLE_API_|TAURI_SIGNING|GH_TOKEN|SSH_AUTH_SOCK/,
  );
  assert.ok(
    creator.indexOf("node tools/release-desktop.mjs") <
      creator.indexOf("create-prepare"),
  );
  assert.equal(
    (creator.match(/SITUATE_RELEASE_SSH_PRIVATE_KEY:/g) ?? []).length,
    5,
  );
  assert.equal(
    (publisher.match(/SITUATE_RELEASE_SSH_PRIVATE_KEY:/g) ?? []).length,
    1,
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

test("tool image preserves build/publisher separation and read-only build credentials", () => {
  const workflow = read("ci-tool-image");
  const build = job(workflow, "build");
  const publish = job(workflow, "publish");
  assert.doesNotMatch(
    build.split("actions-adapter.mjs image-upload")[0],
    /secrets\.|GH_TOKEN|packages: write/,
  );
  assert.match(build, /actions-adapter\.mjs image-upload/);
  assert.match(build, /CI_IMAGE_TRANSFER_UPLOAD_SSH_PRIVATE_KEY/);
  assert.doesNotMatch(build, /ACTIONS_RUNTIME|ACTIONS_RESULTS|GH_TOKEN/);
  assert.match(build, /actions-adapter\.mjs image-build/);
  assert.match(publish, /needs: build/);
  assert.match(publish, /packages: write/);
  assert.match(publish, /PROVENANCE:.*needs\.build\.outputs\.provenance/);
  assert.match(publish, /GH_TOKEN:.*github\.token/);
  assert.match(publish, /actions-adapter\.mjs image-publish/);
  const [download, publication] = publish.split(
    "      - run: node tools/actions-adapter.mjs image-publish",
  );
  assert.match(download, /actions-adapter\.mjs image-download/);
  assert.match(download, /CI_IMAGE_TRANSFER_READ_SSH_PRIVATE_KEY/);
  assert.doesNotMatch(download, /GH_TOKEN/);
  assert.doesNotMatch(
    publication,
    /CI_IMAGE_TRANSFER_SSH_PRIVATE_KEY|CI_IMAGE_TRANSFER_SSH_KNOWN_HOSTS/,
  );
  assert.match(workflow, /client\/docker\/ci-\*/);
});
