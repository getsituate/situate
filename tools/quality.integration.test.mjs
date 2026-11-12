import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const config = fileURLToPath(new URL("../.gitleaks.toml", import.meta.url));

test("the JWT fixture exception retains other paths, signing-key identifiers and secret rules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-jwt-scan-"));
  const fixturePath = "client/app/src-tauri/src/openai_audience_fixtures.json";
  const sourcePath = "client/app/src/scanner-fixture.js";
  const fixture = JSON.parse(
    await readFile(new URL(`../${fixturePath}`, import.meta.url), "utf8"),
  );
  const token = fixture.tokens.singleton;
  const [header, payload, signature] = token.split(".");
  const foreignHeader = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
      kid: "another-signing-key",
    }),
  ).toString("base64url");
  fixture.foreign_identity = `${foreignHeader}.${payload}.${signature}`;
  fixture.api_key = createHash("sha256")
    .update("public JWT scanner API key fixture")
    .digest("hex");
  try {
    for (const path of [fixturePath, sourcePath])
      await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(
      join(directory, fixturePath),
      JSON.stringify(fixture, null, 2),
    );
    await writeFile(
      join(directory, sourcePath),
      `export default "${token}";\n`,
    );
    const report = join(directory, "report.json");
    const result = spawnSync(
      "gitleaks",
      [
        "dir",
        ".",
        "--redact",
        "--no-banner",
        "--config",
        config,
        "--report-format",
        "json",
        "--report-path",
        report,
      ],
      { cwd: directory, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 1, result.error?.message ?? result.stderr);
    const findings = JSON.parse(await readFile(report, "utf8"));
    assert.deepEqual(
      findings
        .map(({ File, RuleID }) => `${File.replaceAll("\\", "/")}:${RuleID}`)
        .sort(),
      [
        `${fixturePath}:generic-api-key`,
        `${fixturePath}:jwt`,
        `${sourcePath}:jwt`,
      ].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("secret scanning excludes generated output, IDE workspace state and the root environment file but retains source, IDE data sources and other environment files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-secret-scan-"));
  const provenancePath = "client/runtime/plugin-engine/provenance.json";
  const checksum =
    "b44cb8065f2eb2d4689b426bbc08fdf24ac996065cd909a09748566ce0b6a446";
  const files = [
    provenancePath,
    "client/app/src/scanner-fixture.js",
    "client/target/scanner-fixture.js",
    "node_modules/scanner-fixture.js",
    "client/app/src-tauri/gen/scanner-fixture.js",
    ".env",
    ".env.example",
    ".env.local",
    "client/.env",
    ".idea/workspace.xml",
    "client/.idea/workspace.xml",
    ".idea/dataSources.xml",
    "client/.idea/dataSources.xml",
  ];
  const synthetic = createHash("sha256")
    .update("public secret scanner test fixture")
    .digest("hex");
  try {
    for (const file of files) {
      const path = join(directory, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        file === provenancePath
          ? JSON.stringify({
              "quickjs/builtin-iterator-zip-keyed.h": checksum,
              api_key: synthetic,
            })
          : `const api_key = "${file === ".env.example" ? checksum : synthetic}";\n`,
      );
    }
    const report = join(directory, "report.json");
    const result = spawnSync(
      "gitleaks",
      [
        "dir",
        ".",
        "--redact",
        "--no-banner",
        "--config",
        config,
        "--report-format",
        "json",
        "--report-path",
        report,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(result.status, 1, result.error?.message ?? result.stderr);
    const findings = JSON.parse(await readFile(report, "utf8"));
    assert.deepEqual(
      findings.map((finding) => finding.File.replaceAll("\\", "/")).sort(),
      [
        ".env.example",
        ".env.local",
        ".idea/dataSources.xml",
        "client/.env",
        "client/.idea/dataSources.xml",
        "client/app/src/scanner-fixture.js",
        provenancePath,
      ].sort(),
    );
    for (const finding of findings)
      assert.equal(finding.RuleID, "generic-api-key");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
