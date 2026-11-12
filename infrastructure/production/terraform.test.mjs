import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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
import { main } from "./terraform.mjs";
import { hcpConfiguration, inspectWorkspace } from "./hcp.mjs";

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
  const environment = {
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
              attributes: { serial: f.current.serial, status: "finalized" },
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
    if (args[0] === "state")
      return {
        status: 0,
        stdout: JSON.stringify({
          version: 4,
          lineage: "synthetic-lineage",
          serial: f.current.serial,
          resources: [],
        }),
      };
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
    "-input=false",
    "-lockfile=readonly",
  ]);
  const env = f.calls[0].options.env;
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
  const path = join(f.privateDirectory, "recovery.tfstate");
  await main(["export", path], f);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).serial, 7);
  assert.equal(f.calls[0].options.env.HCLOUD_TOKEN, undefined);
  await assert.rejects(main(["export", path], f), /never overwritten/);
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
