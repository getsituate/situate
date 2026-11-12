import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { childEnvironment } from "../website/config.mjs";
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
  "Caddy root without DAC override reads non-owner 0644 configuration but not 0600 files",
  { timeout: 30000 },
  (t) => {
    const image = readFileSync(
      new URL("./docker/edge-compose.yaml", import.meta.url),
      "utf8",
    ).match(/image: (\S+)/)[1];
    const volume = `situate-edge-permissions-${randomBytes(8).toString("hex")}`;
    docker(["volume", "create", volume]);
    t.after(() => docker(["volume", "rm", volume]));
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--volume",
      `${volume}:/fixture`,
      "--entrypoint",
      "sh",
      image,
      "-ec",
      `
        umask 077
        printf ':8080 {\n respond "fixture"\n}\n' > /fixture/backup
        cp /fixture/backup /fixture/restrictive
        cp /fixture/backup /fixture/Caddyfile
        chmod 0644 /fixture/Caddyfile
        printf 'private compose fixture' > /fixture/compose.yaml
        chown 1001:1001 /fixture/backup /fixture/restrictive /fixture/Caddyfile /fixture/compose.yaml
      `,
    ]);
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--user",
      "0:0",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "NET_BIND_SERVICE",
      "--security-opt",
      "no-new-privileges:true",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--volume",
      `${volume}:/fixture:ro`,
      "--entrypoint",
      "sh",
      image,
      "-ec",
      `
        test "$(id -u)" = 0
        grep -Eq '^CapEff:[[:space:]]+0*400$' /proc/self/status
        test "$(stat -c '%u:%a' /fixture/Caddyfile)" = 1001:644
        test "$(stat -c '%u:%a' /fixture/restrictive)" = 1001:600
        for file in restrictive backup compose.yaml; do
          if cat "/fixture/$file" > /dev/null 2>/tmp/read-error; then
            echo "Unexpected read access: $file" >&2
            exit 1
          fi
          grep -q 'Permission denied' /tmp/read-error
        done
        if caddy validate --config /fixture/restrictive --adapter caddyfile > /tmp/validation-error 2>&1; then
          echo 'Unexpected Caddy access to restrictive configuration' >&2
          exit 1
        fi
        grep -q 'permission denied' /tmp/validation-error
        caddy validate --config /fixture/Caddyfile --adapter caddyfile
      `,
    ]);
  },
);

test(
  "imported private snippets migrate for Caddy without DAC override and restore their metadata",
  { timeout: 30000 },
  (t) => {
    const image = readFileSync(
      new URL("./docker/edge-compose.yaml", import.meta.url),
      "utf8",
    ).match(/image: (\S+)/)[1];
    const directory = mkdtempSync(
      join(tmpdir(), "situate-snippet-permissions-"),
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const volume = `situate-snippet-permissions-${randomBytes(8).toString("hex")}`;
    const name = `${volume}-writer`;
    docker(["volume", "create", volume]);
    t.after(() => {
      try {
        docker(["rm", "--force", "--volumes", name]);
      } finally {
        docker(["volume", "rm", volume]);
      }
    });
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--network",
      "none",
      "--volume",
      `${volume}:/config`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      "sleep 120",
    ]);
    docker([
      "cp",
      new URL("./edge-snippets.sh", import.meta.url).pathname,
      `${name}:/tmp/edge-snippets.sh`,
    ]);
    const copied = join(directory, "copied.caddy");
    writeFileSync(copied, "# synthetic snippet\n", { mode: 0o600 });
    docker([
      "exec",
      name,
      "sh",
      "-ec",
      `
      mkdir -p /config/sites /config/caddy /config/edge-stage.TEST
      chmod 0700 /config/edge-stage.TEST /config/caddy
      printf 'private certificate fixture' > /config/caddy/cert.fixture
      chmod 0600 /config/caddy/cert.fixture
      printf 'import /config/sites/*.caddy\n' > /config/Caddyfile
      printf ':8080 {\n respond "snippet"\n}\n' > /config/sites/reboot.caddy
      chmod 0600 /config/sites/reboot.caddy
      chown 1000:1000 /config/sites/reboot.caddy
      touch -t 202601010000 /config/sites/reboot.caddy
    `,
    ]);
    const snapshot = () =>
      docker([
        "exec",
        name,
        "sh",
        "-ec",
        `
      stat -c '%u:%g %a %Y' /config/sites/reboot.caddy /config/caddy /config/caddy/cert.fixture
      sha256sum /config/sites/reboot.caddy /config/caddy/cert.fixture
    `,
      ]);
    const before = snapshot();
    const validate = () =>
      spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--user",
          "0:0",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "NET_BIND_SERVICE",
          "--security-opt",
          "no-new-privileges:true",
          "--read-only",
          "--tmpfs",
          "/tmp",
          "--volume",
          `${volume}:/config:ro`,
          "--entrypoint",
          "caddy",
          image,
          "validate",
          "--config",
          "/config/Caddyfile",
          "--adapter",
          "caddyfile",
        ],
        { encoding: "utf8", env: childEnvironment() },
      );
    const denied = validate();
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /reboot\.caddy.*permission denied/);
    const helper = (operation) =>
      docker([
        "exec",
        name,
        "sh",
        "/tmp/edge-snippets.sh",
        operation,
        "/config/edge-stage.TEST/snippets.tar",
      ]);
    helper("backup");
    helper("migrate");
    const readable = validate();
    assert.equal(readable.status, 0, readable.stderr);
    assert.equal(snapshot(), before.replace(/^1000:1000 /, "0:0 "));
    helper("restore");
    assert.equal(snapshot(), before);
    assert.notEqual(validate().status, 0);
    for (const existing of [false, true]) {
      if (existing)
        docker([
          "exec",
          name,
          "chown",
          "1000:1000",
          "/config/sites/copied.caddy",
        ]);
      docker(["cp", copied, `${name}:/config/sites/copied.caddy`]);
      const metadata = docker([
        "exec",
        name,
        "stat",
        "-c",
        "%u:%g %a",
        "/config/sites/copied.caddy",
      ]);
      assert.match(metadata, /^\d+:\d+ 600$/);
      t.diagnostic(
        `Docker cp ${existing ? "replacement" : "creation"}: ${metadata}`,
      );
      assert.equal(
        docker(["exec", name, "cat", "/config/sites/copied.caddy"]),
        "# synthetic snippet",
      );
    }
    docker([
      "exec",
      name,
      "ln",
      "-s",
      "reboot.caddy",
      "/config/sites/link.caddy",
    ]);
    const linked = spawnSync(
      "docker",
      [
        "exec",
        name,
        "sh",
        "/tmp/edge-snippets.sh",
        "backup",
        "/config/edge-stage.TEST/snippets.tar",
      ],
      { encoding: "utf8", env: childEnvironment() },
    );
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr, /regular files without links/);
    docker([
      "exec",
      name,
      "rm",
      "/config/sites/link.caddy",
      "/config/sites/reboot.caddy",
      "/config/sites/copied.caddy",
    ]);
    helper("backup");
    helper("migrate");
    helper("restore");
    assert.equal(
      docker([
        "exec",
        name,
        "stat",
        "-c",
        "%s",
        "/config/edge-stage.TEST/snippets.tar",
      ]),
      "0",
    );
  },
);

for (const kind of ["production", "preview"]) {
  test(
    `${kind} proxy future writes and recovery remain readable without DAC override`,
    { timeout: 120000 },
    (t) => {
      const directory = mkdtempSync(join(tmpdir(), "situate-proxy-writer-"));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const production = join(directory, "production");
      const preview = join(directory, "preview");
      const base = kind === "production" ? production : preview;
      const config = join(production, "edge/Caddyfile");
      for (const path of [
        production,
        preview,
        join(production, "edge"),
        join(directory, "bin"),
      ])
        mkdirSync(path, { recursive: true });
      writeFileSync(
        config,
        "{\n auto_https off\n}\nimport /config/sites/*.caddy\ngetsituate.com {\n respond original\n}\n",
      );
      chmodSync(config, 0o644);
      const scriptPath =
        kind === "production"
          ? "./configure-proxy.sh"
          : "../website/configure-proxy.sh";
      writeFileSync(
        join(base, "configure-proxy.sh"),
        readFileSync(new URL(scriptPath, import.meta.url), "utf8")
          .replaceAll("/opt/situate-production", production)
          .replaceAll("/opt/situate-reboot", preview)
          .replaceAll("/opt/getsituate", join(directory, "old")),
      );
      writeFileSync(
        join(base, "Caddyfile"),
        readFileSync(
          new URL("./docker/Caddyfile", import.meta.url),
          "utf8",
        ).replace("{\n", "{\n auto_https off\n"),
        { mode: 0o600 },
      );
      writeFileSync(
        join(base, "reboot.caddy"),
        "reboot.getsituate.test {\n respond preview\n}\n",
        { mode: 0o600 },
      );
      const image = readFileSync(
        new URL("./docker/edge-compose.yaml", import.meta.url),
        "utf8",
      ).match(/image: (\S+)/)[1];
      const name = `situate-proxy-writer-${randomBytes(8).toString("hex")}`;
      const volume = `${name}-config`;
      docker(["volume", "create", volume]);
      t.after(() => {
        try {
          docker(["rm", "--force", "--volumes", name]);
        } finally {
          docker(["volume", "rm", volume]);
        }
      });
      docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--volume",
        `${volume}:/config`,
        "--entrypoint",
        "sh",
        image,
        "-ec",
        `
      umask 077
      mkdir -p /config/sites /config/caddy
      printf 'private.getsituate.test {\n respond private\n}\n' > /config/sites/private.caddy
      printf 'reboot.getsituate.test {\n respond original\n}\n' > /config/sites/reboot.caddy
      printf 'private certificate fixture' > /config/caddy/cert.fixture
      chmod 0700 /config/caddy
    `,
      ]);
      docker([
        "run",
        "-d",
        "--name",
        name,
        "--network",
        "none",
        "--user",
        "0:0",
        "--cap-drop",
        "ALL",
        "--cap-add",
        "NET_BIND_SERVICE",
        "--security-opt",
        "no-new-privileges:true",
        "--read-only",
        "--tmpfs",
        "/tmp",
        "--volume",
        `${volume}:/config`,
        "--volume",
        `${config}:/etc/caddy/Caddyfile:ro`,
        "--entrypoint",
        "sh",
        image,
        "-c",
        "sleep 120",
      ]);
      const realDocker = spawnSync("which", ["docker"], {
        encoding: "utf8",
        env: childEnvironment(),
      }).stdout.trim();
      writeFileSync(
        join(directory, "bin/flock"),
        `#!${process.execPath}\nprocess.exit(0);\n`,
        { mode: 0o700 },
      );
      writeFileSync(
        join(directory, "bin/docker"),
        `#!${process.execPath}
const fs = require('fs'), cp = require('child_process'), path = require('path');
const root = ${JSON.stringify(directory)}, config = ${JSON.stringify(config)}, container = ${JSON.stringify(name)};
const args = process.argv.slice(2);
if (args[0] === 'inspect') { console.log(config); process.exit(0); }
if (args[0] === 'cp' && args[2].startsWith('getsituate-caddy-1:')) throw new Error('Host-owned copies into the proxy are forbidden');
const failure = fs.existsSync(path.join(root, 'failure')) ? fs.readFileSync(path.join(root, 'failure'), 'utf8') : '';
if (args.includes('wget')) process.exit(0);
if (args.includes('reload')) {
 if (failure && (!fs.existsSync(path.join(root, 'reload-failed')) || failure === 'uncertain')) {
  fs.writeFileSync(path.join(root, 'reload-failed'), ''); process.exit(1);
 }
 process.exit(0);
}
if (failure === 'restore-copy' && args.includes('cp') && args.includes('-p')) process.exit(1);
const forwarded = args.map(arg => arg.replace(/^getsituate-caddy-1(?=:|$)/, container));
const result = cp.spawnSync(${JSON.stringify(realDocker)}, forwarded, {stdio:'inherit'});
process.exit(result.status ?? 1);
`,
        { mode: 0o700 },
      );
      const snapshot = (paths) =>
        docker([
          "exec",
          name,
          "sh",
          "-ec",
          paths
            .map(
              (path) => `stat -c '%u:%g %a %Y' '${path}'; sha256sum '${path}'`,
            )
            .join("; "),
        ]);
      const privatePaths = [
        "/config/sites/private.caddy",
        "/config/caddy/cert.fixture",
      ];
      const privateBefore = snapshot(privatePaths);
      const run = (mode = "website") =>
        spawnSync(
          "bash",
          [
            join(base, "configure-proxy.sh"),
            ...(kind === "production" ? [mode] : []),
          ],
          {
            encoding: "utf8",
            env: {
              ...childEnvironment(),
              PATH: `${join(directory, "bin")}:${process.env.PATH}`,
            },
          },
        );
      for (const mode of ["feeds", "website"]) {
        const result = run(mode);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(snapshot(privatePaths), privateBefore);
        if (kind === "preview")
          assert.equal(
            docker([
              "exec",
              name,
              "stat",
              "-c",
              "%u:%g %a",
              "/config/sites/reboot.caddy",
            ]),
            "0:0 600",
          );
      }
      const before = readFileSync(config, "utf8");
      const routeBefore = snapshot(["/config/sites/reboot.caddy"]);
      writeFileSync(
        join(base, kind === "production" ? "Caddyfile" : "reboot.caddy"),
        kind === "production"
          ? before + "\n# candidate\n"
          : "reboot.getsituate.test {\n respond candidate\n}\n",
      );
      writeFileSync(join(directory, "failure"), "reload");
      const recovered = run();
      assert.notEqual(recovered.status, 0);
      assert.equal(readFileSync(config, "utf8"), before);
      assert.equal(snapshot(["/config/sites/reboot.caddy"]), routeBefore);
      assert.equal(snapshot(privatePaths), privateBefore);
      assert.equal(
        existsSync(join(base, "proxy.pending")),
        false,
        recovered.stderr,
      );
      rmSync(join(directory, "reload-failed"));
      writeFileSync(
        join(directory, "failure"),
        kind === "preview" ? "restore-copy" : "uncertain",
      );
      const uncertain = run();
      assert.notEqual(uncertain.status, 0);
      assert.equal(existsSync(join(base, "proxy.pending")), true);
      assert.equal(snapshot(privatePaths), privateBefore);
    },
  );
}

test(
  "Caddy exposes the active adapted route tree used by retirement checks",
  { timeout: 30000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "situate-edge-admin-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const config = readFileSync(
      new URL("./docker/Caddyfile", import.meta.url),
      "utf8",
    )
      .replace("{\n", "{\n\tauto_https off\n")
      .replaceAll("getsituate.com", "getsituate.test");
    writeFileSync(join(directory, "Caddyfile"), config);
    const image = readFileSync(
      new URL("./docker/edge-compose.yaml", import.meta.url),
      "utf8",
    ).match(/image: (\S+)/)[1];
    const name = `situate-edge-admin-test-${randomBytes(8).toString("hex")}`;
    docker([
      "create",
      "--name",
      name,
      "--network",
      "none",
      "--volume",
      `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
      image,
    ]);
    t.after(() => docker(["rm", "--force", "--volumes", name]));
    docker(["start", name]);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = spawnSync(
        "docker",
        ["exec", name, "wget", "-qO-", "http://127.0.0.1:2019/config/"],
        { encoding: "utf8", env: childEnvironment() },
      );
      if (result.status === 0) {
        ready = true;
        break;
      }
      await setTimeout(100);
    }
    assert.equal(ready, true, "Caddy admin endpoint did not start");
    const adapted = JSON.parse(
      docker([
        "exec",
        name,
        "caddy",
        "adapt",
        "--config",
        "/etc/caddy/Caddyfile",
      ]),
    );
    const active = JSON.parse(
      docker(["exec", name, "wget", "-qO-", "http://127.0.0.1:2019/config/"]),
    );
    assert.deepEqual(active, adapted);
  },
);

test(
  "production hosting isolates metadata, immutable downloads and private publisher data",
  { timeout: 120000 },
  async (t) => {
    const directory = mkdtempSync(
      join(tmpdir(), "situate-production-hosting-"),
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    await stage(directory);
    const data = join(directory, "distribution");
    const metadata = join(data, "releases/1.2.3/metadata");
    const jobs = join(
      data,
      "public-pages/jobs/studentische-aushilfe-social-media-community",
    );
    mkdirSync(metadata, { recursive: true, mode: 0o755 });
    mkdirSync(jobs, { recursive: true, mode: 0o755 });
    writeFileSync(join(jobs, "index.html"), "<p>Open role</p>", {
      mode: 0o644,
    });
    writeFileSync(join(data, "public-pages/style.css"), "body {}", {
      mode: 0o644,
    });
    writeFileSync(
      join(metadata, "update.json"),
      '{"version":"1.2.3","distribution":"direct"}',
      { mode: 0o644 },
    );
    writeFileSync(join(metadata, "download.json"), '{"version":"1.2.3"}', {
      mode: 0o644,
    });
    writeFileSync(
      join(metadata, "descriptor.json"),
      '{"internal":"not-public"}',
      { mode: 0o644 },
    );
    writeFileSync(
      join(data, "releases/1.2.3/Situate-1.2.3.dmg"),
      "Situate fixture",
      { mode: 0o644 },
    );
    mkdirSync(join(data, "releases/2.0.0-beta.1+build-01"), { mode: 0o755 });
    writeFileSync(
      join(
        data,
        "releases/2.0.0-beta.1+build-01/Situate-2.0.0-beta.1+build-01.dmg",
      ),
      "beta fixture",
      { mode: 0o644 },
    );
    writeFileSync(join(data, "publish.pending"), "synthetic-private-journal", {
      mode: 0o600,
    });
    symlinkSync("releases/1.2.3/metadata", join(data, "current-release"));
    const image = readFileSync(join(directory, "compose.yaml"), "utf8").match(
      /image: (\S+)/,
    )[1];
    const name = `situate-production-test-${randomBytes(8).toString("hex")}`;
    docker([
      "create",
      "--name",
      name,
      "--user",
      "101:101",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--publish",
      "127.0.0.1::8080",
      "--tmpfs",
      "/tmp:uid=101,gid=101,mode=0700",
      "--tmpfs",
      "/var/cache/nginx:uid=101,gid=101,mode=0700",
      "--volume",
      `${directory}/nginx.conf:/etc/nginx/nginx.conf:ro`,
      "--volume",
      `${directory}/site:/usr/share/nginx/html:ro`,
      "--volume",
      `${data}:/srv/distribution:ro`,
      image,
    ]);
    t.after(() => docker(["rm", "--force", name]));
    docker(["start", name]);
    const origin = `http://${docker(["port", name, "8080/tcp"])}`;
    let ready;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        ready = await fetch(`${origin}/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        if (ready.ok) break;
      } catch {
        /* The container may still be starting. */
      }
      await setTimeout(100);
    }
    assert.equal(ready?.status, 200, docker(["logs", name]));
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy"),
      /connect-src 'self'/,
    );
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal((await fetch(`${origin}/download.js`)).status, 200);
    for (const path of ["update.json", "download.json"]) {
      const response = await fetch(`${origin}/releases/current/${path}`);
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("cache-control"),
        "no-store, max-age=0",
      );
      assert.match(response.headers.get("content-type"), /application\/json/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await response.json()).version, "1.2.3");
    }
    const artifact = `${origin}/releases/1.2.3/Situate-1.2.3.dmg`;
    const head = await fetch(artifact, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "15");
    assert.equal(await head.text(), "");
    assert.equal(
      head.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    const range = await fetch(artifact, { headers: { Range: "bytes=1-3" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 1-3/15");
    assert.equal(await range.text(), "itu");
    const prerelease = await fetch(
      `${origin}/releases/2.0.0-beta.1+build-01/Situate-2.0.0-beta.1+build-01.dmg`,
    );
    assert.equal(prerelease.status, 200);
    assert.equal(await prerelease.text(), "beta fixture");
    for (const path of [
      "/.env",
      "/.git/config",
      "/site.mjs",
      "/messages.en.json",
      "/publish.pending",
      "/releases/",
      "/releases/1.2.3/",
      "/releases/1.2.3/metadata/download.json",
      "/releases/current/descriptor.json",
      "/releases/current/",
      "/current-release/update.json",
      "/releases/1.2.3/missing.dmg",
      "/public-pages/analytics.js",
      "/public-pages/style.css",
      "/public-pages/jobs/studentische-aushilfe-social-media-community/",
      "/jobs/studentische-aushilfe-social-media-community/",
      "/jobs/smc",
      ...["rhk", "thk", "uzk"].flatMap((school) =>
        ["community", "ai"].map((campaign) => `/go/${school}-${campaign}`),
      ),
    ])
      assert.equal((await fetch(origin + path)).status, 404, path);
    const missing = await fetch(
      `${origin}/releases/9.9.9/not-yet-published.dmg`,
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
  },
);

test(
  "reboot redirects every path and query to production without a preview upstream",
  { timeout: 60000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "situate-reboot-redirect-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const config = readFileSync(
      new URL("./docker/Caddyfile", import.meta.url),
      "utf8",
    )
      .replaceAll("getsituate.com", "getsituate.test")
      .replace(
        "www.getsituate.test, reboot.getsituate.test {",
        "http://www.getsituate.test, http://reboot.getsituate.test {",
      )
      .replace("\ngetsituate.test {", "\nhttp://getsituate.test {");
    writeFileSync(join(directory, "Caddyfile"), config);
    const image = readFileSync(
      new URL("./docker/edge-compose.yaml", import.meta.url),
      "utf8",
    ).match(/image: (\S+)/)[1];
    const name = `situate-reboot-redirect-${randomBytes(8).toString("hex")}`;
    docker([
      "create",
      "--name",
      name,
      "--publish",
      "127.0.0.1::80",
      "--volume",
      `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
      image,
    ]);
    t.after(() => docker(["rm", "--force", "--volumes", name]));
    docker(["start", name]);
    const origin = `http://${docker(["port", name, "80/tcp"])}`;
    const probe = (path, method = "GET") =>
      new Promise((resolve, reject) => {
        const req = request(
          new URL(path, origin),
          {
            method,
            headers: { Host: "reboot.getsituate.test" },
            timeout: 5000,
          },
          (response) => {
            response.resume();
            resolve(response);
          },
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("Request timed out.")));
        req.end();
      });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await probe("/");
        break;
      } catch {
        await setTimeout(100);
      }
    }
    for (const method of ["GET", "HEAD"]) {
      for (const path of [
        "/",
        "/missing/path?one=1&two=a%20b",
        "/releases/current/download.json?channel=preview",
      ]) {
        const response = await probe(path, method);
        assert.equal(response.statusCode, 301);
        assert.equal(
          response.headers.location,
          `https://getsituate.test${path}`,
        );
      }
    }
  },
);

test(
  "canonical Caddy configuration validates without production networks or credentials",
  { timeout: 60000 },
  () => {
    const image = readFileSync(
      new URL("./docker/edge-compose.yaml", import.meta.url),
      "utf8",
    ).match(/image: (\S+)/)[1];
    const file = new URL("./docker/Caddyfile", import.meta.url).pathname;
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/config",
      "--tmpfs",
      "/data",
      "--tmpfs",
      "/tmp",
      "--volume",
      `${file}:/etc/caddy/Caddyfile:ro`,
      image,
      "caddy",
      "validate",
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
    ]);
  },
);
