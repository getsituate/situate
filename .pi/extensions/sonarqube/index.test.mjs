import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const packageRoot = process.env.PI_PACKAGE_ROOT;
const require = createRequire(
  packageRoot ? join(packageRoot, "package.json") : import.meta.url,
);
const { createJiti } = require("jiti");
const { default: sonarqube, sonarqubeAuthorization } = await createJiti(
  import.meta.url,
).import("./index.ts");

test("uses only the SonarQube key from private dotenv as a local fallback", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "sonarqube-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, ".env");
  assert.equal(sonarqubeAuthorization({}, path), undefined);
  writeFileSync(
    path,
    'OTHER_SECRET=ignored\nSONARQUBE_MCP_TOKEN="file-token"\n',
    {
      mode: 0o600,
    },
  );

  assert.equal(sonarqubeAuthorization({}, path), "Bearer file-token");
  assert.equal(sonarqubeAuthorization({ CI: "true" }, path), undefined);
  assert.equal(
    sonarqubeAuthorization({ SONARQUBE_MCP_TOKEN: "" }, path),
    undefined,
  );
  assert.equal(
    sonarqubeAuthorization({ SONARQUBE_MCP_TOKEN: "env-token" }, path),
    "Bearer ${SONARQUBE_MCP_TOKEN}",
  );
});

test("registers SonarQube only when the environment provides a token in CI", (t) => {
  const originalCI = process.env.CI;
  process.env.CI = "true";
  t.after(() => {
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
  });
  const original = process.env.SONARQUBE_MCP_TOKEN;
  t.after(() => {
    if (original === undefined) delete process.env.SONARQUBE_MCP_TOKEN;
    else process.env.SONARQUBE_MCP_TOKEN = original;
  });

  const registrations = [];
  const pi = {
    registerMcpServer: (name, config) => registrations.push({ name, config }),
  };

  delete process.env.SONARQUBE_MCP_TOKEN;
  sonarqube(pi);
  process.env.SONARQUBE_MCP_TOKEN = " ";
  sonarqube(pi);
  assert.deepEqual(registrations, []);

  process.env.SONARQUBE_MCP_TOKEN = "test-token";
  sonarqube(pi);
  assert.deepEqual(
    registrations.map(({ name, config }) => ({
      name,
      url: config.url,
      headers: config.headers,
    })),
    [
      {
        name: "sonarqube",
        url: "https://api.sonarcloud.io/mcp",
        headers: {
          Authorization: "Bearer ${SONARQUBE_MCP_TOKEN}",
          SONARQUBE_READ_ONLY: "true",
          SONARQUBE_TOOLSETS: "projects,issues,measures,quality-gates",
        },
      },
    ],
  );
});
