import { hostingDigest, revisionPattern } from "./hosting-inputs.mjs";

const repo = "getsituate/situate";
const environment = "hosting-production-operation";
const collection =
  "https://api.github.com/repos/getsituate/situate/deployments";

function statusPath(id) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Unexpected GitHub deployment identity.");
  return `/${encodeURIComponent(Number(id))}/statuses`;
}

function deploymentsApi(token, fetchImpl) {
  if (!token) throw new Error("GitHub deployments access is required.");
  return async (url, body) => {
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
        throw new Error("GitHub deployment status request did not complete.");
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new Error("GitHub returned invalid deployment status data.");
        }
      }
      if (body || attempt === 1 || ![502, 503, 504].includes(response.status))
        throw new Error(
          `GitHub deployment status request failed (${response.status}).`,
        );
    }
  };
}

async function latest(request) {
  const deployments = await request(
    collection + "?environment=hosting-production-operation&per_page=1",
  );
  if (!Array.isArray(deployments) || deployments.length > 1)
    throw new Error("Unexpected GitHub deployment inventory.");
  if (!deployments.length) return null;
  const previous = deployments[0];
  if (
    !Number.isSafeInteger(previous.id) ||
    previous.id < 1 ||
    previous.environment !== environment
  )
    throw new Error("Unexpected GitHub deployment identity.");
  const statuses = await request(
    collection + statusPath(previous.id) + "?per_page=1",
  );
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
      reason: "Hosting changed during the readiness check.",
    };
  return result;
}

export function deploymentGate({
  token,
  revision,
  runId,
  fetchImpl = fetch,
  digest = hostingDigest,
}) {
  if (!revisionPattern.test(revision ?? "") || !/^\d+$/.test(runId))
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
    return request(collection + statusPath(id), {
      state,
      log_url: logUrl,
      auto_inactive: false,
    });
  }
  return {
    check,
    async begin() {
      await check();
      const deployment = await request(collection, {
        ref: revision,
        environment,
        auto_merge: false,
        required_contexts: [],
        production_environment: true,
      });
      if (
        !Number.isSafeInteger(deployment.id) ||
        deployment.id < 1 ||
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
