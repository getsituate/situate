import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import {
  encodeActionsReceipt,
  decodeActionsReceipt,
} from "./actions-receipts.mjs";
import { sourceVerificationFixture } from "./source-verification-fixtures.mjs";

test("job output compression preserves complete original and reused receipts", () => {
  const f = sourceVerificationFixture();
  for (const receipt of [...f.fresh, f.reused]) {
    const encoded = encodeActionsReceipt(receipt);
    assert.deepEqual(decodeActionsReceipt(JSON.stringify(encoded)), receipt);
    assert(Buffer.byteLength(JSON.stringify(encoded)) <= 8192);
    assert.deepEqual(decodeActionsReceipt(JSON.stringify(receipt)), receipt);
  }
});

test("job output decoding rejects changed identities and bounded expansion", () => {
  const encoded = encodeActionsReceipt({ synthetic: true });
  for (const changed of [
    { ...encoded, size: encoded.size + 1 },
    { ...encoded, sha256: "0".repeat(64) },
    { ...encoded, data: "not base64" },
    { ...encoded, extra: true },
  ])
    assert.throws(() => decodeActionsReceipt(JSON.stringify(changed)));
  assert.throws(
    () =>
      encodeActionsReceipt({ data: randomBytes(16 * 1024).toString("base64") }),
    /job output limit/,
  );
  const oversized = {
    ...encoded,
    data: deflateRawSync(Buffer.alloc(256 * 1024 + 1)).toString("base64"),
  };
  assert.throws(() => decodeActionsReceipt(JSON.stringify(oversized)));
});
