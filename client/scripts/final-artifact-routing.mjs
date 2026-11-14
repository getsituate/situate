import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import { run } from "./ios-xcode.mjs";

export function validateQualificationRouting(config) {
  const url = new URL(config?.endpoint);
  assert(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "Invalid production qualification endpoint",
  );
  assert(
    isIP(config.privateAddress) &&
      isIP(config.publicAddress) &&
      config.privateAddress !== config.publicAddress &&
      /^(lo0|utun[0-9]+)$/.test(config.interface),
    "Blocked: explicit private tunnel and public reference addresses are required",
  );
  assert(
    typeof config.identityPath === "string" &&
      config.identityPath.startsWith("/") &&
      !config.identityPath.startsWith("//") &&
      /^[a-f0-9]{64}$/.test(config.identitySha256) &&
      /^[a-f0-9]{64}$/.test(config.publicFeedSha256) &&
      typeof config.operationId === "string" &&
      config.operationId.length > 0,
    "Blocked: immutable private listener identity and unchanged public feed hashes are required",
  );
  return config;
}

export function createQualificationRouting(
  config,
  {
    execute = run,
    resolve = lookup,
    request = get,
    signal,
    environment = process.env,
  } = {},
) {
  validateQualificationRouting(config);
  const endpoint = new URL(config.endpoint);
  async function probe(url, address, expectedStatus) {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const chunks = [];
      let size = 0;
      const req = request(
        url,
        {
          signal,
          rejectUnauthorized: true,
          timeout: 30_000,
          ...(address
            ? {
                lookup: (_name, options, callback) =>
                  callback(
                    null,
                    options.all
                      ? [{ address, family: isIP(address) }]
                      : address,
                    isIP(address),
                  ),
              }
            : {}),
        },
        (response) => {
          if (response.statusCode !== expectedStatus) {
            response.resume();
            reject(
              new Error(
                "Private listener isolation or public pointer probe failed",
              ),
            );
            return;
          }
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024)
              response.destroy(
                new Error("Qualification route probe exceeded size limit"),
              );
            else {
              hash.update(chunk);
              chunks.push(chunk);
            }
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              sha256: hash.digest("hex"),
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("timeout", () =>
        req.destroy(new Error("Qualification route probe timed out")),
      );
      req.on("error", reject);
    });
  }
  return {
    async inspect() {
      const resolved = await resolve(endpoint.hostname, { all: true });
      assert(
        resolved.length > 0 &&
          resolved.every((entry) => entry.address === config.privateAddress),
        "Production hostname is not restricted to the private route",
      );
      const route = await execute(
        "route",
        ["-n", "get", config.privateAddress],
        { capture: true, signal, env: { PATH: environment.PATH } },
      );
      const actualInterface = /^\s*interface:\s*(\S+)\s*$/m.exec(route)?.[1];
      assert(
        actualInterface === config.interface,
        "Production hostname is not routed through the configured restricted interface",
      );
      const identityUrl = new URL(config.identityPath, endpoint.origin);
      const identity = await probe(identityUrl, undefined, 200);
      assert(
        identity.sha256 === config.identitySha256 &&
          JSON.parse(identity.bytes).operationId === config.operationId,
        "Private TLS listener identity differs from the reserved operation",
      );
      await probe(identityUrl, config.publicAddress, 404);
      const publicFeed = await probe(endpoint, config.publicAddress, 200);
      assert(
        publicFeed.sha256 === config.publicFeedSha256,
        "Public production feed changed during isolated qualification",
      );
      const feed = JSON.parse(publicFeed.bytes);
      const publicSignatures = Object.fromEntries(
        ["darwin-aarch64", "darwin-x86_64"].map((target) => [
          target,
          feed.platforms?.[target]?.signature,
        ]),
      );
      assert(
        typeof feed.version === "string" &&
          /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
            feed.version,
          ) &&
          Object.values(publicSignatures).every(
            (signature) =>
              typeof signature === "string" &&
              signature.length <= 16384 &&
              /^[A-Za-z0-9+/]+={0,2}$/.test(signature),
          ),
        "Public production feed is missing a valid version or macOS updater signature",
      );
      return {
        endpoint: config.endpoint,
        publicVersion: feed.version,
        publicSignatures,
        isolatedRouting: true,
        normalTls: true,
        publicPointerUnchanged: true,
      };
    },
  };
}
