import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
export const revisionPattern = /^[a-f0-9]{40}$/;

// Include the Terraform topology, image build and installed runtime. Changes to
// the runner's orchestration, rehearsal or diagnostics do not change the host.
const inputs = [
  "infrastructure/production/terraform",
  "infrastructure/production/docker/nginx.conf",
  "infrastructure/production/immutable",
  "infrastructure/releases/remote.py",
];
const runnerOnly =
  /\/(?:[^/]+\.(?:test\.mjs|md|example)|test_[^/]+\.py|(?:continuous-deploy|enrollment|hosting-inventory|probe)\.mjs|github-rehearsal\.py|rehearsal_fixture\.py)$/;

export function hostingDigest(revision, git = execFileSync) {
  if (!revisionPattern.test(revision ?? ""))
    throw new Error("Expected a full hosting source commit.");
  try {
    const tree = git(
      "git",
      ["ls-tree", "-r", revision + "^{commit}", "--", ...inputs],
      {
        cwd: repository,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      },
    );
    const files = tree
      .trimEnd()
      .split("\n")
      .filter((entry) => !runnerOnly.test(entry));
    if (!files.some((entry) => entry.endsWith("/immutable/bake.sh")))
      throw new Error("Missing immutable hosting inputs.");
    return createHash("sha256").update(files.join("\n")).digest("hex");
  } catch {
    throw new Error("Cannot read immutable hosting inputs for this commit.");
  }
}
