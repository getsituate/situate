import { beforeEach, expect, it, vi } from "vitest";
import { attributes } from "../../../contracts/diagnostics.json";
import { validateEvent } from "../diagnostics/contract";
import { checkProgress, checkProgressLogger } from "./check-progress";
import {
  annotateCheckFailure,
  checkDiagnostic,
  checkDiagnosticCodes,
  checkErrorTypes,
  checkStages,
  describeCheckFailure,
  parseCheckDiagnostic,
  restoreCheckFailure,
} from "./check-errors";

const mocks = vi.hoisted(() => ({ emit: vi.fn(), producer: vi.fn() }));
vi.mock("../diagnostics", () => ({ diagnosticsFor: mocks.producer }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.producer.mockReturnValue({ emit: mocks.emit });
});

it("keeps the diagnostic catalog aligned with the finite bridge values", () => {
  expect(attributes.check_stage).toEqual(checkStages);
  expect(attributes.check_error).toEqual(checkDiagnosticCodes);
  expect(attributes.error_type).toEqual(checkErrorTypes);
});

it.each([
  [new TypeError("PRIVATE_SENTINEL"), "plugins.checkTypeError", "type_error"],
  [
    new SyntaxError("PRIVATE_SENTINEL"),
    "plugins.checkSyntaxError",
    "syntax_error",
  ],
  [
    new ReferenceError("PRIVATE_SENTINEL"),
    "plugins.checkReferenceError",
    "reference_error",
  ],
  ["native.plugins.hostFailed", "native.plugins.hostFailed", "string"],
  [
    "native.plugins.retainedStorageFailed",
    "native.plugins.retainedStorageFailed",
    "string",
  ],
  [
    "invalid args `request`: PRIVATE_SENTINEL",
    "ipc_invalid_arguments",
    "string",
  ],
  [new Error("PRIVATE_SENTINEL"), "plugins.checkFailed", "error"],
  [{ body: "PRIVATE_SENTINEL" }, "plugins.checkFailed", "other"],
])(
  "retains safe failure classification at its original stage: %s",
  (error, code, kind) => {
    const failure = annotateCheckFailure(error, "native_admission");
    expect(checkDiagnostic(failure)).toEqual({
      stage: "native_admission",
      code,
      kind,
    });
    expect(annotateCheckFailure(failure, "script")).toBe(failure);
    expect(JSON.stringify(describeCheckFailure(failure))).not.toContain(
      "PRIVATE_SENTINEL",
    );
  },
);

it("does not read exception getters, causes, stacks or arbitrary thrown objects", () => {
  const getter = vi.fn(() => {
    throw new Error("PRIVATE_SENTINEL");
  });
  const error = new Error();
  for (const key of ["message", "stack", "cause", "name"])
    Object.defineProperty(error, key, { get: getter });
  const trap = vi.fn(() => {
    throw new Error("PRIVATE_SENTINEL");
  });
  const hostile = new Proxy({}, { getPrototypeOf: trap, get: trap });
  expect(
    describeCheckFailure(annotateCheckFailure(error, "factory")),
  ).toMatchObject({
    error: "plugins.checkFailed",
    diagnostic: { stage: "factory", kind: "error" },
  });
  expect(checkDiagnostic(annotateCheckFailure(hostile, "factory"))?.kind).toBe(
    "other",
  );
  expect(getter).not.toHaveBeenCalled();
});

it("validates transported metadata and discards unknown or accessor fields", () => {
  const diagnostic = {
    stage: "module_import",
    code: "plugins.checkTypeError",
    kind: "type_error",
  } as const;
  expect(parseCheckDiagnostic(diagnostic)).toEqual(diagnostic);
  const restored = restoreCheckFailure(
    "plugins.checkTypeError",
    diagnostic,
    "renderer_result",
  );
  expect(describeCheckFailure(restored).diagnostic).toEqual(diagnostic);
  const getter = vi.fn(() => "PRIVATE_SENTINEL");
  for (const invalid of [
    { ...diagnostic, stage: "PRIVATE_SENTINEL" },
    { ...diagnostic, code: "PRIVATE_SENTINEL" },
    { ...diagnostic, kind: "PRIVATE_SENTINEL" },
    { ...diagnostic, message: "PRIVATE_SENTINEL" },
    Object.defineProperty({ ...diagnostic }, "code", { get: getter }),
    null,
  ]) {
    expect(parseCheckDiagnostic(invalid)).toBeUndefined();
    expect(
      describeCheckFailure(
        restoreCheckFailure("PRIVATE_SENTINEL", invalid, "renderer_result"),
      ),
    ).toMatchObject({
      error: "plugins.checkFailed",
      diagnostic: { stage: "renderer_result", code: "plugins.checkFailed" },
    });
  }
  expect(getter).not.toHaveBeenCalled();
});

it("records admitted workspace-scoped progress without source, paths or exception text", () => {
  const context = {
    trace_id: "11111111-1111-4111-8111-111111111111",
    span_id: "22222222-2222-4222-8222-222222222222",
    initiator: "agent" as const,
  };
  const progress = checkProgress(checkProgressLogger("scope", context));
  progress.emit("module_import");
  progress.emit("module_import");
  progress.failure(
    annotateCheckFailure(new Error("PRIVATE_SENTINEL"), "module_import"),
  );
  expect(mocks.emit).toHaveBeenCalledTimes(2);
  expect(mocks.producer).toHaveBeenCalledWith("scope");
  for (const [event, category, fields, parent, level] of mocks.emit.mock
    .calls) {
    expect(parent).toEqual(context);
    expect(
      validateEvent({
        schema_version: 1,
        timestamp_ms: 0,
        sequence: 0,
        event,
        category,
        attributes: fields,
        context: parent,
        level,
      }),
    ).toBeDefined();
  }
  expect(mocks.emit.mock.calls[1][2]).toEqual({
    component: "plugin_check",
    check_stage: "module_import",
    check_error: "plugins.checkFailed",
    error_type: "error",
    outcome: "failure",
  });
  expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain(
    "PRIVATE_SENTINEL",
  );
});

it("records cancellation as information, not an operational failure", () => {
  const progress = checkProgress(checkProgressLogger("scope"));
  progress.failure(
    annotateCheckFailure(new Error("plugins.executionCancelled"), "script"),
  );
  expect(mocks.emit).toHaveBeenCalledWith(
    "operation.progress",
    "plugin",
    expect.objectContaining({ outcome: "cancelled" }),
    undefined,
    "info",
  );
});

it("keeps nested failures precise and does not let a diagnostic observer change execution", async () => {
  const observer = vi.fn(() => {
    throw new Error("observer unavailable");
  });
  const progress = checkProgress(observer);
  await expect(
    progress.at("script", () =>
      progress.at("preview_capture", () => {
        throw new TypeError("PRIVATE_SENTINEL");
      }),
    ),
  ).rejects.toSatisfy(
    (error: unknown) => checkDiagnostic(error)?.stage === "preview_capture",
  );
  await expect(progress.at("script", () => 42)).resolves.toBe(42);
  expect(progress.sync("preview_read", () => "ready")).toBe("ready");
});
