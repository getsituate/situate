import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostContainerEnvironment } from "./pipeline-environment.mjs";
export { hostContainerEnvironment } from "./pipeline-environment.mjs";
export async function runContainerLane(
  root,
  plan,
  lane,
  {
    environment = process.env,
    signal,
    onEvent = () => {},
    launch = spawn,
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "situate-lane-"));
  const planFile = join(directory, "plan.json");
  const receiptFile = join(directory, "receipt.json");
  writeFileSync(planFile, JSON.stringify(plan), { mode: 0o600 });
  try {
    const child = launch(
      "python3",
      [
        join(root, "tools/pipeline-container.py"),
        "lane",
        plan.workflow,
        planFile,
        lane,
        receiptFile,
      ],
      {
        cwd: root,
        env: hostContainerEnvironment(environment),
        signal,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stderr.pipe(process.stderr, { end: false });
    child.stdout.setEncoding("utf8");
    let pending = "";
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "suite") onEvent(event);
        } catch {
          process.stderr.write(`${line}\n`);
        }
      }
    });
    let failure;
    const code = await new Promise((resolve) => {
      child.once("error", (error) => {
        failure = error;
      });
      child.once("close", resolve);
    });
    if (failure) throw failure;
    assert(code === 0 || code === 1, "Tool-container lane failed");
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    assert(
      receipt.source === plan.source &&
        receipt.planDigest === plan.authorizationDigest &&
        receipt.lane === lane &&
        receipt.host === "linux" &&
        receipt.executionHost === "linux" &&
        ["passed", "failed"].includes(receipt.status) &&
        (receipt.status === "passed") === (code === 0),
      "Tool-container receipt differs from the selected plan",
    );
    return receipt;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
