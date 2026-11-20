import assert from "node:assert/strict";
import test from "node:test";
import { runHostingTerraform } from "./continuous-deploy.mjs";

function failingCommand(stderr, code) {
  return () => ({
    status: code ? null : 1,
    error: code
      ? Object.assign(new Error("private command arguments"), { code })
      : undefined,
    stderr,
    stdout: "private Terraform state",
  });
}

test("reports the failed Terraform operation and only an approved diagnostic", () => {
  for (const [operation, diagnostic] of [
    ["status", "HCP Terraform inspection failed: HTTP 401."],
    ["init", "Terraform init failed (exit 1)."],
    ["export", "Terraform state pull failed (exit 1)."],
  ]) {
    assert.throws(
      () =>
        runHostingTerraform(
          {},
          [operation],
          failingCommand(`private output\n${diagnostic}\n`),
        ),
      { message: `Hosting Terraform ${operation} failed: ${diagnostic}` },
    );
  }
});

test("does not log unexpected subprocess output or private paths", () => {
  assert.throws(
    () =>
      runHostingTerraform(
        {},
        ["export", "/private/state.tfstate"],
        failingCommand(
          "HCP Terraform inspection failed: HTTP 401. private data",
        ),
      ),
    {
      message:
        "Hosting Terraform export failed: Inspect live state before making further changes.",
    },
  );
});

test("reports a Terraform wrapper timeout without logging its output", () => {
  assert.throws(
    () =>
      runHostingTerraform(
        {},
        ["status"],
        failingCommand("private output", "ETIMEDOUT"),
      ),
    { message: "Hosting Terraform status failed: The command timed out." },
  );
});
