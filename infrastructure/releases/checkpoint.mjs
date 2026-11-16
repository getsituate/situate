import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { sshArguments } from "./transport.mjs";
import {
  checkpointIdentity,
  createRestoreDirectory,
  writeRestoredFile,
  validateRestoredCheckpoint,
} from "../../tools/release-checkpoint.mjs";

export function checkpointProgram() {
  return (
    ["remote.py", "allocator.py", "checkpoint.py"]
      .map((name) =>
        readFileSync(new URL(name, import.meta.url), "utf8").replace(
          "if __name__ == '__main__':",
          "if False:",
        ),
      )
      .join("\n") + "\ncheckpoint_main()\n"
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
      "ssh",
      [
        ...sshArguments(config),
        `python3 -u -c 'import base64;exec(base64.b64decode("${code}"))'`,
      ],
      { env, stdio: ["pipe", "pipe", "pipe"] },
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
      createRestoreDirectory(destination);
      for (const name of [
        "plan.json",
        "configuration.json",
        "operation.json",
      ]) {
        const item = result.descriptor.files.find((item) => item.name === name);
        assert(item, "Missing bootstrap metadata");
        writeRestoredFile(
          destination,
          item,
          Buffer.from(result.metadata[name], "base64"),
        );
      }
      const parent = openSync(destination, "r");
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
      const plan = JSON.parse(readFileSync(`${destination}/plan.json`, "utf8"));
      const { validatePlan, digest } =
        await import("../../tools/pipeline-state.mjs");
      validatePlan(plan);
      assert.deepEqual(checkpointIdentity(plan), result.descriptor.identity);
      assert.equal(
        digest(readFileSync(`${destination}/configuration.json`)),
        plan.configurationDigest,
      );
      return {
        directory: destination,
        planFile: `${destination}/plan.json`,
        configurationFile: `${destination}/configuration.json`,
      };
    },
    inspect: ({ plan }) =>
      exchange({ action: "inspect", identity: checkpointIdentity(plan) }),
    async restore({ plan, checkpointId, inspectionDigest, destination }) {
      createRestoreDirectory(destination);
      const descriptor = await exchange(
        {
          action: "restore",
          identity: checkpointIdentity(plan),
          checkpointId,
          inspectionDigest,
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
                  descriptor.files?.length <= 16,
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
                  fd = openSync(join(destination, item.name), "wx", 0o600);
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
            const parent = openSync(destination, "r");
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
      validateRestoredCheckpoint(descriptor, destination, plan);
      return { descriptor, directory: destination };
    },
  };
}
