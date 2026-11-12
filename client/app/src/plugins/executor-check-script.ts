export interface CheckScriptContext {
  plugin: unknown;
  host: unknown;
  preview: unknown;
}

function equalJson(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (
    actual === null ||
    expected === null ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  )
    return false;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (
      !Array.isArray(actual) ||
      !Array.isArray(expected) ||
      actual.length !== expected.length
    )
      return false;
    for (let index = 0; index < actual.length; index++)
      if (!equalJson(actual[index], expected[index])) return false;
    return true;
  }
  const keys = Object.keys(actual);
  return (
    keys.length === Object.keys(expected).length &&
    keys.every(
      (key) =>
        Object.hasOwn(expected, key) &&
        equalJson(
          (actual as Record<string, unknown>)[key],
          (expected as Record<string, unknown>)[key],
        ),
    )
  );
}

export interface CheckAssertionFailure {
  assertion: number;
  operator: "ok" | "equal";
  actual: string;
  expected: string;
}

type CheckScriptResult =
  | { passed: true; assertions: number }
  | {
      passed: false;
      assertions: number;
      error: string;
      failure?: CheckAssertionFailure;
    };

function previewValue(value: unknown): string {
  try {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 1024
      ? text.slice(0, 1021).replace(/[\uD800-\uDBFF]$/, "") + "..."
      : text;
  } catch {
    return "[unserializable]";
  }
}

function scriptError(cause: unknown): string {
  if (cause instanceof Error) {
    if (/^(native|plugins)\.[a-zA-Z0-9_.]+$/.test(cause.message))
      return cause.message;
    if (cause instanceof TypeError) return "plugins.checkTypeError";
    if (cause instanceof ReferenceError) return "plugins.checkReferenceError";
    if (cause instanceof SyntaxError) return "plugins.checkSyntaxError";
  }
  return "plugins.checkFailed";
}

export async function runCheckScript(
  script: string,
  context: CheckScriptContext,
): Promise<CheckScriptResult> {
  if (typeof document !== "undefined") throw new Error("plugins.checkFailed");
  if (typeof script !== "string" || !script.trim() || script.length > 65536)
    throw new Error("native.plugins.invalidPath");
  let assertions = 0;
  let attempts = 0;
  let failure: CheckAssertionFailure | undefined;
  function verify(
    operator: "ok" | "equal",
    actual: unknown,
    expected: unknown,
  ) {
    const assertion = ++attempts;
    let passed = false;
    try {
      passed =
        operator === "ok" ? Boolean(actual) : equalJson(actual, expected);
    } finally {
      if (!passed)
        failure ??= {
          assertion,
          operator,
          actual: previewValue(actual),
          expected: previewValue(expected),
        };
    }
    if (!passed) throw new Error("plugins.checkAssertionFailed");
    assertions++;
  }
  const assert = Object.freeze({
    ok: (value: unknown) => verify("ok", value, true),
    equal: (actual: unknown, expected: unknown) =>
      verify("equal", actual, expected),
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let error: string | undefined;
  try {
    const run = new AsyncFunction(
      "plugin",
      "host",
      "preview",
      "assert",
      `"use strict";\n${script}`,
    );
    await run(context.plugin, context.host, context.preview, assert);
  } catch (cause) {
    error = scriptError(cause);
  }
  if (failure)
    return {
      passed: false,
      assertions,
      error: "plugins.checkAssertionFailed",
      failure,
    };
  if (error) return { passed: false, assertions, error };
  if (!assertions)
    return {
      passed: false,
      assertions,
      error: "plugins.checkAssertionsRequired",
    };
  return { passed: true, assertions };
}
