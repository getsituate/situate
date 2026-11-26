import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import archive from "../crates/situate-fixtures/src/full_workspace/archive.js";
import {
  validateLibraryDescriptor,
  validateLibraryResult,
} from "../app/src/ai/document-sources/contract.js";

const run = promisify(execFile);
const exports = archive({ pluginId: "garden-archive" }).exports;

test("reads only references belonging to the configured folder", async () => {
  const host = {
    config: {
      read: async () => ({
        text: '{"folder":"/synthetic/archive"}',
        revision: "fixture-folder",
      }),
    },
  };
  const descriptor = validateLibraryDescriptor(
    await exports.documentLibraryDescribe({}, host),
  );
  for (const ref of [
    ...[
      "../secret.pdf",
      ".hidden.pdf",
      "folder/nested.pdf",
      "folder\\nested.pdf",
      "drive:receipt.pdf",
    ].map((id) => ({
      source: descriptor.source,
      id,
      identity: "path",
      revision: "1",
    })),
    {
      source: { ...descriptor.source, instanceId: "another-folder" },
      id: "receipt.pdf",
      identity: "path",
      revision: "1",
    },
  ]) {
    const original = await exports.documentLibraryReadOriginal({ ref }, host);
    const details = await exports.documentLibraryDetails(
      { ref, locale: "en" },
      host,
    );
    assert.equal(original.error.code, "permission");
    assert.equal(details.error.code, "permission");
  }
});

test("orders names consistently across pages without locale-dependent sorting", async () => {
  const host = {
    signal: new AbortController().signal,
    config: {
      read: async () => ({
        text: '{"folder":"/synthetic/archive"}',
        revision: "fixture-folder",
      }),
    },
    process: {
      capability: async () => ({
        available: true,
        interpreterDialect: "posixSh",
        interpreter: "/bin/sh",
        interpreterArgs: ["-c"],
      }),
      run: async () => ({
        commandResult: {
          Ok: {
            outcome: "exited",
            exitCode: 0,
            stdout: {
              text: [
                "apple.pdf",
                "1:1",
                "Zebra.pdf",
                "1:2",
                "Éclair.pdf",
                "1:3",
                "",
              ].join("\0"),
            },
          },
        },
      }),
    },
  };
  const first = await exports.documentLibraryList({ limit: 1 }, host);
  assert.deepEqual(
    first.items.map(({ title }) => title),
    ["Zebra.pdf"],
  );
  const next = await exports.documentLibraryList(
    { limit: 2, continuation: first.next },
    host,
  );
  assert.deepEqual(
    next.items.map(({ title }) => title),
    ["apple.pdf", "Éclair.pdf"],
  );
  assert.equal(next.truncated, false);
});

test(
  "discovers, searches and reopens real files from a configured folder",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "Situate's sample-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, "Archive");
    await mkdir(folder);
    await mkdir(join(folder, "Hidden from the collection"));
    await writeFile(
      join(folder, "Hidden from the collection", "Nested.pdf"),
      "nested",
    );
    await writeFile(join(folder, "Bed map.png"), "image fixture");
    await writeFile(join(folder, "Seed swap.PDF"), "synthetic receipt");
    await writeFile(join(folder, ".Private.pdf"), "hidden");
    await writeFile(join(folder, "Notes.txt"), "unsupported");
    await writeFile(join(root, "Outside.pdf"), "outside");
    await symlink(join(root, "Outside.pdf"), join(folder, "Linked.pdf"));
    const requests = [];
    const host = {
      signal: new AbortController().signal,
      config: {
        read: async () => ({
          text: JSON.stringify({ folder }),
          revision: "fixture-folder",
        }),
      },
      process: {
        capability: async () => ({
          available: true,
          interpreter: "/bin/sh",
          interpreterArgs: ["-c"],
          interpreterDialect: "posixSh",
        }),
        run: async ({ executable, args }) => {
          const { stdout } = await run(executable, args, { maxBuffer: 32768 });
          return {
            commandResult: {
              Ok: { outcome: "exited", exitCode: 0, stdout: { text: stdout } },
            },
          };
        },
      },
      documents: {
        fromFile: async (path) => {
          requests.push(path);
          return {
            original: {
              id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
              size: (await readFile(path)).length,
            },
          };
        },
      },
    };
    const descriptor = validateLibraryDescriptor(
      await exports.documentLibraryDescribe({}, host),
    );
    const library = async (name, operation, args) =>
      validateLibraryResult(
        descriptor,
        operation,
        args,
        await exports[name](args, host),
      );
    const first = await library("documentLibraryList", "list", { limit: 1 });
    assert.equal(first.status, "partial");
    assert.equal(first.items[0].title, "Bed map.png");
    const second = await library("documentLibraryList", "list", {
      limit: 1,
      continuation: first.next,
    });
    assert.deepEqual(
      second.items.map(({ title }) => title),
      ["Seed swap.PDF"],
    );
    assert.equal(second.status, "ok");
    const legacy = await exports.documentSourceList({ limit: 10 }, host);
    assert.deepEqual(
      legacy.items.map(({ title }) => title),
      ["Bed map.png", "Seed swap.PDF"],
    );
    const onlyPdf = await library("documentLibrarySearch", "search", {
      limit: 10,
      query: "SWAP",
    });
    assert.deepEqual(onlyPdf.items, second.items);
    const ref = onlyPdf.items[0].ref;
    const details = await library("documentLibraryDetails", "details", {
      ref,
      locale: "de",
    });
    assert.deepEqual(details.fields, [
      { id: "filename", label: "Originaldateiname", value: "Seed swap.PDF" },
    ]);
    assert.equal(requests.length, 0);
    const original = await library(
      "documentLibraryReadOriginal",
      "readOriginal",
      { ref },
    );
    assert.equal(original.original.size, 17);
    assert.deepEqual(requests, [join(folder, "Seed swap.PDF")]);
    await writeFile(join(folder, "Seed swap.PDF"), "replacement receipt");
    const stale = await library("documentLibraryReadOriginal", "readOriginal", {
      ref,
    });
    assert.equal(stale.error.code, "not-found");
    const staleDetails = await library("documentLibraryDetails", "details", {
      ref,
      locale: "en",
    });
    assert.equal(staleDetails.error.code, "not-found");
    assert.equal(requests.length, 1);
  },
);
