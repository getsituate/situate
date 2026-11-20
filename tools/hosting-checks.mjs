import { spawnSync } from "node:child_process";

const hosting = "infrastructure/production";
const immutable = `${hosting}/immutable`;
const scripts = ["bake", "state", "verify-boot", "website-ssh"].map(
  (name) => `${immutable}/${name}.sh`,
);
const tests = [
  ...[
    "continuous-rollout",
    "hosting-deployment",
    "immutable-plan",
    "rollout-journal",
    "rollout-reconcile",
    "terraform",
  ].map((name) => `${hosting}/${name}.test.mjs`),
  ...["enrollment", "hosting-inventory", "probe"].map(
    (name) => `${immutable}/${name}.test.mjs`,
  ),
];
const commands = [
  [process.execPath, "--test", ...tests],
  ["python3", "-B", "-m", "unittest", "discover", "-s", immutable],
  ["docker", "compose", "-f", `${immutable}/compose.yaml`, "config", "--quiet"],
  ["shellcheck", ...scripts],
];
if (process.argv.length !== 2)
  throw new Error("Usage: node tools/hosting-checks.mjs");
for (const [command, ...args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
