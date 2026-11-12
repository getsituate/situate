import { expect, test } from "vitest";
import { modelRequestError } from "./request-errors";
test.each([
  "native.ai.protocol.invalidData",
  "native.ai.protocol.providerRejected",
  "native.ai.protocol.incompleteStream",
  "native.ai.protocol.unsupported",
  "native.ai.response.idleTimeout",
  "native.ai.access.rejected",
])("native model failure %s retains its localized error identity", (key) => {
  expect(modelRequestError(key)).toBe(key);
});
test("unrecognized provider data cannot become interface copy", () => {
  for (const reason of [
    "PRIVATE_PROVIDER_BODY",
    "native.ai.protocol.PRIVATE_SECRET",
    "constructor",
    "__proto__",
    { message: "PRIVATE_PAYLOAD" },
    new Error("PRIVATE_PROVIDER_BODY"),
  ])
    expect(modelRequestError(reason)).toBeUndefined();
  expect(modelRequestError("native.ai.request.failed")).toBe(
    "ai.theResponseFailedCheckAIAccessReconnectIfYour",
  );
});
