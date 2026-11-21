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

async function get(config, fetchImpl, path, allowMissing = false) {
  let response;
  try {
    response = await fetchImpl(`https://${hostname}/api/v2/${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.api+json",
        // A blocking Terraform apply can outlive an idle connection.
        Connection: "close",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("HCP Terraform inspection failed; no retry was attempted.");
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

export async function inspectWorkspace(
  config,
  fetchImpl = fetch,
  { allowLocked = false } = {},
) {
  const result = await get(
    config,
    fetchImpl,
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
    config,
    fetchImpl,
    `workspaces/${workspace.id}/current-state-version`,
    true,
  );
  let stateVersion = null;
  if (current) {
    stateVersion = finalizedStateVersion(current.data);
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

function finalizedStateVersion(state) {
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
  return { id: state.id, serial: state.attributes.serial };
}

const maxStateBytes = 16 * 1024 * 1024;
const untrustedDownload =
  "HCP Terraform did not provide a trusted state download URL.";

function archivistObject(value) {
  if (typeof value !== "string") return null;
  const url = URL.parse(value);
  return url?.origin === "https://archivist.terraform.io" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    /^\/v1\/object\/[^/]+$/.test(url.pathname)
    ? url.href
    : null;
}

async function stateDownloadUrl(value, versionId, config, fetchImpl, signal) {
  const direct = archivistObject(value);
  if (direct) return direct;

  // Authenticate only to the exact HCP route for the inspected version.
  const endpoint = `https://app.terraform.io/api/state-versions/${encodeURIComponent(versionId)}/hosted_state`;
  if (value !== endpoint) throw new Error(untrustedDownload);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.token}`, Connection: "close" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "manual",
      signal,
    });
  } catch {
    throw new Error("HCP Terraform state download did not complete.");
  }
  await response.body?.cancel().catch(() => {});
  if (response.status >= 400 && response.status <= 599)
    throw new Error(
      `HCP Terraform state download failed: HTTP ${response.status}.`,
    );
  const target =
    response.status === 302 &&
    archivistObject(response.headers.get("location"));
  if (!target) throw new Error(untrustedDownload);
  return target;
}

export async function downloadCurrentState(
  config,
  workspace,
  fetchImpl = fetch,
) {
  if (
    workspace.organization !== config.organization ||
    workspace.hostname !== hostname ||
    workspace.workspace !== workspaceName ||
    workspace.locked !== false ||
    !/^ws-[A-Za-z0-9]+$/.test(workspace.workspaceId ?? "") ||
    !workspace.stateVersion
  )
    throw new Error(
      "Expected an inspected, unlocked HCP workspace with state.",
    );

  const result = await get(
    config,
    fetchImpl,
    `workspaces/${workspace.workspaceId}/current-state-version`,
    true,
  );
  const state = result?.data;
  const version = state && finalizedStateVersion(state);
  if (
    version?.id !== workspace.stateVersion.id ||
    version.serial !== workspace.stateVersion.serial
  )
    throw new Error(
      "The HCP state changed during export; inspect it before continuing.",
    );

  const signal = AbortSignal.timeout(30000);
  const url = await stateDownloadUrl(
    state.attributes["hosted-state-download-url"],
    version.id,
    config,
    fetchImpl,
    signal,
  );

  // The Archivist URL grants access on its own; never forward the HCP API token.
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Connection: "close" },
      redirect: "error",
      signal,
    });
  } catch {
    throw new Error("HCP Terraform state download did not complete.");
  }
  if (!response.ok)
    throw new Error(
      `HCP Terraform state download failed: HTTP ${response.status}.`,
    );
  if (
    !response.body ||
    Number(response.headers.get("content-length")) > maxStateBytes
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error("HCP Terraform state download is missing or too large.");
  }
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxStateBytes) break;
      chunks.push(Buffer.from(chunk));
    }
  } catch {
    throw new Error("HCP Terraform state download did not complete.");
  }
  if (bytes > maxStateBytes)
    throw new Error("HCP Terraform state download is missing or too large.");
  return Buffer.concat(chunks);
}
