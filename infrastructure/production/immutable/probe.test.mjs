import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { observeHost, observeHttps } from "./probe.mjs";

const sourceRevision = "a".repeat(40);
const fixture = {
  generation: "next",
  sourceRevision,
  imageId: "123",
  serverId: "124",
  volumeId: "125",
  ipv4: "192.0.2.16",
  ipv6: "2001:db8::16",
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const base = "https://getsituate.com/releases/1.2.3";
const dmg = digest("DMG");
const updater = digest("updater");
const sig = digest("signature");
const download = JSON.stringify({
  distribution: "direct",
  version: "1.2.3",
  url: `${base}/Situate.dmg`,
  sha256: dmg,
});
const platform = { url: `${base}/Situate.tar.gz`, signature: "signature" };
const update = JSON.stringify({
  distribution: "direct",
  version: "1.2.3",
  platforms: { "darwin-aarch64": platform, "darwin-x86_64": platform },
});

function api({ serverId = 124 } = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer fixture");
    if (url === "https://api.hetzner.cloud/v1/servers/124")
      return new Response(
        JSON.stringify({
          server: {
            id: 124,
            name: "getsituate-next",
            image: { id: 123 },
            labels: { source_revision: sourceRevision },
            status: "running",
            public_net: {
              ipv4: { ip: fixture.ipv4 },
              ipv6: { ip: "2001:db8::/64" },
            },
          },
        }),
      );
    assert.equal(url, "https://api.hetzner.cloud/v1/volumes/125");
    return new Response(
      JSON.stringify({ volume: { id: 125, server: serverId } }),
    );
  };
}

test("provider probe binds the running image, public IP and exact attachment", async () => {
  const token = "fixture";
  assert.deepEqual(await observeHost(fixture, { token, fetcher: api() }), {
    ipv4: fixture.ipv4,
    ipv6: fixture.ipv6,
  });
  await assert.rejects(
    observeHost(fixture, { token, fetcher: api({ serverId: 999 }) }),
    /not attached/,
  );
  await assert.rejects(
    observeHost({ ...fixture, imageId: "999" }, { token, fetcher: api() }),
    /expected running image/,
  );
});

test("HTTPS checks both candidate addresses and optionally the public route; it rejects stale bytes", async () => {
  const expected = {
    ...fixture,
    downloadSha256: digest(download),
    updateSha256: digest(update),
    updaterSha256: updater,
    signatureSha256: sig,
    public: true,
  };
  const routes = new Set();
  async function request(args, { capture }) {
    const target = new URL(args.at(-1));
    routes.add(args[0] === "--resolve" ? args[1].split(":443:")[1] : "public");
    if (target.host !== "getsituate.com")
      return Buffer.from("301 https://getsituate.com/cutover-probe?test=1");
    const path = target.pathname;
    if (path === "/healthz") return Buffer.from("ok\n");
    if (path === "/") return Buffer.from("200 text/html; charset=utf-8");
    if (path.endsWith("/download.json")) return Buffer.from(download);
    if (path.endsWith("/update.json")) return Buffer.from(update);
    assert.equal(capture, false);
    return path.endsWith(".dmg") ? dmg : path.endsWith(".sig") ? sig : updater;
  }
  const options = {
    request,
    lookup4: async () => [fixture.ipv4],
    lookup6: async () => [fixture.ipv6],
  };
  await observeHttps(expected, options);
  assert.deepEqual(routes, new Set([fixture.ipv4, `[${fixture.ipv6}]`]));
  await assert.rejects(
    observeHttps(expected, {
      ...options,
      lookup6: async () => ["2001:db8::99"],
    }),
    /Public DNS/,
  );
  await assert.rejects(
    observeHttps({ ...expected, updateSha256: digest("stale") }, options),
    /frozen publication/,
  );
  await assert.rejects(
    observeHttps({ ...expected, updaterSha256: digest("stale") }, options),
    /differs/,
  );
});
