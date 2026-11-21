import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const maximumWireBytes = 8 * 1024;
const maximumReceiptBytes = 256 * 1024;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function encodeActionsReceipt(receipt) {
  const bytes = Buffer.from(JSON.stringify(receipt));
  assert(
    bytes.length <= maximumReceiptBytes,
    "Lane receipt exceeds its size limit",
  );
  const envelope = {
    encoding: "deflate-base64-v1",
    size: bytes.length,
    sha256: hash(bytes),
    data: deflateRawSync(bytes).toString("base64"),
  };
  assert(
    Buffer.byteLength(JSON.stringify(envelope)) <= maximumWireBytes,
    "Lane receipt exceeds its job output limit",
  );
  return envelope;
}

export function decodeActionsReceipt(value) {
  assert(
    typeof value === "string" &&
      Buffer.byteLength(value) <= maximumReceiptBytes,
    "Invalid lane receipt job output",
  );
  const envelope = JSON.parse(value);
  if (envelope?.encoding === undefined) return envelope;
  assert(
    envelope.encoding === "deflate-base64-v1" &&
      Object.keys(envelope)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .join() === "data,encoding,sha256,size" &&
      Buffer.byteLength(value) <= maximumWireBytes &&
      Number.isSafeInteger(envelope.size) &&
      envelope.size > 0 &&
      envelope.size <= maximumReceiptBytes &&
      /^[a-f0-9]{64}$/.test(envelope.sha256) &&
      typeof envelope.data === "string" &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        envelope.data,
      ),
    "Invalid encoded lane receipt job output",
  );
  const bytes = inflateRawSync(Buffer.from(envelope.data, "base64"), {
    maxOutputLength: maximumReceiptBytes,
  });
  assert(
    bytes.length === envelope.size && hash(bytes) === envelope.sha256,
    "Lane receipt job output differs from its identity",
  );
  return JSON.parse(bytes);
}
