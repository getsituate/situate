import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export const RELEASE_REPOSITORY = "getsituate/situate";

export function assertReleaseRepository(repository) {
  assert.equal(repository, RELEASE_REPOSITORY, "Unexpected release repository");
}

function assertGitHubId(value) {
  assert(
    Number.isSafeInteger(value) && value > 0,
    "Expected exact positive GitHub ID",
  );
}

export function githubAdapter({
  execute = execFileSync,
  environment = process.env,
} = {}) {
  const env = Object.fromEntries(
    ["PATH", "HOME", "GH_TOKEN", "GITHUB_TOKEN", "GH_CONFIG_DIR", "LANG"]
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
  const api = (
    repository,
    path,
    {
      method = "GET",
      body,
      binary = false,
      paginate = false,
      hostname = "api.github.com",
    } = {},
  ) => {
    assertReleaseRepository(repository);
    const args = [
      "api",
      "--hostname",
      hostname,
      ...(paginate ? ["--paginate", "--slurp"] : []),
      "--method",
      method,
      "-H",
      `Accept: ${binary ? "application/octet-stream" : "application/vnd.github+json"}`,
      path,
    ];
    if (body !== undefined) args.push("--input", "-");
    return execute("gh", args, {
      env,
      input: body === undefined ? undefined : JSON.stringify(body),
      encoding: binary ? undefined : "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  };
  const json = (repo, path, options) => JSON.parse(api(repo, path, options));
  return {
    async getRelease(repo, id) {
      assertGitHubId(id);
      return json(repo, `repos/${repo}/releases/${id}`);
    },
    async listReleases(repo) {
      return json(repo, `repos/${repo}/releases?per_page=100`, {
        paginate: true,
      }).flat();
    },
    async getTag(repo, tag) {
      const ref = json(
        repo,
        `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
      );
      assert.equal(
        ref.object.type,
        "tag",
        "Release reservation must be annotated",
      );
      const object = json(repo, `repos/${repo}/git/tags/${ref.object.sha}`);
      assert.equal(
        object.object.type,
        "commit",
        "Reservation must point directly to a commit",
      );
      return {
        tag,
        tagObject: ref.object.sha,
        sourceRevision: object.object.sha,
        message: object.message,
      };
    },
    async downloadAsset(repo, releaseId, assetId) {
      assertGitHubId(releaseId);
      assertGitHubId(assetId);
      const release = await this.getRelease(repo, releaseId);
      assert(
        release.assets.some((asset) => asset.id === assetId),
        "Asset does not belong to release",
      );
      return api(repo, `repos/${repo}/releases/assets/${assetId}`, {
        binary: true,
      });
    },
    async createDraft(repo, body) {
      return json(repo, `repos/${repo}/releases`, { method: "POST", body });
    },
    async uploadAsset(repo, releaseId, name, bytes) {
      assertReleaseRepository(repo);
      assertGitHubId(releaseId);
      return JSON.parse(
        execute(
          "gh",
          [
            "api",
            "--hostname",
            "uploads.github.com",
            "--method",
            "POST",
            "-H",
            "Content-Type: application/octet-stream",
            `repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
            "--input",
            "-",
          ],
          {
            env,
            input: bytes,
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ),
      );
    },
    async finalize(repo, releaseId) {
      assertGitHubId(releaseId);
      return json(repo, `repos/${repo}/releases/${releaseId}`, {
        method: "PATCH",
        body: { draft: false, make_latest: "false" },
      });
    },
    async getRun(repo, runId) {
      assertGitHubId(runId);
      return json(repo, `repos/${repo}/actions/runs/${runId}`);
    },
    async getWorkflow(repo, workflowId) {
      assertGitHubId(workflowId);
      return json(repo, `repos/${repo}/actions/workflows/${workflowId}`);
    },
  };
}

export function readOnlyGitHubAdapter(options) {
  const adapter = githubAdapter(options);
  return Object.fromEntries(
    [
      "getRelease",
      "listReleases",
      "getTag",
      "downloadAsset",
      "getRun",
      "getWorkflow",
    ].map((name) => [name, adapter[name].bind(adapter)]),
  );
}
