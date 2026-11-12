export const hostname = "app.terraform.io";
export const workspaceName = "situate-production";

export function hcpConfiguration(config) {
  const organization = config.TF_CLOUD_ORGANIZATION;
  const token = config.TF_TOKEN_app_terraform_io;
  if (!organization || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/.test(organization))
    throw new Error(
      "Set TF_CLOUD_ORGANIZATION to the exact HCP organization name.",
    );
  if (!token?.trim())
    throw new Error(
      "Set TF_TOKEN_app_terraform_io before accessing HCP Terraform.",
    );
  return { organization, token };
}

export async function inspectWorkspace(
  config,
  fetchImpl = fetch,
  { allowLocked = false } = {},
) {
  async function get(path, allowMissing = false) {
    let response;
    try {
      response = await fetchImpl(`https://${hostname}/api/v2/${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/vnd.api+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(
        "HCP Terraform inspection failed; no retry was attempted.",
      );
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `HCP Terraform inspection failed: HTTP ${response.status}.`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error("HCP Terraform returned invalid JSON.");
    }
  }
  const result = await get(
    `organizations/${encodeURIComponent(config.organization)}/workspaces/${workspaceName}`,
  );
  const workspace = result?.data;
  if (
    workspace?.type !== "workspaces" ||
    !/^ws-[A-Za-z0-9]+$/.test(workspace.id ?? "") ||
    workspace.attributes?.name !== workspaceName
  )
    throw new Error("HCP Terraform returned an unexpected workspace.");
  if (workspace.attributes.permissions?.["can-read-state-versions"] !== true)
    throw new Error(
      "The HCP token must be able to read this workspace\u0027s state versions.",
    );
  if (workspace.attributes["execution-mode"] !== "local")
    throw new Error(
      "Set the HCP workspace execution mode to Local before continuing.",
    );
  if (
    typeof workspace.attributes.locked !== "boolean" ||
    (!allowLocked && workspace.attributes.locked)
  )
    throw new Error(
      "The HCP workspace is locked; inspect its owner before continuing.",
    );
  const current = await get(
    `workspaces/${workspace.id}/current-state-version`,
    true,
  );
  let stateVersion = null;
  if (current) {
    const state = current.data;
    if (
      state?.type !== "state-versions" ||
      !/^sv-[A-Za-z0-9]+$/.test(state.id ?? "") ||
      !Number.isSafeInteger(state.attributes?.serial) ||
      state.attributes.serial < 0 ||
      state.attributes.status !== "finalized"
    )
      throw new Error(
        "HCP Terraform returned an incomplete or invalid state version.",
      );
    stateVersion = { id: state.id, serial: state.attributes.serial };
  }
  return {
    hostname,
    organization: config.organization,
    workspace: workspaceName,
    workspaceId: workspace.id,
    locked: workspace.attributes.locked,
    stateVersion,
  };
}
