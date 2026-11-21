import { hostingDigest, revisionPattern } from "./hosting-inputs.mjs";

const repo = "getsituate/situate";
const environment = "hosting-production-operation";
const collection = `https://api.github.com/repos/${repo}/deployments`;
const validDeploymentId = (id) => Number.isSafeInteger(id) && id > 0;

export class HostingReadUnavailable extends Error {}

const retryableRead = ({ status, headers }) =>
  [429, 500, 502, 503, 504].includes(status) ||
  (status === 403 &&
    (headers.get("x-ratelimit-remaining") === "0" ||
      headers.has("retry-after")));

function deploymentsApi(token, fetchImpl) {
  if (typeof token !== "string" || !token.trim())
    throw new Error("GitHub deployments access is required.");
  return async ({ deploymentId, body } = {}) => {
    const url = new URL(collection);
    if (deploymentId !== undefined) {
      if (!validDeploymentId(deploymentId))
        throw new Error("Unexpected GitHub deployment identity.");
      url.pathname += `/${deploymentId}/statuses`;
    }
    if (!body) {
      if (deploymentId === undefined)
        url.searchParams.set("environment", environment);
      url.searchParams.set("per_page", "1");
    }
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body && JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        const ErrorType = body ? Error : HostingReadUnavailable;
        throw new ErrorType(
          "GitHub deployment status request did not complete.",
        );
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new Error("GitHub returned invalid deployment status data.");
        }
      }
      if (body || attempt === 1 || ![502, 503, 504].includes(response.status)) {
        const ErrorType =
          !body && retryableRead(response) ? HostingReadUnavailable : Error;
        throw new ErrorType(
          `GitHub deployment status request failed (${response.status}).`,
        );
      }
    }
  };
}

async function latest(request) {
  const deployments = await request();
  if (!Array.isArray(deployments) || deployments.length > 1)
    throw new Error("Unexpected GitHub deployment inventory.");
  if (!deployments.length) return null;
  const previous = deployments[0];
  if (!validDeploymentId(previous?.id) || previous.environment !== environment)
    throw new Error("Unexpected GitHub deployment identity.");
  const statuses = await request({ deploymentId: previous.id });
  if (!Array.isArray(statuses) || statuses.length > 1)
    throw new Error("Unexpected GitHub deployment status.");
  return { deployment: previous, status: statuses[0] };
}

function readiness(record, revision, digest = hostingDigest) {
  if (!record || record.status?.state === "inactive")
    return { ready: false, reason: "No verified active hosting deployment." };
  const { deployment, status } = record;
  if (status?.state !== "success")
    return {
      ready: false,
      reason: "A production hosting operation is unresolved.",
    };
  if (
    deployment.creator?.login !== "github-actions[bot]" ||
    status.creator?.login !== "github-actions[bot]" ||
    status.environment !== environment ||
    !revisionPattern.test(deployment.sha ?? "")
  )
    throw new Error("The hosting deployment has no trusted success record.");
  if (digest(deployment.sha) !== digest(revision))
    return {
      ready: false,
      reason: "The verified host has different hosting inputs.",
    };
  return { ready: true, revision: deployment.sha, deploymentId: deployment.id };
}

export async function hostingReadiness({
  token,
  revision,
  fetchImpl = fetch,
  digest,
}) {
  const request = deploymentsApi(token, fetchImpl);
  const record = await latest(request);
  const result = readiness(record, revision, digest);
  if (!result.ready) return result;
  // Do not accept the predecessor if a new operation opened during the read.
  const confirmed = await latest(request);
  if (
    confirmed?.deployment.id !== record.deployment.id ||
    confirmed.status?.state !== "success" ||
    confirmed.status?.creator?.login !== "github-actions[bot]"
  )
    return {
      ready: false,
      changed: true,
      reason: "Hosting changed during the readiness check.",
    };
  return result;
}

export async function observeHostingProducer({
  token,
  revision,
  fetchImpl = fetch,
}) {
  if (
    typeof token !== "string" ||
    !token.trim() ||
    !revisionPattern.test(revision ?? "")
  )
    throw new Error("Missing GitHub hosting producer identity.");
  const url = new URL(
    `https://api.github.com/repos/${repo}/actions/workflows/deploy-hosting.yml/runs`,
  );
  url.search = new URLSearchParams({
    branch: "main",
    head_sha: revision,
    per_page: "100",
  });
  let inventory;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      return {
        kind: "unavailable",
        reason: `Cannot read Deploy hosting runs (${response.status}).`,
      };
    inventory = await response.json();
  } catch {
    return { kind: "unavailable", reason: "Cannot read Deploy hosting runs." };
  }
  const runs = inventory?.workflow_runs;
  if (
    !Array.isArray(runs) ||
    runs.length > 100 ||
    runs.length !== inventory.total_count ||
    runs.some(
      (run) =>
        !validDeploymentId(run?.id) ||
        !validDeploymentId(run.run_number) ||
        !validDeploymentId(run.run_attempt) ||
        run.head_sha !== revision ||
        run.head_branch !== "main" ||
        run.head_repository?.full_name !== repo ||
        !["push", "workflow_dispatch"].includes(run.event) ||
        typeof run.status !== "string",
    ) ||
    new Set(runs.map((run) => run.run_number)).size !== runs.length ||
    new Set(runs.map((run) => run.id)).size !== runs.length
  )
    return {
      kind: "unavailable",
      reason:
        "GitHub returned incomplete or unexpected Deploy hosting run data.",
    };
  if (!runs.length) return { kind: "absent" };
  if (runs.some((run) => run.status !== "completed"))
    return { kind: "pending" };
  const latest = runs.reduce((a, b) => (a.run_number > b.run_number ? a : b));
  if (
    !["failure", "cancelled", "timed_out", "startup_failure"].includes(
      latest.conclusion,
    )
  )
    return { kind: "unconfirmed" };
  return {
    kind: "failed",
    runId: latest.id,
    attempt: latest.run_attempt,
    conclusion: latest.conclusion,
  };
}

export function deploymentGate({
  token,
  revision,
  runId,
  fetchImpl = fetch,
  digest = hostingDigest,
}) {
  if (
    typeof token !== "string" ||
    !token.trim() ||
    typeof revision !== "string" ||
    !revisionPattern.test(revision) ||
    typeof runId !== "string" ||
    !/^[1-9][0-9]{0,15}$/.test(runId) ||
    !Number.isSafeInteger(Number(runId))
  )
    throw new Error("Missing GitHub deployment identity.");
  const logUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  const request = deploymentsApi(token, fetchImpl);
  let id;
  async function check() {
    const record = await latest(request);
    if (record && !["success", "inactive"].includes(record.status?.state))
      throw new Error(
        `Deployment ${record.deployment.id} is unresolved. Inspect Terraform, Hetzner and DNS before clearing it manually.`,
      );
    return readiness(record, revision, digest);
  }
  function status(state) {
    return request({
      deploymentId: id,
      body: { state, log_url: logUrl, auto_inactive: false },
    });
  }
  return {
    check,
    async begin() {
      await check();
      const deployment = await request({
        body: {
          ref: revision,
          environment,
          auto_merge: false,
          required_contexts: [],
          production_environment: true,
        },
      });
      if (
        !validDeploymentId(deployment?.id) ||
        deployment.sha !== revision ||
        deployment.environment !== environment
      )
        throw new Error("GitHub did not confirm the deployment identity.");
      id = deployment.id;
      const started = await status("in_progress");
      if (started.state !== "in_progress")
        throw new Error("GitHub did not confirm the deployment start.");
      console.log(`GitHub deployment ${id} started.`);
    },
    async succeed() {
      if (!id) throw new Error("Missing started deployment.");
      if ((await status("success")).state !== "success")
        throw new Error("GitHub did not confirm deployment success.");
    },
  };
}
