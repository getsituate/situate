import { expect, it, vi } from "vitest";
import { checkFailureCode, describeCheckFailure } from "./check-errors";

it("returns actionable catalog text rather than raw exception messages", () => {
  vi.stubGlobal("__SITUATE_LOCALIZATION_KEYS__", false);
  try {
    expect(
      describeCheckFailure(new ReferenceError("preview is not defined")),
    ).toEqual({
      error: "plugins.checkUnknownPreviewApi",
      message:
        "The check has no global preview object. Use check.preview for preview operations.",
    });
    expect(
      describeCheckFailure("native.plugins.dependencyUnavailable").message,
    ).toContain("Include new dependencies in the same change set");
    expect(
      describeCheckFailure("native.plugins.testProcessBlocked").message,
    ).toContain("the plugin that runs the process");
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([
  [
    new ReferenceError("preview is not defined"),
    "plugins.checkUnknownPreviewApi",
  ],
  [
    new ReferenceError("Can't find variable: preview"),
    "plugins.checkUnknownPreviewApi",
  ],
  [
    new ReferenceError("privateName is not defined"),
    "plugins.checkReferenceError",
  ],
  [new TypeError("private value is not a function"), "plugins.checkTypeError"],
  [new SyntaxError("private source fragment"), "plugins.checkSyntaxError"],
  [
    "native.plugins.dependencyUnavailable",
    "native.plugins.dependencyUnavailable",
  ],
  [
    new Error("native.plugins.captureUnavailable"),
    "native.plugins.captureUnavailable",
  ],
  ["plugins.moduleNotFound", "plugins.moduleNotFound"],
  ["plugins.moduleImportInvalid", "plugins.moduleImportInvalid"],
  ["plugins.moduleImportUnsupported", "plugins.moduleImportUnsupported"],
  ["plugins.moduleCycle", "plugins.moduleCycle"],
  ["native.plugins.checkInvalid", "native.plugins.checkInvalid"],
  ["native.plugins.testProcessBlocked", "native.plugins.testProcessBlocked"],
  [
    new Error("private response", { cause: "private credential" }),
    "plugins.checkFailed",
  ],
  ["private response", "plugins.checkFailed"],
])(
  "classifies errors without returning private exception content: %s",
  (error, code) => {
    expect(checkFailureCode(error)).toBe(code);
    expect(describeCheckFailure(error)).toEqual({
      error: code,
      message: `⟦${code}⟧`,
    });
    expect(JSON.stringify(describeCheckFailure(error))).not.toMatch(/private/);
  },
);
