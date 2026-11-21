import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { readPrivateDotenv } from "../../../client/scripts/private-dotenv.mjs";

const tokenName = "SONARQUBE_MCP_TOKEN";

export function sonarqubeAuthorization(
  environment: NodeJS.ProcessEnv,
  envPath: string,
) {
  if (Object.hasOwn(environment, tokenName)) {
    return environment[tokenName]?.trim()
      ? "Bearer ${SONARQUBE_MCP_TOKEN}"
      : undefined;
  }
  if (environment.CI === "true") return;

  const token = readPrivateDotenv(envPath, [tokenName])[tokenName]?.trim();
  if (!token) return;
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
    throw new Error("SONARQUBE_MCP_TOKEN in .env is not a valid bearer token.");
  }
  return `Bearer ${token}`;
}

export default function (pi: ExtensionAPI) {
  const authorization = sonarqubeAuthorization(
    process.env,
    fileURLToPath(new URL("../../../.env", import.meta.url)),
  );
  if (!authorization) return;

  pi.registerMcpServer("sonarqube", {
    url: "https://api.sonarcloud.io/mcp",
    description:
      "Review SonarQube Cloud findings and check metrics and quality gates for getsituate_situate.",
    headers: {
      Authorization: authorization,
      SONARQUBE_TOOLSETS: "projects,issues,measures,quality-gates",
    },
  });
}
