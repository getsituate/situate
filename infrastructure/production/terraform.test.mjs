import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, resolveTerraform } from "./terraform.mjs";
import { hcpConfiguration, inspectWorkspace } from "./hcp.mjs";

test("hosted Terraform uses only the runner's unwrapped setup installation", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-terraform-tools-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const temp = join(root, "runner-temp");
  const install = join(temp, "12345678-1234-1234-1234-123456789abc");
  const other = join(root, "other");
  mkdirSync(install, { recursive: true });
  mkdirSync(other);
  const outside = join(other, "terraform");
  writeFileSync(outside, "fixture", { mode: 0o700 });
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_TEMP: temp,
    PATH: other,
    SITUATE_TERRAFORM_EXECUTABLE: outside,
  };
  const binary = join(install, "terraform");
  symlinkSync(outside, binary);
  assert.throws(() => resolveTerraform(env), /setup-terraform/);
  rmSync(binary);
  writeFileSync(binary, "fixture", { mode: 0o700 });
  assert.equal(resolveTerraform(env), binary);
  chmodSync(binary, 0o770);
  assert.throws(() => resolveTerraform(env), /setup-terraform/);
  assert.throws(
    () =>
      resolveTerraform({
        SITUATE_TERRAFORM_EXECUTABLE: "terraform",
        PATH: other,
      }),
    /trusted absolute executable path/,
  );
});

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "situate-hcp-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const privateDirectory = join(root, "private");
  const directory = join(root, "terraform");
  mkdirSync(privateDirectory, { mode: 0o700 });
  mkdirSync(join(directory, ".terraform"), { recursive: true });
  const metadataPath = join(directory, ".terraform/terraform.tfstate");
  const bindingPath = join(directory, ".terraform/situate-backend.json");
  const variables = join(root, "production.tfvars.json");
  writeFileSync(variables, "{}", { mode: 0o600 });
  const terraformExecutable = join(root, "terraform-fixture");
  writeFileSync(terraformExecutable, "fixture", { mode: 0o700 });
  const environment = {
    SITUATE_TERRAFORM_EXECUTABLE: terraformExecutable,
    CI: "true",
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TF_CLOUD_ORGANIZATION: "example-org",
    TF_TOKEN_app_terraform_io: "synthetic-hcp",
    HCLOUD_TOKEN: "synthetic-cloud",
    UNRELATED_PRIVATE_KEY: "not-for-terraform",
    TF_CLI_ARGS: "-lock=false",
    TF_FORCE_LOCAL_BACKEND: "1",
    TF_LOG: "TRACE",
    TF_WORKSPACE: "wrong-workspace",
    TF_CLOUD_HOSTNAME: "wrong.example",
  };
  const f = {
    root,
    privateDirectory,
    directory,
    metadataPath,
    bindingPath,
    variables,
    environment,
    calls: [],
    requests: [],
    current: null,
    stateUrl:
      "https://archivist.terraform.io/v1/object/synthetic-download-secret",
    workspaceId: "ws-Production1",
    executionMode: "local",
    locked: false,
    canRead: true,
    plan: {
      format_version: "1.2",
      resource_changes: [
        "hcloud_server.production",
        "hcloud_firewall.production",
        "hcloud_ssh_key.production",
        "hcloud_zone.production",
        ...[
          "apex_ipv4",
          "apex_ipv6",
          "www",
          "reboot",
          "mail",
          "apex_txt",
          "google_dkim",
        ].map((id) => `hcloud_zone_rrset.${id}`),
      ].map((address) => ({
        address,
        mode: "managed",
        change: { actions: ["no-op"], importing: { id: "synthetic" } },
      })),
    },
  };
  f.target = () => ({
    hostname: "app.terraform.io",
    organization: "example-org",
    workspace: "situate-production",
    workspaceId: f.workspaceId,
  });
  f.metadata = () =>
    JSON.stringify({
      backend: {
        type: "cloud",
        config: {
          hostname: "app.terraform.io",
          organization: null,
          workspaces: { name: "situate-production", tags: null },
        },
      },
    });
  f.bind = () => {
    writeFileSync(metadataPath, f.metadata(), { mode: 0o600 });
    writeFileSync(
      bindingPath,
      JSON.stringify({
        version: 1,
        target: f.target(),
        metadataHash: createHash("sha256")
          .update(readFileSync(metadataPath))
          .digest("hex"),
      }),
      { mode: 0o600 },
    );
  };
  f.bind();
  f.fetchImpl = async (url, options) => {
    f.requests.push({ url, options });
    if (url === f.stateUrl)
      return new Response(
        JSON.stringify({
          version: 4,
          lineage: "synthetic-lineage",
          serial: f.current.serial,
          resources: [],
        }),
      );
    if (url.endsWith("/workspaces/situate-production"))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: f.workspaceId,
            type: "workspaces",
            attributes: {
              name: "situate-production",
              "execution-mode": f.executionMode,
              locked: f.locked,
              permissions: { "can-read-state-versions": f.canRead },
            },
          },
        }),
      };
    assert.ok(
      url.endsWith(`/workspaces/${f.workspaceId}/current-state-version`),
    );
    return f.current
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              type: "state-versions",
              id: f.current.id,
              attributes: {
                serial: f.current.serial,
                status: "finalized",
                "hosted-state-download-url": f.stateUrl,
              },
            },
          }),
        }
      : { ok: false, status: 404 };
  };
  f.execute = (command, args, options) => {
    f.calls.push({ command, args, options });
    if (args[0] === "init")
      writeFileSync(metadataPath, f.metadata(), { mode: 0o600 });
    if (args[0] === "plan")
      writeFileSync(
        args.find((arg) => arg.startsWith("-out=")).slice(5),
        "saved",
        { mode: 0o600 },
      );
    if (args[0] === "apply") f.current = { id: "sv-Adopted", serial: 1 };
    assert.notEqual(
      args[0],
      "state",
      "Export must not invoke Terraform state pull",
    );
    return { status: 0, stdout: JSON.stringify(f.plan) };
  };
  f.output = join(privateDirectory, "adoption.tfplan");
  return f;
}

const configured = { organization: "example-org", token: "synthetic-hcp" };

test("HCP inspection uses authenticated GET requests only and returns no token or download URL", async (t) => {
  const f = fixture(t);
  const result = await inspectWorkspace(configured, f.fetchImpl);
  assert.deepEqual(result, {
    ...f.target(),
    locked: false,
    stateVersion: null,
  });
  assert.equal(f.requests.length, 2);
  for (const { url, options } of f.requests) {
    assert.ok(url.startsWith("https://app.terraform.io/api/v2/"));
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer synthetic-hcp");
    assert.equal(options.headers.Connection, "close");
    assert.equal(options.redirect, "error");
  }
  assert.doesNotMatch(JSON.stringify(result), /synthetic-hcp|download-url/);
});

for (const [name, mutate] of [
  [
    "remote execution",
    (f) => {
      f.executionMode = "remote";
    },
  ],
  [
    "locked workspace",
    (f) => {
      f.locked = true;
    },
  ],
  [
    "missing state permission",
    (f) => {
      f.canRead = false;
    },
  ],
]) {
  test(`${name} blocks Terraform before execution`, async (t) => {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(main(["init"], f));
    assert.equal(f.calls.length, 0);
  });
}

test("HCP errors do not expose response bodies or credentials and are not retried", async () => {
  for (const failure of ["network", "http", "json", "workspace", "state"]) {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (failure === "network") throw new Error("synthetic-secret");
      if (failure === "http")
        return {
          ok: false,
          status: 403,
          json: async () => {
            throw new Error("response body must not be read");
          },
        };
      if (failure === "json")
        return {
          ok: true,
          json: async () => {
            throw new Error("synthetic-secret");
          },
        };
      if (calls === 1)
        return {
          ok: true,
          json: async () => ({
            data: {
              type: "workspaces",
              id: failure === "workspace" ? "../wrong" : "ws-Test",
              attributes: {
                name: "situate-production",
                "execution-mode": "local",
                locked: false,
                permissions: { "can-read-state-versions": true },
              },
            },
          }),
        };
      return {
        ok: true,
        json: async () => ({
          data: {
            type: "state-versions",
            id: "sv-Test",
            attributes: { serial: 1, status: "pending" },
          },
        }),
      };
    };
    await assert.rejects(
      inspectWorkspace(configured, fetchImpl),
      (error) => !error.message.includes("synthetic-secret"),
    );
    assert.equal(calls, failure === "state" ? 2 : 1);
  }
});

test("initialization binds a pre-existing Local HCP workspace without migration or credential persistence", async (t) => {
  const f = fixture(t);
  rmSync(f.metadataPath);
  rmSync(f.bindingPath);
  await main(["init"], f);
  assert.deepEqual(f.calls[0].args, [
    "init",
    "-no-color",
    "-input=false",
    "-lockfile=readonly",
  ]);
  assert.equal(f.calls[0].command, f.environment.SITUATE_TERRAFORM_EXECUTABLE);
  const env = f.calls[0].options.env;
  assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(env.TF_CLOUD_ORGANIZATION, "example-org");
  assert.equal(env.TF_WORKSPACE, "situate-production");
  assert.equal(env.TF_TOKEN_app_terraform_io, "synthetic-hcp");
  for (const key of [
    "HCLOUD_TOKEN",
    "TF_CLI_ARGS",
    "TF_FORCE_LOCAL_BACKEND",
    "TF_LOG",
    "TF_CLOUD_HOSTNAME",
    "UNRELATED_PRIVATE_KEY",
  ])
    assert.equal(env[key], undefined, key);
  assert.doesNotMatch(readFileSync(f.bindingPath, "utf8"), /synthetic-hcp/);
  await main(["init"], f);
});

test("initialization timeout reports only the last known phase", async (t) => {
  const f = fixture(t);
  rmSync(f.metadataPath);
  rmSync(f.bindingPath);
  await assert.rejects(
    main(["init"], {
      ...f,
      execute: (_command, _args, options) => {
        assert.equal(options.timeout, 180_000);
        return {
          error: Object.assign(new Error("private failure"), {
            code: "ETIMEDOUT",
          }),
          stdout:
            "Initializing HCP Terraform...\nInitializing provider plugins...\nprivate output",
          stderr: "private stderr",
          status: null,
        };
      },
    }),
    { message: "Terraform init timed out during provider initialization." },
  );
  assert.equal(existsSync(f.bindingPath), false);
});

test("initialization refuses existing local state, old backends and unbound metadata", async (t) => {
  const f = fixture(t);
  for (const name of [
    "terraform.tfstate",
    "terraform.tfstate.backup",
    "terraform.tfstate.d",
  ]) {
    const path = join(f.directory, name);
    writeFileSync(path, "old state");
    await assert.rejects(main(["init"], f), /Local state exists/);
    rmSync(path);
  }
  writeFileSync(
    f.metadataPath,
    JSON.stringify({
      backend: { type: "local", config: { path: "old.tfstate" } },
    }),
  );
  await assert.rejects(main(["init"], f), /separate reviewed handoff/);
  f.bind();
  rmSync(f.bindingPath);
  await assert.rejects(main(["init"], f), /Initialize this checkout/);
  assert.equal(f.calls.length, 0);
});

test("workspace recreation and modified backend metadata are rejected", async (t) => {
  const f = fixture(t);
  f.workspaceId = "ws-Recreated";
  await assert.rejects(
    main(["plan", f.variables, f.output], f),
    /does not match/,
  );
  f.workspaceId = "ws-Production1";
  writeFileSync(f.metadataPath, f.metadata() + "\n");
  await assert.rejects(
    main(["plan", f.variables, f.output], f),
    /does not match/,
  );
  assert.equal(f.calls.length, 0);
});

test("plans bind their hash to the exact HCP workspace and immutable state version", async (t) => {
  const f = fixture(t);
  f.current = { id: "sv-Initial", serial: 4 };
  await main(["plan", f.variables, f.output], f);
  const record = JSON.parse(readFileSync(`${f.output}.state.json`, "utf8"));
  assert.equal(record.backend, "cloud");
  assert.deepEqual(record.target, f.target());
  assert.deepEqual(record.stateVersion, f.current);
  assert.ok(f.calls[0].args.includes("-lock-timeout=30s"));
  assert.equal(f.calls[0].options.env.HCLOUD_TOKEN, "synthetic-cloud");
  assert.equal(f.calls[0].options.env.UNRELATED_PRIVATE_KEY, undefined);
  await assert.rejects(
    main(["plan", f.variables, f.output], f),
    /never overwritten/,
  );
});

test("private outputs reject repositories, public directories and dangling aliases", async (t) => {
  const f = fixture(t);
  const repo = join(f.root, "repo");
  mkdirSync(repo, { mode: 0o700 });
  assert.equal(spawnSync("git", ["init", "--quiet", repo]).status, 0);
  await assert.rejects(
    main(["plan", f.variables, join(repo, "adoption.tfplan")], f),
    /outside Git/,
  );
  if (process.platform !== "win32") {
    chmodSync(f.privateDirectory, 0o755);
    await assert.rejects(
      main(["plan", f.variables, f.output], f),
      /owner-only directory/,
    );
    chmodSync(f.privateDirectory, 0o700);
  }
  for (const path of [f.output, `${f.output}.state.json`]) {
    symlinkSync(join(f.root, "missing"), path);
    await assert.rejects(
      main(["plan", f.variables, f.output], f),
      /never overwritten/,
    );
    rmSync(path);
  }
  assert.equal(f.calls.length, 0);
});

test("changed state during planning leaves no applicable plan binding", async (t) => {
  const f = fixture(t);
  const execute = (command, args, options) => {
    const result = f.execute(command, args, options);
    if (args[0] === "plan") f.current = { id: "sv-Concurrent", serial: 1 };
    return result;
  };
  await assert.rejects(
    main(["plan", f.variables, f.output], { ...f, execute }),
    /changed during planning/,
  );
  assert.equal(existsSync(`${f.output}.state.json`), false);
});

test("adoption rejects resource mutations and stale or foreign plan bindings before apply", async (t) => {
  const f = fixture(t);
  await main(["plan", f.variables, f.output], f);
  f.calls.length = 0;
  f.plan.resource_changes[0].change.actions = ["update"];
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], f),
    /not allowed/,
  );
  assert.equal(f.calls.length, 1);
  f.plan.resource_changes[0].change.actions = ["no-op"];
  f.calls.length = 0;
  f.current = { id: "sv-New", serial: 1 };
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], f),
    /not bound/,
  );
  f.current = null;
  const context = `${f.output}.state.json`,
    original = readFileSync(context, "utf8");
  const record = JSON.parse(original);
  writeFileSync(
    context,
    JSON.stringify({
      ...record,
      target: { ...record.target, organization: "other" },
    }),
  );
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], f),
    /not bound/,
  );
  writeFileSync(context, original);
  writeFileSync(f.output, "changed");
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], f),
    /not bound/,
  );
  assert.equal(f.calls.length, 0);
});

test("adoption captures state and a receipt without permitting repeated publication", async (t) => {
  const f = fixture(t);
  await main(["plan", f.variables, f.output], f);
  await main(["adopt", f.output, "--confirm-ownership-handoff"], f);
  const files = readdirSync(f.privateDirectory);
  assert.ok(files.some((name) => name.endsWith(".before.tfstate.empty.json")));
  const after = files.find((name) => name.endsWith(".after.tfstate"));
  assert.equal(
    JSON.parse(readFileSync(join(f.privateDirectory, after), "utf8")).serial,
    1,
  );
  assert.ok(existsSync(`${f.output}.adoption.json.complete`));
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], f),
  );
  assert.equal(f.calls.filter((call) => call.args[0] === "apply").length, 1);
});

test("failed apply retains evidence and captures partially written remote state without retry", async (t) => {
  const f = fixture(t);
  f.current = { id: "sv-Before", serial: 0 };
  await main(["plan", f.variables, f.output], f);
  const execute = (command, args, options) => {
    const result = f.execute(command, args, options);
    return args[0] === "apply" ? { status: 1 } : result;
  };
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], { ...f, execute }),
    /no automatic retry/,
  );
  const files = readdirSync(f.privateDirectory);
  assert.ok(files.some((name) => name.endsWith(".before.tfstate")));
  assert.ok(files.some((name) => name.endsWith(".after.tfstate")));
  assert.ok(existsSync(`${f.output}.adoption.json`));
  assert.equal(existsSync(`${f.output}.adoption.json.complete`), false);
  assert.equal(f.calls.filter((call) => call.args[0] === "apply").length, 1);
});

test("an uncertain adoption with unchanged remote state cannot reuse its journal", async (t) => {
  const f = fixture(t);
  await main(["plan", f.variables, f.output], f);
  const execute = (command, args, options) =>
    args[0] === "apply" ? { status: 1 } : f.execute(command, args, options);
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], { ...f, execute }),
    /no automatic retry/,
  );
  await assert.rejects(
    main(["adopt", f.output, "--confirm-ownership-handoff"], f),
    /never overwritten/,
  );
});

test("explicit state export is private, independent of cloud credentials and never overwrites", async (t) => {
  const f = fixture(t);
  f.current = { id: "sv-Current", serial: 7 };
  delete f.environment.HCLOUD_TOKEN;
  const path = join(f.privateDirectory, "recovery.tfstate");
  await main(["export", path], f);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).serial, 7);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.equal(f.calls.length, 0);
  const downloads = f.requests.filter(({ url }) => url === f.stateUrl);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].options.headers.Authorization, undefined);
  assert.equal(downloads[0].options.redirect, "error");
  assert.equal(downloads[0].options.method, "GET");
  assert.equal(downloads[0].options.credentials, "omit");
  assert.equal(downloads[0].options.referrerPolicy, "no-referrer");
  assert.equal(downloads[0].options.signal.aborted, false);
  await assert.rejects(main(["export", path], f), /never overwritten/);
});

test("state export authenticates to HCP and follows one Archivist redirect without credentials", async (t) => {
  const f = fixture(t);
  f.current = { id: "sv-Current", serial: 7 };
  const endpoint =
    "https://app.terraform.io/api/state-versions/sv-Current/hosted_state";
  const object = f.stateUrl;
  f.stateUrl = endpoint;
  const path = join(f.privateDirectory, "recovery.tfstate");
  const hops = [];
  await main(["export", path], {
    ...f,
    fetchImpl: async (url, options) => {
      if (url === endpoint) {
        hops.push(options);
        assert.equal(options.headers.Authorization, "Bearer synthetic-hcp");
        assert.equal(options.redirect, "manual");
        return new Response(null, {
          status: 302,
          headers: { Location: object },
        });
      }
      if (url === object) {
        hops.push(options);
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.credentials, "omit");
        assert.equal(options.referrerPolicy, "no-referrer");
        assert.equal(options.redirect, "error");
        return Response.json({
          version: 4,
          lineage: "fixture",
          serial: 7,
          resources: [],
        });
      }
      return f.fetchImpl(url, options);
    },
  });
  assert.equal(hops.length, 2);
  assert.equal(hops[0].signal, hops[1].signal);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).serial, 7);
});

test("state export refuses a different version or an unexpected redirect before downloading", async (t) => {
  const endpoint =
    "https://app.terraform.io/api/state-versions/sv-Current/hosted_state";
  for (const [advertised, status, location, expectedHops] of [
    [endpoint.replace("sv-Current", "sv-Other"), 302, null, 0],
    [`${endpoint}?private`, 302, null, 0],
    [endpoint, 302, "https://untrusted.test/v1/object/private", 1],
    [endpoint, 302, "https://archivist.terraform.io/other/private", 1],
    [endpoint, 302, "/v1/object/private", 1],
    [endpoint, 302, null, 1],
    [endpoint, 307, "https://archivist.terraform.io/v1/object/private", 1],
  ]) {
    const f = fixture(t);
    f.current = { id: "sv-Current", serial: 7 };
    f.stateUrl = advertised;
    const path = join(f.privateDirectory, "recovery.tfstate");
    let hops = 0;
    await assert.rejects(
      main(["export", path], {
        ...f,
        fetchImpl: async (url, options) => {
          if (
            url.endsWith("/current-state-version") ||
            url.endsWith("/workspaces/situate-production")
          )
            return f.fetchImpl(url, options);
          hops++;
          assert.equal(url, endpoint);
          return new Response(null, {
            status,
            headers: location ? { Location: location } : {},
          });
        },
      }),
      {
        message: "HCP Terraform did not provide a trusted state download URL.",
      },
    );
    assert.equal(hops, expectedHops);
    assert.equal(existsSync(path), false);
  }
});

test("a mismatched or untrusted state download never leaves an export", async (t) => {
  for (const [failure, diagnostic] of [
    ["url", /trusted state download URL/],
    ["transport", /state download did not complete/],
    ["http", /state download failed: HTTP 503/],
    ["size", /state download is missing or too large/],
    ["json", /state download returned invalid JSON/],
    ["serial", /does not match the inspected HCP state version/],
    ["race", /state changed during export/],
    ["version-before-download", /state changed during export/],
  ]) {
    const f = fixture(t);
    f.current = { id: "sv-Current", serial: 1 };
    if (failure === "url") f.stateUrl = "https://untrusted.test/private";
    const path = join(f.privateDirectory, "recovery.tfstate");
    let attempts = 0;
    let currentReads = 0;
    const fetchImpl = async (url, options) => {
      if (url !== f.stateUrl) {
        if (
          url.endsWith("/current-state-version") &&
          ++currentReads === 2 &&
          failure === "version-before-download"
        )
          f.current = { id: "sv-New", serial: 2 };
        return f.fetchImpl(url, options);
      }
      attempts++;
      if (failure === "url" || failure === "version-before-download")
        assert.fail("Unexpected download");
      if (failure === "transport") throw new Error("private download URL");
      if (failure === "http")
        return new Response("private response", { status: 503 });
      if (failure === "size")
        return new Response("bytes", {
          headers: { "Content-Length": "16777217" },
        });
      if (failure === "json") return new Response("private non-JSON state");
      if (failure === "serial")
        return Response.json({
          version: 4,
          lineage: "synthetic",
          serial: 9,
          resources: [],
        });
      const response = await f.fetchImpl(url, options);
      if (failure === "race") f.current = { id: "sv-New", serial: 2 };
      return response;
    };
    await assert.rejects(
      main(["export", path], { ...f, fetchImpl }),
      (error) => {
        assert.match(error.message, diagnostic, failure);
        assert.doesNotMatch(error.message, /private|synthetic-download-secret/);
        return true;
      },
    );
    assert.equal(
      attempts,
      ["url", "version-before-download"].includes(failure) ? 0 : 1,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(existsSync(path), false);
  }
});

test("preflight reports Terraform init failure without private subprocess output", async (t) => {
  const f = fixture(t);
  const options = {
    ...f,
    execute: () => ({ status: 1, stderr: "private Terraform diagnostics" }),
  };
  rmSync(f.metadataPath);
  rmSync(f.bindingPath);
  await assert.rejects(main(["init"], options), {
    message: "Terraform init failed (exit 1).",
  });
});

test("status remains read-only even when a workspace is locked", async (t) => {
  const f = fixture(t);
  f.locked = true;
  await main(["status"], f);
  assert.equal(f.calls.length, 0);
  assert.ok(f.requests.every((request) => request.options.method === "GET"));
});

test("missing credentials and unsafe organization names fail before remote access", async (t) => {
  const f = fixture(t);
  assert.throws(
    () => hcpConfiguration({ TF_CLOUD_ORGANIZATION: "../wrong" }),
    /exact HCP/,
  );
  assert.throws(
    () =>
      hcpConfiguration({
        TF_CLOUD_ORGANIZATION: "example-org",
        TF_TOKEN_app_terraform_io: "",
      }),
    /TF_TOKEN/,
  );
  await assert.rejects(
    main(["init"], { ...f, environment: { CI: "true" } }),
    /TF_CLOUD_ORGANIZATION/,
  );
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.length, 0);
});

test("invalid or unconfirmed operations fail before configuration and execution", async () => {
  for (const args of [
    [],
    ["apply"],
    ["adopt", "saved.tfplan"],
    ["adopt", "saved.tfplan", "--yes"],
    ["init", "extra"],
  ])
    await assert.rejects(
      main(args, {
        execute: () => assert.fail("unexpected execution"),
        fetchImpl: () => assert.fail("unexpected network"),
      }),
      /Usage:/,
    );
});
