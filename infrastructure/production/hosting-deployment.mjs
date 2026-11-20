const repo = "getsituate/situate";
const environment = "hosting-production-operation";
const collection = `https://api.github.com/repos/${repo}/deployments`;
const validDeploymentId = (id) => Number.isSafeInteger(id) && id > 0;

export function deploymentGate({ token, revision, runId, fetchImpl = fetch }) {
  if (
    typeof token !== "string" ||
    !token.trim() ||
    typeof revision !== "string" ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    typeof runId !== "string" ||
    !/^[1-9][0-9]{0,15}$/.test(runId) ||
    !Number.isSafeInteger(Number(runId))
  )
    throw new Error("Missing GitHub deployment identity.");
  const logUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  let id;
  async function request({ deploymentId, body } = {}) {
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
    const response = await fetchImpl(url, {
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
    if (!response.ok)
      throw new Error(
        `GitHub deployment status request failed (${response.status}).`,
      );
    return response.json();
  }
  async function check() {
    const deployments = await request();
    if (!Array.isArray(deployments) || deployments.length > 1)
      throw new Error("Unexpected GitHub deployment inventory.");
    if (!deployments.length) return;
    const previous = deployments[0];
    if (
      !validDeploymentId(previous?.id) ||
      previous.environment !== environment
    )
      throw new Error("Unexpected GitHub deployment identity.");
    const statuses = await request({ deploymentId: previous.id });
    if (
      !Array.isArray(statuses) ||
      !["success", "inactive"].includes(statuses[0]?.state)
    )
      throw new Error(
        `Deployment ${previous.id} is unresolved. Inspect Terraform, Hetzner and DNS before clearing it manually.`,
      );
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
