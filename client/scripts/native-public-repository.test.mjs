import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const directory = new URL("../app/src-tauri/tests/support/", import.meta.url);
const load = async (name) =>
  (
    await import(
      `data:text/javascript;base64,${Buffer.from(await readFile(new URL(name, directory))).toString("base64")}`
    )
  ).default;
function store(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async read(path) {
      if (!values.has(path)) throw new Error("configuration unavailable");
      return { text: values.get(path), revision: values.get(path) };
    },
    async write(path, text, revision) {
      if (revision !== (values.get(path) ?? null))
        return { Conflict: { external: await this.read(path) } };
      values.set(path, text);
      return {
        Saved: {
          version: { text, revision: text },
          history_revision: "synthetic-history",
        },
      };
    },
  };
}
const repos = ["octocat/Hello-World", "rust-lang/rust"];
const metadata = (id) =>
  JSON.stringify({
    full_name: id,
    private: false,
    html_url: `https://github.com/${id}`,
    default_branch: "main",
  });

test("public connection validates selection, shape and synthetic HTTP failures without live fallback", async () => {
  const service = (await load("public-repository-connection.js"))();
  const config = store(),
    traffic = [];
  let response = { status: 200, body: metadata(repos[0]) };
  const context = {
    config,
    network: {
      request: async (request) => {
        traffic.push(request);
        assert.deepEqual(request, {
          url: `https://api.github.com/repos/${repos[0]}`,
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Situate-Public-Repository-Qualification",
          },
        });
        if (!response) throw new Error("unmatched synthetic HTTP");
        return response;
      },
    },
  };
  await assert.rejects(
    service.exports.read({ sources: repos }, context),
    /configuration-unavailable/,
  );
  await config.write("sources.json", "[]", null);
  await assert.rejects(
    service.exports.read({ sources: repos }, context),
    /not-configured/,
  );
  await service.exports.configure(
    { sources: repos, expectedRevision: "[]" },
    context,
  );
  await assert.rejects(
    service.exports.read({ sources: ["other/repo"] }, context),
    /source-not-selected/,
  );
  assert.equal(traffic.length, 0);
  assert.deepEqual(
    await service.exports.read({ sources: [repos[0]] }, context),
    [
      {
        fullName: repos[0],
        url: `https://github.com/${repos[0]}`,
        branch: "main",
      },
    ],
  );
  for (const [status, reason] of [
    [401, "access-denied"],
    [403, "access-denied"],
    [404, "missing-resource"],
    [500, "http-failure:500"],
  ]) {
    response = { status, body: "{}" };
    await assert.rejects(
      service.exports.read({ sources: [repos[0]] }, context),
      new RegExp(reason),
    );
  }
  response = { status: 200, body: metadata(repos[1]) };
  await assert.rejects(
    service.exports.read({ sources: [repos[0]] }, context),
    /invalid-repository/,
  );
  response = undefined;
  await assert.rejects(
    service.exports.read({ sources: [repos[0]] }, context),
    /unmatched synthetic HTTP/,
  );
});
test("native consumers retain independent selections after provider expansion and combine two connections", async () => {
  const provider = (await load("public-repository-connection.js"))();
  const providerHost = {
    config: store({ "sources.json": JSON.stringify(repos) }),
    network: {
      request: async ({ url }) => ({
        status: 200,
        body: metadata(url.slice("https://api.github.com/repos/".length)),
      }),
    },
  };
  const files = store(),
    brief = (await load("public-repository-files.js"))();
  const briefHost = {
    files: {
      ...files,
      write: async (...args) => {
        const outcome = await files.write(...args);
        return outcome.Saved
          ? {
              isError: false,
              historyRevision: outcome.Saved.history_revision,
              change: { afterRevision: outcome.Saved.version.revision },
            }
          : { isError: true, outcome };
      },
    },
  };
  await brief.exports.write(
    { text: "Synthetic brief", expectedRevision: null },
    briefHost,
  );
  const factory = await load("public-repository-consumer.js");
  const consumers = repos.map((id) => ({
    service: factory(),
    host: {
      config: store({ "selection.json": JSON.stringify([id]) }),
      dependencies: {
        invoke: (plugin, name, args) =>
          (plugin === "public-repositories" ? provider : brief).exports[name](
            args,
            plugin === "public-repositories" ? providerHost : briefHost,
          ),
      },
    },
  }));
  await provider.exports.configure(
    {
      sources: [...repos, "tauri-apps/tauri"],
      expectedRevision: JSON.stringify(repos),
    },
    providerHost,
  );
  for (let index = 0; index < consumers.length; index++) {
    const result = await consumers[index].service.exports.read(
      {},
      consumers[index].host,
    );
    assert.deepEqual(
      result.details.repositories.map((repo) => repo.fullName),
      [repos[index]],
    );
    assert.equal(result.details.note, "Synthetic brief");
  }
});
test("configuration exports reject stale revisions without widening retained selections", async () => {
  for (const [filename, path, operation] of [
    ["public-repository-connection.js", "sources.json", "configure"],
    ["public-repository-consumer.js", "selection.json", "select"],
  ]) {
    const original = JSON.stringify([repos[0]]),
      config = store({ [path]: original }),
      service = (await load(filename))(),
      host = { config };
    await assert.rejects(
      service.exports[operation](
        { sources: repos, expectedRevision: "stale-revision" },
        host,
      ),
      /configuration-save-unconfirmed/,
    );
    assert.equal((await config.read(path)).text, original);
    const result = await service.exports[operation](
      { sources: repos, expectedRevision: original },
      host,
    );
    assert.ok(result.details.outcome.Saved);
    assert.equal((await config.read(path)).text, JSON.stringify(repos));
  }
});
test("configuration exports do not report history failures as successful setup", async () => {
  for (const [filename, operation] of [
    ["public-repository-connection.js", "configure"],
    ["public-repository-consumer.js", "select"],
  ]) {
    for (const outcome of [
      { SavedHistoryFailed: {} },
      { SavedDraftCleanupFailed: {} },
      "ChangedSinceReview",
    ]) {
      const service = (await load(filename))();
      await assert.rejects(
        service.exports[operation](
          { sources: repos, expectedRevision: null },
          { config: { write: async () => outcome } },
        ),
        /configuration-save-unconfirmed/,
      );
    }
  }
});
test("workspace brief does not claim success on version conflicts or history failures", async () => {
  for (const outcome of [
    { isError: true, outcome: { Conflict: {} } },
    { isError: true, warning: "synthetic" },
    { isError: false, historyRevision: null },
  ]) {
    const service = (await load("public-repository-files.js"))();
    await assert.rejects(
      service.exports.write(
        { text: "Synthetic", expectedRevision: null },
        { files: { write: async () => outcome } },
      ),
      /workspace-brief-save-unconfirmed/,
    );
  }
});
test("live runner is opt-in and delegates to the isolated native harness without service access in the controller", async () => {
  const runner = await readFile(
    new URL("test-native-live.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /process\.argv\[2\] !== "--live"/);
  assert.match(runner, /import\("\.\/test-native\.mjs"\)/);
  assert.doesNotMatch(runner, /fetch\(|curl|gh api|proxy|retry/i);
});
