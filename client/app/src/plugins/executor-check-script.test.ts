import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runCheckScript } from "./executor-check-script";

const context = { plugin: {}, host: {}, preview: {} };
beforeEach(() => vi.stubGlobal("document", undefined));
afterEach(() => vi.unstubAllGlobals());

it("awaits invocation-bound tools and preview acknowledgements", async () => {
  const invokeTool = vi.fn().mockResolvedValue({ value: 7 });
  const open = vi.fn().mockResolvedValue(true);
  const host = { marker: "host" };
  await expect(
    runCheckScript(
      'const result = await plugin.invokeTool("read", {}); await preview.open("view"); assert.equal(result, {value:7}); assert.equal(host.marker, "host");',
      { plugin: { invokeTool }, host, preview: { open } },
    ),
  ).resolves.toEqual({ passed: true, assertions: 2 });
  expect(invokeTool).toHaveBeenCalledWith("read", {});
  expect(open).toHaveBeenCalledWith("view");
});

it("compares native-sorted nested results independently of object key order", async () => {
  const result = {
    details: {
      config: "consumer config",
      credential: "consumer credential",
      data: "consumer data",
      provider: {
        config: "connection config",
        credential: "connection credential",
        data: "connection data",
        reply: "connection reply",
        version: "first",
      },
      version: "first",
    },
  };
  await expect(
    runCheckScript(
      `
    const result = await plugin.invokeTool('read', {});
    assert.equal(result.details, { version: 'first', provider: { version: 'first', config: 'connection config', data: 'connection data', credential: 'connection credential', reply: 'connection reply' }, config: 'consumer config', data: 'consumer data', credential: 'consumer credential' });
    assert.equal([{second:2,first:1},{last:4,next:3}], [{first:1,second:2},{next:3,last:4}]);
  `,
      { ...context, plugin: { invokeTool: async () => result } },
    ),
  ).resolves.toEqual({ passed: true, assertions: 2 });
});

it.each([
  ["[1, 2]", "[2, 1]"],
  ["[1]", '{"0":1}'],
  ["{value:1}", '{value:"1"}'],
  ["{value:null}", "{}"],
  ["{left:1}", "{right:1}"],
  ["{nested:{value:1}}", "{nested:{value:2}}"],
])(
  "distinguishes JSON structure and values: %s versus %s",
  async (actual, expected) => {
    await expect(
      runCheckScript(`assert.equal(${actual}, ${expected})`, context),
    ).resolves.toMatchObject({
      passed: false,
      assertions: 0,
      error: "plugins.checkAssertionFailed",
      failure: { assertion: 1, operator: "equal" },
    });
  },
);

it.each([
  "try { assert.ok(false) } catch {} assert.ok(true)",
  "try { assert.equal(1, 2) } catch {} assert.ok(true)",
  "const circular = {}; circular.self = circular; try { assert.equal(circular, {}) } catch {} assert.ok(true)",
  "const value = {get nested() {throw new Error('comparison failed')}}; try {assert.equal(value, {nested:1})} catch {} assert.ok(true)",
])("does not allow caught assertion failures to pass", async (script) => {
  await expect(runCheckScript(script, context)).resolves.toMatchObject({
    passed: false,
    assertions: 1,
    error: "plugins.checkAssertionFailed",
    failure: { assertion: 1 },
  });
});

it("requires assertions even when the script returns early", async () => {
  await expect(runCheckScript("return 42", context)).resolves.toEqual({
    passed: false,
    assertions: 0,
    error: "plugins.checkAssertionsRequired",
  });
});

it("reports unknown preview exceptions without exposing their messages", async () => {
  await expect(
    runCheckScript("await preview.open(); assert.ok(true)", {
      ...context,
      preview: {
        open: async () => {
          throw new Error("unavailable");
        },
      },
    }),
  ).resolves.toEqual({
    passed: false,
    assertions: 0,
    error: "plugins.checkFailed",
  });
});

it("retains successful assertions and the first failed comparison", async () => {
  await expect(
    runCheckScript(
      "assert.ok(true); try { assert.equal({count:2}, {count:3}); } catch {} assert.ok(true); try { assert.ok(false); } catch {}",
      context,
    ),
  ).resolves.toEqual({
    passed: false,
    assertions: 2,
    error: "plugins.checkAssertionFailed",
    failure: {
      assertion: 2,
      operator: "equal",
      actual: '{"count":2}',
      expected: '{"count":3}',
    },
  });
});

it("bounds assertion value previews", async () => {
  const result = await runCheckScript(
    'assert.equal("x".repeat(10000), "short")',
    context,
  );
  expect(result).toMatchObject({ passed: false });
  if (result.passed) throw new Error("Expected a failed comparison");
  expect(result.failure?.actual).toHaveLength(1024);
  expect(result.failure?.actual.endsWith("...")).toBe(true);
});

it("does not split a Unicode character when truncating a value preview", async () => {
  const result = await runCheckScript(
    'assert.equal("a" + "🌱".repeat(1000), "short")',
    context,
  );
  if (result.passed) throw new Error("Expected a failed comparison");
  expect(result.failure?.actual).toHaveLength(1023);
  expect(result.failure?.actual).not.toMatch(/[\uD800-\uDBFF]\.\.\.$/);
});

it.each([
  [
    'assert.ok(true); throw new TypeError("private payload")',
    "plugins.checkTypeError",
    1,
  ],
  ["unknownName()", "plugins.checkReferenceError", 0],
  ["const =", "plugins.checkSyntaxError", 0],
  ['throw new Error("private payload")', "plugins.checkFailed", 0],
  ['throw "private payload"', "plugins.checkFailed", 0],
  [
    'throw new Error("native.plugins.captureUnavailable")',
    "native.plugins.captureUnavailable",
    0,
  ],
])("classifies script failures: %s", async (script, error, assertions) => {
  await expect(runCheckScript(script, context)).resolves.toEqual({
    passed: false,
    assertions,
    error,
  });
});

it.each(["", " ", "x".repeat(65537)])(
  "rejects invalid scripts",
  async (script) => {
    await expect(runCheckScript(script, context)).rejects.toThrow(
      "native.plugins.invalidPath",
    );
  },
);

it("refuses execution in the UI document", async () => {
  vi.stubGlobal("document", {});
  await expect(runCheckScript("assert.ok(true)", context)).rejects.toThrow(
    "plugins.checkFailed",
  );
});
