import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifiedHostKey } from "./enrollment.mjs";

const token = "a".repeat(64);
const serverId = "123";
const key = `ssh-ed25519 ${"A".repeat(68)}`;
const proof = createHmac("sha256", Buffer.from(token, "hex"))
  .update(`${serverId}\n${key}\n`)
  .digest("hex");
const claim = { serverId, key, proof };

test("enrollment authenticates the exact provider server and SSH key", () => {
  assert.equal(verifiedHostKey(claim, serverId, token), key);
  assert.throws(() => verifiedHostKey(claim, "124", token), /Invalid/);
  assert.throws(
    () =>
      verifiedHostKey(
        { ...claim, key: `ssh-ed25519 ${"B".repeat(68)}` },
        serverId,
        token,
      ),
    /does not match/,
  );
  assert.throws(
    () => verifiedHostKey(claim, serverId, "b".repeat(64)),
    /does not match/,
  );
});
