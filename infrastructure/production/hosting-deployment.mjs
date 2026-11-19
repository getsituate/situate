const repo = "getsituate/situate";
const environment = "hosting-production-operation";

export function deploymentGate({ token, revision, runId, fetchImpl = fetch }) {
  if (!token || !/^[a-f0-9]{40}$/.test(revision) || !/^\d+$/.test(runId))
    throw new Error("Missing GitHub deployment identity.");
  const logUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  const collection = `repos/${repo}/deployments`;
  let id;
  async function request(path, body) {
    const response = await fetchImpl(
      `https://api.github.com/${collection}${path}`,
      {
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
      },
    );
    if (!response.ok)
      throw new Error(
        `GitHub deployment status request failed (${response.status}).`,
      );
    return response.json();
  }
  async function check() {
    const deployments = await request(`?environment=${environment}&per_page=1`);
    if (!Array.isArray(deployments) || deployments.length > 1)
      throw new Error("Unexpected GitHub deployment inventory.");
    if (!deployments.length) return;
    const previous = deployments[0];
    if (
      !Number.isSafeInteger(previous.id) ||
      previous.id < 1 ||
      previous.environment !== environment
    )
      throw new Error("Unexpected GitHub deployment identity.");
    const statuses = await request(`/${previous.id}/statuses?per_page=1`);
    if (
      !Array.isArray(statuses) ||
      !["success", "inactive"].includes(statuses[0]?.state)
    )
      throw new Error(
        `Deployment ${previous.id} is unresolved. Inspect Terraform, Hetzner and DNS before clearing it manually.`,
      );
  }
  function status(state) {
    return request(`/${id}/statuses`, {
      state,
      log_url: logUrl,
      auto_inactive: false,
    });
  }
  return {
    check,
    async begin() {
      await check();
      const deployment = await request("", {
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
