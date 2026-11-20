import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { sshArguments } from "./transport.mjs";
import {
  checkpointFile,
  checkpointIdentity,
  createRestoreDirectory,
  writeRestoredFile,
  validateRestoredCheckpoint,
} from "../../tools/release-checkpoint.mjs";

export function checkpointProgram() {
  const listener = Buffer.from(
    readFileSync(new URL("./qualification-host.py", import.meta.url)),
  ).toString("base64");
  return (
    ["remote.py", "allocator.py", "checkpoint.py"]
      .map((name) =>
        readFileSync(new URL(name, import.meta.url), "utf8").replace(
          "if __name__ == '__main__':",
          "if False:",
        ),
      )
      .join("\n") +
    `\nqualification_listener = {'__name__': 'qualification_listener'}
exec(base64.b64decode('${listener}'), qualification_listener)
qualification_listener['ROOT'] = ROOT / '.qualification-host'
checkpoint_main()
`
  );
}
export function createHostCheckpointStore(
  config,
  { environment = process.env, start } = {},
) {
  const code = Buffer.from(checkpointProgram()).toString("base64");
  const env = Object.fromEntries(
    ["PATH", "HOME", "SSH_AUTH_SOCK", "LANG"]
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
  start ??= () =>
    spawn(
      "/usr/bin/ssh",
      [
        ...sshArguments(config),
        `python3 -u -c 'import base64;exec(base64.b64decode("${code}"))'`,
      ],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
  const stagingDirectory = (destination) => {
    assert(
      !lstatSync(destination, { throwIfNoEntry: false }),
      "Restore destination already exists",
    );
    const staging = join(
      dirname(destination),
      `.release-restore-incomplete-${randomUUID()}`,
    );
    createRestoreDirectory(staging);
    return staging;
  };
  const commitRestore = (staging, destination) =>
    execFileSync(
      "/usr/bin/python3",
      [
        fileURLToPath(new URL("./checkpoint-commit.py", import.meta.url)),
        staging,
        destination,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
  async function exchange(request, files = [], receive) {
    const child = start();
    child.stderr.resume();
    child.stdin.on("error", () => {});
    const closed = new Promise((resolve) => {
      child.once("error", () => resolve(-1));
      child.once("close", resolve);
    });
    const send = async (bytes) => {
      if (!child.stdin.write(bytes)) await once(child.stdin, "drain");
    };
    const output = (async () => {
      if (receive) return receive(child.stdout);
      let bytes = Buffer.alloc(0);
      for await (const chunk of child.stdout) {
        bytes = Buffer.concat([bytes, chunk]);
        assert(
          bytes.length <= 1024 * 1024,
          "Checkpoint response exceeds bound",
        );
      }
      return JSON.parse(bytes.toString("utf8"));
    })();
    try {
      await send(Buffer.from(`${JSON.stringify(request)}\n`));
      for (const file of files) {
        if (file.bytes) await send(file.bytes);
        else {
          const fd = openSync(
            file.file,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          const stat = fstatSync(fd);
          if (
            !stat.isFile() ||
            stat.nlink !== 1 ||
            stat.uid !== process.getuid()
          ) {
            closeSync(fd);
            throw new Error("Invalid checkpoint payload");
          }
          for await (const block of createReadStream(file.file, { fd }))
            await send(block);
        }
      }
      child.stdin.end();
      const result = await output;
      assert.equal(
        await closed,
        0,
        "Checkpoint connection lost; inspect instead of replaying",
      );
      return result;
    } catch (error) {
      child.stdin.destroy();
      child.kill("SIGTERM");
      await output.catch(() => {});
      await closed;
      throw new Error(
        "Checkpoint transfer failed; inspect instead of replaying",
        { cause: error },
      );
    }
  }
  return {
    async commit({ descriptor, files, inspectionDigest }) {
      const result = await exchange(
        {
          action: "stage",
          identity: descriptor.identity,
          descriptor,
          ...(inspectionDigest ? { inspectionDigest } : {}),
        },
        files,
      );
      assert(
        result.durable === true &&
          result.checkpointId === descriptor.checkpointId,
        "Checkpoint has no durable acknowledgement",
      );
      return result;
    },
    async bootstrap({ operationId, destination }) {
      const result = await exchange({
        action: "bootstrap",
        identity: { operationId },
      });
      assert.equal(result.descriptor.identity.operationId, operationId);
      const staging = stagingDirectory(destination);
      for (const name of [
        "plan.json",
        "configuration.json",
        "operation.json",
      ]) {
        const item = result.descriptor.files.find((item) => item.name === name);
        assert(item, "Missing bootstrap metadata");
        writeRestoredFile(
          staging,
          item,
          Buffer.from(result.metadata[name], "base64"),
        );
      }
      const parent = openSync(
        staging,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        const info = fstatSync(parent);
        assert(
          info.uid === process.getuid() && !(info.mode & 0o077),
          "Restore staging must be an owned private directory",
        );
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
      const plan = JSON.parse(checkpointFile(join(staging, "plan.json")));
      const { validatePlan, digest } =
        await import("../../tools/pipeline-state.mjs");
      validatePlan(plan);
      assert.deepEqual(checkpointIdentity(plan), result.descriptor.identity);
      assert.equal(
        digest(checkpointFile(join(staging, "configuration.json"))),
        plan.configurationDigest,
      );
      commitRestore(staging, destination);
      return {
        directory: destination,
        planFile: `${destination}/plan.json`,
        configurationFile: `${destination}/configuration.json`,
      };
    },
    inspect: ({ plan }) =>
      exchange({ action: "inspect", identity: checkpointIdentity(plan) }),
    restoreQualified(request) {
      return this.restore({ ...request, qualified: true });
    },
    async restore({
      plan,
      checkpointId,
      inspectionDigest,
      destination,
      qualified = false,
      draftId,
    }) {
      const staging = stagingDirectory(destination);
      const descriptor = await exchange(
        {
          action: qualified ? "restore-qualified" : "restore",
          identity: checkpointIdentity(plan),
          checkpointId,
          inspectionDigest,
          ...(draftId !== undefined ? { draftId } : {}),
        },
        [],
        async (stream) => {
          let buffer = Buffer.alloc(0);
          let descriptor;
          let index = 0;
          let fd;
          let size = 0;
          let hash;
          try {
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
              if (!descriptor) {
                const end = buffer.indexOf(10);
                if (end < 0) {
                  assert(
                    buffer.length <= 65536,
                    "Oversized checkpoint descriptor",
                  );
                  continue;
                }
                descriptor = JSON.parse(buffer.subarray(0, end));
                buffer = buffer.subarray(end + 1);
                assert.equal(descriptor.checkpointId, checkpointId);
                assert(
                  Array.isArray(descriptor.files) &&
                    descriptor.files.length >= 3 &&
                    descriptor.files.length <= 24 &&
                    descriptor.files.every(
                      (item) =>
                        Number.isSafeInteger(item.size) && item.size >= 0,
                    ) &&
                    descriptor.files.reduce(
                      (total, item) => total + item.size,
                      0,
                    ) <=
                      16 * 1024 ** 3,
                  "Invalid checkpoint inventory",
                );
              }
              while (index < descriptor.files.length) {
                const item = descriptor.files[index];
                if (fd === undefined) {
                  assert(
                    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(item.name) &&
                      Number.isSafeInteger(item.size) &&
                      item.size >= 0 &&
                      item.size <= 16 * 1024 ** 3,
                    "Invalid checkpoint inventory",
                  );
                  fd = openSync(join(staging, item.name), "wx", 0o600);
                  size = 0;
                  hash = createHash("sha256");
                }
                const count = Math.min(buffer.length, item.size - size);
                const bytes = buffer.subarray(0, count);
                for (let offset = 0; offset < bytes.length;)
                  offset += writeSync(fd, bytes, offset);
                hash.update(bytes);
                size += count;
                buffer = buffer.subarray(count);
                if (size !== item.size) break;
                assert.equal(
                  hash.digest("hex"),
                  item.sha256,
                  "Restored checkpoint hash differs",
                );
                fsyncSync(fd);
                closeSync(fd);
                fd = undefined;
                index++;
              }
            }
            assert(
              descriptor &&
                index === descriptor.files.length &&
                buffer.length === 0,
              "Incomplete checkpoint download",
            );
            const parent = openSync(
              staging,
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            try {
              fsyncSync(parent);
            } finally {
              closeSync(parent);
            }
            return descriptor;
          } finally {
            if (fd !== undefined) closeSync(fd);
          }
        },
      );
      let retained;
      if (qualified) {
        const { validateQualifiedRestore } =
          await import("../../tools/release-checkpoint-qualified.mjs");
        retained = validateQualifiedRestore(descriptor, staging, plan);
        const bytes = Buffer.from(`${JSON.stringify(descriptor)}\n`);
        writeRestoredFile(
          staging,
          {
            name: "qualified-restore.json",
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
          bytes,
        );
        const parent = openSync(
          staging,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          fsyncSync(parent);
        } finally {
          closeSync(parent);
        }
      } else validateRestoredCheckpoint(descriptor, staging, plan);
      commitRestore(staging, destination);
      return qualified
        ? {
            ...retained,
            directory: destination,
            mapping: { ...retained.mapping, directory: destination },
          }
        : { descriptor, directory: destination };
    },
  };
}
