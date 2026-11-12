import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { childEnvironment } from "./config.mjs";
import { stage } from "./deploy.mjs";

function docker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env: childEnvironment(),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test(
  "the production nginx configuration serves only public build files",
  { timeout: 120000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "situate-hosting-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    await stage(directory);
    const image = readFileSync(join(directory, "compose.yaml"), "utf8").match(
      /image: (\S+)/,
    )[1];
    const name = `situate-hosting-test-${randomBytes(8).toString("hex")}`;
    docker([
      "create",
      "--name",
      name,
      "--read-only",
      "--security-opt",
      "no-new-privileges:true",
      "--publish",
      "127.0.0.1::8080",
      "--tmpfs",
      "/var/cache/nginx",
      "--tmpfs",
      "/var/run",
      "--tmpfs",
      "/tmp",
      "--volume",
      `${directory}/nginx.conf:/etc/nginx/nginx.conf:ro`,
      "--volume",
      `${directory}/site:/usr/share/nginx/html:ro`,
      image,
    ]);
    t.after(() => docker(["rm", "--force", name]));
    docker(["start", name]);
    const address = docker(["port", name, "8080/tcp"]);
    const origin = `http://${address}`;
    let response;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        if (response.ok) break;
      } catch {
        /* The container may still be starting. */
      }
      await setTimeout(100);
    }
    assert.equal(response?.status, 200);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    const html = await response.text();
    assert.ok(!html.includes("{{"));
    const assets = new Set(
      [...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((match) => match[1]),
    );
    assert.ok(assets.size > 10);
    for (const asset of assets) {
      const result = await fetch(origin + asset);
      assert.equal(result.status, 200, asset);
      await result.arrayBuffer();
    }
    for (const path of [
      "/.env",
      "/.git/config",
      "/site.mjs",
      "/messages.en.json",
      "/media/birthday-fixture.json",
      "/media/manifest.json",
      "/missing",
    ]) {
      const result = await fetch(origin + path);
      assert.equal(result.status, 404, path);
      assert.equal(result.headers.get("x-robots-tag"), "noindex, nofollow");
      await result.arrayBuffer();
    }
    assert.equal((await fetch(origin + "/media/")).status, 403);
    assert.equal((await fetch(origin + "/index.html")).status, 200);
    for (const path of ["/system", "/system/", "/system/index.html"]) {
      const result = await fetch(origin + path, { redirect: "manual" });
      assert.equal(result.status, 308);
      assert.equal(
        new URL(result.headers.get("location"), origin).pathname,
        "/",
      );
    }
    assert.match(
      await (await fetch(origin + "/robots.txt")).text(),
      /Disallow: \//,
    );
  },
);
