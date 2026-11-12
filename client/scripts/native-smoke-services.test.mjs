import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const directory = new URL("../app/src-tauri/tests/support/", import.meta.url);
const read = (name) => readFile(new URL(name, directory), "utf8");
const factory = (source) =>
  vm.runInNewContext(
    `(${source.replace("export default", "").trim().replace(/;$/, "")})`,
  );
const plain = (value) => JSON.parse(JSON.stringify(value));
const require = (condition, message) => assert.ok(condition, message);
async function denied(operation, message, expected) {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = String(caught);
  }
  require(error && (!expected || error.includes(expected)), message);
}
function store() {
  const values = new Map();
  return {
    async read(path) {
      assert.ok(values.has(path), `Missing fixture ${path}`);
      return values.get(path);
    },
    async write(path, text, expected) {
      assert.equal(expected, values.get(path)?.revision ?? null);
      const version = { text, revision: `${path}:${text}` };
      values.set(path, version);
      return { Saved: { version } };
    },
  };
}

async function publicJourney(fault) {
  const source = await read("public-repository-smoke.js");
  const fixture = Object.fromEntries(
    await Promise.all(
      ["Connection", "Consumer", "Files"].map(async (kind) => [
        `publicRepository${kind}`,
        await read(`public-repository-${kind.toLowerCase()}.js`),
      ]),
    ),
  );
  fixture.publicRepositoryUi = "export default () => ({})";
  const ids = [
    "public-repositories",
    "workspace-brief",
    "repository-reader-a",
    "repository-reader-b",
  ];
  const sources = new Map(),
    manifests = new Map(),
    services = new Map(),
    configs = new Map(ids.map((id) => [id, store()])),
    files = store(),
    calls = [],
    permissions = [],
    stages = [];
  let inspections = 0;
  const invoke = async (command, args) => {
    if (command === "smoke_progress") return stages.push(args.stage);
    assert.equal(command, "smoke_public_repository_stores");
    assert.deepEqual(plain(args), { scope: "owned" });
    inspections++;
    return Promise.all([
      configs.get(ids[0]).read("sources.json"),
      files.read("repository-brief.md"),
      configs.get(ids[2]).read("selection.json"),
      configs.get(ids[3]).read("selection.json"),
    ]);
  };
  const context = (id) => ({
    config: configs.get(id),
    files: {
      read: files.read,
      async write(path, text, expected) {
        await files.write(path, text, expected);
        return { isError: false, historyRevision: "brief-history" };
      },
    },
    network: { request: () => assert.fail("Offline journey fetched metadata") },
    dependencies: {
      async invoke(target, name, args) {
        permissions.push([id, target, name, plain(args)]);
        assert.equal(manifests.get(id).dependencies.includes(target), false);
        if (fault === "permission-allowed") return {};
        throw new Error(
          fault === "unknown-command"
            ? "Unknown command plugin_executor"
            : "native.plugins.checkInvalid",
        );
      },
    },
  });
  const window = {
    async nativePluginService(scope, id) {
      assert.equal(scope, "owned");
      return {
        async invoke(name, args) {
          calls.push([id, name]);
          const value = await services.get(id).exports[name](args, context(id));
          if (
            fault === "consumer-widened" &&
            name === "configure" &&
            args.sources.length === 3
          ) {
            const config = configs.get(ids[2]);
            const before = await config.read("selection.json");
            await config.write(
              "selection.json",
              JSON.stringify(args.sources),
              before.revision,
            );
          }
          return value;
        },
      };
    },
  };
  const program = vm.runInNewContext(`(async () => { ${source}\n })`, {
    fixture,
    scope: "owned",
    assignment: "assignment",
    window,
    AbortController,
    require,
    denied,
    invoke,
    sourceRequest: async (request) => assert.equal(request.operation, "create"),
    async sourceWrite(_assignment, id, path, text) {
      if (path === "plugin.json") manifests.set(id, JSON.parse(text));
      if (path === "service.js") sources.set(id, text);
    },
    async checkChanges(_assignment, args) {
      const entries = args.checks;
      if (entries.length === 2) return { needsChecks: ids.slice(2) };
      const failing =
        entries[3].script.includes("incompatible interface") ||
        Object.values(entries[0].responses).some(
          (response) => response.status !== 200,
        );
      if (fault === "check-mutated-store" && args.changes.length === 1) {
        const config = configs.get(ids[2]);
        const before = await config.read("selection.json");
        await config.write("selection.json", "[]", before.revision);
      }
      return {
        passed: !failing,
        checked: ids.map((pluginId) => ({ pluginId })),
        results: ids.map((pluginId, index) => ({
          pluginId,
          passed:
            !failing ||
            index !==
              (entries[3].script.includes("incompatible interface") ? 3 : 2),
        })),
      };
    },
    async activateGroup(_assignment, checked) {
      if (!checked.passed) return { activated: false };
      for (const [id, source] of sources) services.set(id, factory(source)());
      return { activated: true };
    },
    assertPublished: async (result) => assert.equal(result.activated, true),
    list: async () => ({
      plugins: ids.map((id) => ({ id, enabled: services.has(id) })),
    }),
  });
  await program();
  return { calls, permissions, stages, inspections };
}

test("public repository smoke inspects fixed stores but configures and probes through services", async () => {
  const result = await publicJourney();
  assert.equal(result.inspections, 4);
  assert.deepEqual(result.calls, [
    ["public-repositories", "configure"],
    ["repository-reader-a", "select"],
    ["repository-reader-b", "select"],
    ["workspace-brief", "write"],
    ["public-repositories", "configure"],
    ["repository-reader-a", "read"],
  ]);
  assert.deepEqual(result.permissions, [
    ["repository-reader-a", "repository-reader-b", "read", {}],
  ]);
  assert.deepEqual(result.stages, ["public-repository-offline-qualified"]);
});

test("permission qualification rejects successful access and unrelated IPC failures", async () => {
  for (const fault of ["permission-allowed", "unknown-command"])
    await assert.rejects(
      publicJourney(fault),
      /Consumer accessed an undeclared dependency/,
    );
});

test("persistence qualification detects trial writes and widened consumer selection", async () => {
  await assert.rejects(
    publicJourney("check-mutated-store"),
    /Synthetic checks changed original configuration or workspace stores/,
  );
  await assert.rejects(
    publicJourney("consumer-widened"),
    /Adding a shared source widened a consumer selection/,
  );
});

async function generationJourney(fault) {
  const source = await read("plugin-checks-smoke.js");
  const rust = await read("plugin_checks_smoke.rs");
  const consumer = rust.match(
    /fn consumer_source\(version: &str\) -> String \{\s*r#"([\s\S]*?)"#\.replace/,
  )[1];
  const retainedReads = [];
  let published = false;
  const service = (version, provider) => {
    const instance = factory(consumer.replaceAll("VERSION", version))();
    return {
      async invoke(name, args) {
        if (
          version === "first" &&
          published &&
          fault !== "generation-allowed" &&
          !(fault === "retained-allowed" && name === "readRetained")
        )
          throw new Error(
            fault === "unknown-command" ||
              (fault === "retained-unknown" && name === "readRetained")
              ? "Unknown command plugin_executor"
              : "native.plugins.unavailable",
          );
        const result = await instance.exports[name](args, {
          dependencies: { invoke: async () => ({ version: provider }) },
          files: {
            read: async (path) => {
              retainedReads.push([version, path]);
              return { text: "original workspace", revision: "retained" };
            },
          },
        });
        if (name === "read") {
          result.details = {
            provider: result.details.provider,
            version: result.details.version,
          };
        }
        return result;
      },
    };
  };
  const program = vm.runInNewContext(
    `(async () => { ${source.slice(source.indexOf("  const oldService ="), source.indexOf("  const notified ="))} })`,
    {
      window: {
        nativePluginService: async () =>
          published ? service("second", "edited") : service("first", "second"),
      },
      scope: "owned",
      consumer: "native-consumer",
      connection: "native-connection",
      assignment: "assignment",
      fixture: { connectionEdited: "edited", consumerSecond: "second" },
      require,
      denied,
      readService: async (service) =>
        (await service.invoke("read", {})).details,
      sourceWrite: async () => {},
      grouped: async () => ({}),
      activateGroup: async () => {
        published = true;
        return { publication: { attempt: "published" } };
      },
      assertPublished: async () => {},
      inspect: async () => ({ publication: { status: "published" } }),
    },
  );
  await program();
  return retainedReads;
}

test("native generation replacement denies a previously working retained-file export", async () => {
  assert.deepEqual(await generationJourney(), [
    ["first", "check-retained.txt"],
    ["second", "check-retained.txt"],
  ]);
});

test("stale-generation qualification rejects successful execution and unrelated IPC failures", async () => {
  for (const fault of ["generation-allowed", "unknown-command"])
    await assert.rejects(
      generationJourney(fault),
      /Revoked native service generation executed after publication/,
    );
  for (const fault of ["retained-allowed", "retained-unknown"])
    await assert.rejects(
      generationJourney(fault),
      /Revoked native service generation accessed workspace data/,
    );
});

test("store inspector has no caller-selected IDs, paths, credentials, or write operations", async () => {
  const rust = await read("plugin_checks_smoke.rs");
  const helper = rust.slice(
    rust.indexOf("pub fn smoke_public_repository_stores("),
    rust.indexOf("#[tauri::command]\npub fn smoke_plugin_source_request("),
  );
  assert.match(
    helper,
    /app: tauri::AppHandle,\s*window: tauri::WebviewWindow,\s*scope: String,\s*\) -> Result<Value, String>/,
  );
  assert.match(helper, /owned\(&app\)\?;/);
  assert.match(
    helper,
    /authorization_session\(&app, window.label\(\), &scope\)\?/,
  );
  assert.match(helper, /with_authorized_read\(/);
  assert.match(helper, /owned_workspace\(&app, location\)\?/);
  assert.match(helper, /file_session\(&app, window.label\(\), &scope\)\?/);
  assert.match(helper, /Ok\(\(root, files\)\)/);
  assert.match(
    helper,
    /\|\(root, files\)\|\s*\{\s*crate::files::with_content_store\(&app, files, \|workspace\|/,
  );
  assert.deepEqual(
    [
      ...helper.matchAll(
        /storage::read\(root, "([^"]+)", Area::(\w+), "([^"]+)"\)/g,
      ),
    ].map((match) => match.slice(1)),
    [
      ["public-repositories", "Config", "sources.json"],
      ["repository-reader-a", "Config", "selection.json"],
      ["repository-reader-b", "Config", "selection.json"],
    ],
  );
  assert.match(helper, /\.read_text\("repository-brief.md"\)/);
  assert.doesNotMatch(
    helper,
    /credentials|fs::|Area::Data|ContentStore::|with_authorization_session\(|with_operation_lease\(|\.write\(|\.save\(|drop\(/,
  );
  const handlers = await read("native_smoke.rs");
  assert.equal(
    handlers.split(
      "crate::ai::plugin_checks_smoke::smoke_public_repository_stores,",
    ).length - 1,
    1,
  );
  for (const name of ["public-repository-smoke.js", "plugin-checks-smoke.js"])
    assert.doesNotMatch(await read(name), /plugin_host_(?:open|request|close)/);
});
