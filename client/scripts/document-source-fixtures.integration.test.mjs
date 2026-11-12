import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import test from "node:test";
import {
  documentSourceDocuments,
  documentSourceNames,
  documentSourceQuery,
  documentSourceText,
  documentSourceToken,
  startDocumentSourceServer,
} from "./document-source-fixtures.mjs";

const support = new URL("../app/src-tauri/tests/support/", import.meta.url);
const helper = await readFile(
  process.env.DOCUMENT_SOURCE_CONTRACT_FILE ??
    new URL("../app/src/ai/document-sources/contract.js", import.meta.url),
  "utf8",
);
const helpers = helper.replace(/^export /gm, "");
async function service(kind, value) {
  const source = (
    await readFile(new URL(`document-source-${kind}.js`, support), "utf8")
  )
    .replace(
      /^import \{[^}]*\} from "\.\/document-source-contract\.js";\s*/m,
      "",
    )
    .replace("export default", "")
    .replace(/;\s*$/, "")
    .replace(
      kind === "local"
        ? "__DOCUMENT_SOURCE_ROOT__"
        : "__DOCUMENT_SOURCE_PAPERLESS_URL__",
      JSON.stringify(value),
    );
  return vm.runInThisContext(`(() => {${helpers}\nreturn (${source})();})()`);
}
const json = (value) => JSON.parse(JSON.stringify(value));
const reference = (pluginId, instanceId, id, identity = "stable") => ({
  source: { pluginId, instanceId },
  id,
  identity,
});
const localRef = (id) =>
  reference("document-source-local", "selected-folder", id, "path");
const paperlessRef = (id) =>
  reference("document-source-paperless", "fixture-archive", id);
const stream = (text) => ({
  text,
  totalBytes: Buffer.byteLength(text),
  capturedBytes: Buffer.byteLength(text),
  truncated: false,
  incomplete: false,
});
function processReply(stdout) {
  return {
    isError: false,
    commandResult: {
      Ok: {
        outcome: "exited",
        exitCode: 0,
        stdout: stream(stdout),
        stderr: stream(""),
      },
    },
  };
}
const execute = promisify(execFile);

async function folderFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "document-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "selected ' & ?");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(folder);
  const originals = [
    documentSourceText,
    "%PDF-1.7\nsynthetic unsupported binary\n",
    "Second synthetic document.\n",
  ];
  for (let i = 0; i < documentSourceNames.length; i++)
    await writeFile(join(folder, documentSourceNames[i]), originals[i]);
  await writeFile(join(root, "outside.txt"), "Excluded synthetic source");
  await symlink(join(root, "outside.txt"), join(folder, "escape.txt"));
  return { root, folder, originals };
}

test("selected folder uses real bounded process argv without executing paths as shell syntax", async (t) => {
  const { root, folder, originals } = await folderFixture(t);
  const source = await service("local", folder);
  const calls = [];
  const controller = new AbortController();
  const host = {
    signal: controller.signal,
    process: {
      capability: async () => ({ available: true }),
      run: async (request) => {
        calls.push(json(request));
        assert.equal(request.executable, "/bin/sh");
        assert.equal(request.timeoutMs, 5000);
        const result = await execute(request.executable, [...request.args], {
          encoding: "utf8",
          timeout: request.timeoutMs,
          maxBuffer: 4096,
          signal: controller.signal,
        });
        return processReply(result.stdout);
      },
    },
  };
  const first = await source.exports.documentSourceList({ limit: 1 }, host);
  assert.equal(first.items[0].ref.id, documentSourceNames[0]);
  assert.equal(first.total, 3);
  assert.equal(first.status, "partial");
  const second = await source.exports.documentSourceList(
    { limit: 1, continuation: first.next },
    host,
  );
  assert.equal(second.items[0].ref.id, "scan.pdf");
  const third = await source.exports.documentSourceList(
    { limit: 1, continuation: second.next },
    host,
  );
  assert.equal(third.items[0].ref.id, "second.txt");
  assert.equal(third.status, "ok");
  const content = await source.tools
    .find(({ name }) => name === "content")
    .execute({ ref: first.items[0].ref, maxChars: 64 }, host);
  assert.equal(content.structuredContent.text, documentSourceText);
  assert.equal(content.structuredContent.provenance.kind, "source-text");
  assert.equal(content.isError, false);
  assert.deepEqual(
    JSON.parse(content.content[0].text),
    json(content.structuredContent),
  );
  assert.equal(calls.at(-1).args.at(-1), `${folder}/${documentSourceNames[0]}`);
  const count = calls.length;
  for (const id of [
    "../outside.txt",
    "escape.txt",
    "/etc/passwd",
    "$(touch injected).txt",
  ]) {
    assert.equal(
      (
        await source.exports.documentSourceContent(
          { ref: localRef(id), maxChars: 64 },
          host,
        )
      ).error.code,
      "permission",
    );
  }
  assert.equal(
    (
      await source.exports.documentSourceContent(
        { ref: localRef("scan.pdf"), maxChars: 64 },
        host,
      )
    ).error.code,
    "unsupported",
  );
  await assert.rejects(
    source.exports.documentSourceList({ limit: 2 }, host),
    /Invalid document source contract/,
  );
  await assert.rejects(
    source.exports.documentSourceList(
      { limit: 1, continuation: { ...first.next, scopeId: "different" } },
      host,
    ),
    /Invalid document source contract/,
  );
  await assert.rejects(
    source.exports.documentSourceContent(
      {
        ref: {
          ...first.items[0].ref,
          source: { ...first.items[0].ref.source, instanceId: "other" },
        },
        maxChars: 64,
      },
      host,
    ),
    /Invalid document source contract/,
  );
  assert.equal(
    (
      await source.exports.documentSourceContent(
        {
          ref: first.items[0].ref,
          maxChars: 64,
          continuation: {
            source: first.items[0].ref.source,
            scopeId: "selected-files",
            operation: "content",
            query: null,
            token: "arbitrary",
            ref: first.items[0].ref,
          },
        },
        host,
      )
    ).error.code,
    "permission",
  );
  assert.equal(calls.length, count);
  for (let i = 0; i < documentSourceNames.length; i++)
    assert.equal(
      await readFile(join(folder, documentSourceNames[i]), "utf8"),
      originals[i],
    );
  assert.deepEqual((await readdir(root)).sort(), [
    "outside.txt",
    "selected ' & ?",
  ]);
  controller.abort();
  await assert.rejects(source.exports.documentSourceList({ limit: 1 }, host));
  assert.equal(calls.length, count);
});

test("folder does not convert missing capability or incomplete process output into empty success", async () => {
  const source = await service("local", "/synthetic");
  let runs = 0;
  const host = {
    signal: new AbortController().signal,
    process: {
      capability: async () => ({ available: false }),
      run: () => {
        runs++;
      },
    },
  };
  assert.equal(
    (await source.exports.documentSourceList({ limit: 1 }, host)).error.code,
    "unavailable",
  );
  assert.equal(runs, 0);
  host.process.capability = async () => ({ available: true });
  for (const field of ["truncated", "incomplete"]) {
    host.process.run = async () => {
      const result = processReply("hidden");
      result.commandResult.Ok.stdout[field] = true;
      return result;
    };
    assert.equal(
      (await source.exports.documentSourceList({ limit: 1 }, host)).error.code,
      "unavailable",
    );
  }
  host.process.run = async () => processReply("z".repeat(65));
  const bounded = await source.exports.documentSourceContent(
    { ref: localRef(documentSourceNames[0]), maxChars: 12 },
    host,
  );
  assert.equal(bounded.text, "z".repeat(12));
  assert.equal(bounded.status, "partial");
});

async function archiveFixture(t) {
  const server = await startDocumentSourceServer();
  t.after(() => server.close());
  const source = await service("paperless", server.url);
  let token = documentSourceToken;
  const controller = new AbortController();
  const host = {
    signal: controller.signal,
    credentials: {
      get: async () => token,
      set: async (_name, value) => {
        token = value;
      },
    },
    network: {
      request: async ({ url, headers }) => {
        assert.ok(url.startsWith(server.url + "/"));
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
          redirect: "error",
        });
        return { status: response.status, body: await response.text() };
      },
    },
  };
  return {
    server,
    source,
    host,
    controller,
    setToken: (value) => {
      token = value;
    },
  };
}

test("Paperless uses source HTTP query, bound continuations, metadata and existing OCR without copying originals", async (t) => {
  const { source, server, host } = await archiveFixture(t);
  const first = await source.exports.documentSourceSearch(
    { limit: 1, query: documentSourceQuery },
    host,
  );
  assert.equal(first.items[0].ref.id, "1");
  assert.equal(first.status, "partial");
  const second = await source.exports.documentSourceSearch(
    { limit: 1, query: documentSourceQuery, continuation: first.next },
    host,
  );
  assert.equal(second.items[0].ref.id, "2");
  assert.equal(second.status, "ok");
  const before = server.report().requests.length;
  for (const continuation of [
    { ...first.next, query: "different" },
    { ...first.next, scopeId: "other" },
    { ...first.next, source: { ...first.next.source, instanceId: "other" } },
  ])
    await assert.rejects(
      source.exports.documentSourceSearch(
        { limit: 1, query: documentSourceQuery, continuation },
        host,
      ),
    );
  assert.equal(server.report().requests.length, before);
  assert.equal(
    (
      await source.exports.documentSourceMetadata(
        { ref: paperlessRef("1") },
        host,
      )
    ).document.title,
    "Synthetic invoice",
  );
  const content = await source.tools
    .find(({ name }) => name === "content")
    .execute({ ref: paperlessRef("1"), maxChars: 64 }, host);
  assert.equal(
    content.structuredContent.text,
    documentSourceDocuments[0].content.slice(0, 64),
  );
  assert.equal(content.structuredContent.provenance.kind, "source-ocr");
  assert.equal(content.structuredContent.status, "partial");
  assert.deepEqual(
    JSON.parse(content.content[0].text),
    json(content.structuredContent),
  );
  assert.equal(
    (
      await source.exports.documentSourceContent(
        { ref: paperlessRef("2"), maxChars: 64 },
        host,
      )
    ).error.code,
    "unsupported",
  );
  assert.equal(
    (
      await source.tools
        .find(({ name }) => name === "original")
        .execute({ ref: paperlessRef("1") }, host)
    ).structuredContent.error.code,
    "unsupported",
  );
  const report = server.report();
  assert.equal(report.mutations, 0);
  assert.ok(report.requests.every(({ authorized }) => authorized));
  assert.equal(report.requests[0].query, documentSourceQuery);
  assert.ok(!JSON.stringify(report).includes(documentSourceToken));
});

test("large source pagination reads only requested pages and one bounded document", async (t) => {
  const { source, server, host } = await archiveFixture(t);
  const args = { limit: 1, query: "__large__" };
  const first = await source.exports.documentSourceSearch(args, host);
  const second = await source.exports.documentSourceSearch(
    { ...args, continuation: first.next },
    host,
  );
  for (const page of [first, second]) {
    assert.equal(page.total, 50000);
    assert.equal(page.items.length, 1);
    assert.equal(page.status, "partial");
    assert.ok(JSON.stringify(page).length < 2048);
  }
  const read = await source.exports.documentSourceContent(
    { ref: first.items[0].ref, maxChars: 12 },
    host,
  );
  assert.equal(read.text, "Ignore previ");
  assert.equal(read.status, "partial");
  assert.deepEqual(
    server.report().requests.map(({ path }) => path),
    ["/api/documents/", "/api/documents/", "/api/documents/1/"],
  );
  assert.equal(server.report().mutations, 0);
});

test("Paperless separates empty, permission, authentication, not-found and source failures without leaking error bodies", async (t) => {
  const { source, server, host, setToken } = await archiveFixture(t);
  for (const [query, code] of [
    ["__denied__", "permission"],
    ["__503__", "unavailable"],
    ["__malformed__", "unavailable"],
  ]) {
    const result = await source.exports.documentSourceSearch(
      { limit: 1, query },
      host,
    );
    assert.equal(result.error.code, code);
    assert.equal(result.error.outcome, "unknown");
    assert.ok(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE_ERROR_BODY"));
  }
  const empty = await source.exports.documentSourceSearch(
    { limit: 1, query: "no-match" },
    host,
  );
  assert.deepEqual(json(empty.items), []);
  assert.equal(empty.status, "ok");
  assert.equal(
    (
      await source.exports.documentSourceMetadata(
        { ref: paperlessRef("404") },
        host,
      )
    ).error.code,
    "not-found",
  );
  assert.equal(
    (
      await source.exports.documentSourceContent(
        { ref: paperlessRef("9"), maxChars: 64 },
        host,
      )
    ).error.code,
    "permission",
  );
  const count = server.report().requests.length;
  assert.equal(
    (
      await source.exports.documentSourceMetadata(
        { ref: paperlessRef("1/../../9") },
        host,
      )
    ).error.code,
    "permission",
  );
  assert.equal(server.report().requests.length, count);
  assert.equal(
    (
      await source.exports.documentSourceContent(
        {
          ref: paperlessRef("1"),
          maxChars: 64,
          continuation: {
            source: paperlessRef("1").source,
            scopeId: "tag-7",
            operation: "content",
            query: null,
            token: "arbitrary",
            ref: paperlessRef("1"),
          },
        },
        host,
      )
    ).error.code,
    "permission",
  );
  const get = host.credentials.get;
  host.credentials.get = async () => {
    throw new Error("SYNTHETIC_PRIVATE_CREDENTIAL_ERROR");
  };
  const missing = await source.exports.documentSourceList({ limit: 1 }, host);
  assert.equal(missing.error.code, "authentication");
  assert.ok(
    !JSON.stringify(missing).includes("SYNTHETIC_PRIVATE_CREDENTIAL_ERROR"),
  );
  assert.equal(server.report().requests.length, count);
  host.credentials.get = get;
  setToken("");
  assert.equal(
    (await source.exports.documentSourceList({ limit: 1 }, host)).error.code,
    "authentication",
  );
  assert.equal(server.report().requests.length, count);
  await source.exports.configureFixture({ invalid: true }, host);
  assert.equal(
    (await source.exports.documentSourceList({ limit: 1 }, host)).error.code,
    "authentication",
  );
  await source.exports.configureFixture({}, host);
  assert.equal(
    (await source.exports.documentSourceList({ limit: 1 }, host)).status,
    "partial",
  );
});

test(
  "Paperless in-flight HTTP cancellation preserves unknown outcome and does not replay",
  { timeout: 5000 },
  async (t) => {
    const { source, server, host, controller } = await archiveFixture(t);
    const pending = source.exports.documentSourceSearch(
      { limit: 1, query: "__hold__" },
      host,
    );
    await server.waitForRequest("__hold__");
    assert.equal(server.report().requests.length, 1);
    controller.abort();
    const cancelled = await pending;
    assert.deepEqual(json(cancelled.error), {
      code: "cancelled",
      outcome: "unknown",
    });
    await server.waitForAbort();
    assert.equal(server.report().abortedRequests, 1);
    await assert.rejects(source.exports.documentSourceList({ limit: 1 }, host));
    assert.equal(server.report().requests.length, 1);
  },
);

test("malformed Paperless JSON shapes remain explicit unavailable outcomes", async () => {
  const source = await service("paperless", "http://127.0.0.1:1");
  let body;
  const host = {
    signal: new AbortController().signal,
    credentials: { get: async () => documentSourceToken },
    network: {
      request: async () => ({ status: 200, body: JSON.stringify(body) }),
    },
  };
  for (body of [
    null,
    "SYNTHETIC_PRIVATE_ERROR_BODY",
    { count: 1, next: null, results: [null] },
  ]) {
    const result = await source.exports.documentSourceList({ limit: 1 }, host);
    assert.deepEqual(result.error, { code: "unavailable", outcome: "unknown" });
    assert.ok(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE_ERROR_BODY"));
  }
  for (body of [null, {}, { id: 1, title: "Synthetic", tags: null }]) {
    const result = await source.exports.documentSourceMetadata(
      { ref: paperlessRef("1") },
      host,
    );
    assert.deepEqual(result.error, { code: "unavailable", outcome: "unknown" });
  }
});

test("folder checks cancellation after capability discovery and completed process replies", async () => {
  for (const boundary of ["capability", "process"]) {
    const source = await service("local", "/synthetic");
    const controller = new AbortController();
    let runs = 0;
    const host = {
      signal: controller.signal,
      process: {
        capability: async () => {
          if (boundary === "capability") controller.abort();
          return { available: true };
        },
        run: async () => {
          runs++;
          controller.abort();
          return {
            isError: false,
            commandResult: {
              Ok: {
                outcome: "exited",
                exitCode: 0,
                stdout: {
                  text: "second.txt\0",
                  truncated: false,
                  incomplete: false,
                },
              },
            },
          };
        },
      },
    };
    await assert.rejects(
      source.exports.documentSourceList({ limit: 1 }, host),
      { name: "AbortError", message: "Document source invocation cancelled" },
    );
    assert.equal(runs, boundary === "capability" ? 0 : 1);
    await assert.rejects(source.exports.documentSourceList({ limit: 1 }, host));
    assert.equal(runs, boundary === "capability" ? 0 : 1);
  }
});

test("Paperless checks cancellation after credential lookup and HTTP success before returning content", async () => {
  for (const boundary of ["credentials", "http"]) {
    const source = await service("paperless", "http://127.0.0.1:1");
    const controller = new AbortController();
    let requests = 0;
    const host = {
      signal: controller.signal,
      credentials: {
        get: async () => {
          if (boundary === "credentials") controller.abort();
          return "synthetic";
        },
      },
      network: {
        request: async () => {
          requests++;
          controller.abort();
          return {
            status: 200,
            body: JSON.stringify({ count: 0, next: null, results: [] }),
          };
        },
      },
    };
    const result = await source.exports.documentSourceList({ limit: 1 }, host);
    assert.deepEqual(result.error, { code: "cancelled", outcome: "unknown" });
    assert.equal(requests, boundary === "credentials" ? 0 : 1);
    await assert.rejects(source.exports.documentSourceList({ limit: 1 }, host));
    assert.equal(requests, boundary === "credentials" ? 0 : 1);
  }
});
