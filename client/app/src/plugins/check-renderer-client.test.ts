import { expect, it } from "vitest";
import { validPreviewRequest } from "./check-renderer-client";

const request = {
  generation: 7,
  invocationId: "invocation",
  requestId: "request",
  operation: "previewClose",
  args: {},
};
it("requires a complete bounded native preview identity", () => {
  expect(validPreviewRequest(request)).toBe(true);
});
it.each([
  null,
  {},
  { ...request, generation: -1 },
  { ...request, generation: 0.5 },
  { ...request, invocationId: "" },
  { ...request, requestId: "x".repeat(257) },
  { ...request, operation: "invoke" },
  { ...request, args: [] },
])("rejects malformed preview dispatch", (value) => {
  expect(validPreviewRequest(value)).toBe(false);
});
