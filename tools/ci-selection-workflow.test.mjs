import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("external advisory monitoring is independent and weekly cadence requires configuration", () => {
  const monitoring = read(".github/workflows/dependency-monitoring.yml");
  assert.match(monitoring, /schedule:[\s\S]*cron: "23 8 \* \* 1"/);
  assert.match(monitoring, /workflow_dispatch:/);
  assert.match(
    monitoring,
    /MONITORING_WEEKLY:.*vars\.DEPENDENCY_MONITORING_WEEKLY/,
  );
  assert.match(monitoring, /needs\.policy\.outputs\.enabled == 'true'/);
  assert.doesNotMatch(monitoring, /pull_request|push:|secrets\./);
  for (const name of ["verify", "release-macos", "publish-macos"])
    assert.doesNotMatch(
      read(`.github/workflows/${name}.yml`),
      /dependency-monitoring|rust-audit|npm audit|advisories/,
    );
});

test("Dependabot groups security fixes and maintains SHA-pinned Actions independently", () => {
  const config = read(".github/dependabot.yml");
  assert.match(config, /^version: 2/m);
  for (const ecosystem of ["npm", "cargo", "github-actions"])
    assert.ok(config.includes(`package-ecosystem: ${ecosystem}`));
  for (const directory of ["/", "/client", "/requirements", "/tools/dev-tui"])
    assert.ok(config.includes(`- ${directory}\n`));
  assert.equal((config.match(/open-pull-requests-limit: 0/g) ?? []).length, 2);
  assert.equal((config.match(/applies-to: security-updates/g) ?? []).length, 2);
  assert.doesNotMatch(config, /ignore:/);
});
