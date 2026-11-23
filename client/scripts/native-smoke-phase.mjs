import { runSmokePhase } from "./native-smoke-runtime.mjs";

const { executable, ...options } = JSON.parse(process.argv[2]);
const controller = new AbortController();
const interrupt = () => controller.abort();
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of signals) process.on(signal, interrupt);
try {
  const run = options.upgradeWorkspace
    ? (await import("./native-smoke-upgrade.mjs")).runUpgradeSmoke
    : runSmokePhase;
  await run(executable, { ...options, signal: controller.signal });
} finally {
  for (const signal of signals) process.off(signal, interrupt);
}
