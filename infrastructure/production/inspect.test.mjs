import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkAdoptionPlan,
  inventory,
  main,
  saveInventory,
} from "./inspect.mjs";

const expectedAddresses = [
  "hcloud_server.production",
  "hcloud_firewall.production",
  "hcloud_ssh_key.production",
  "hcloud_zone.production",
  "hcloud_zone_rrset.apex_ipv4",
  "hcloud_zone_rrset.apex_ipv6",
  "hcloud_zone_rrset.www",
  "hcloud_zone_rrset.reboot",
  "hcloud_zone_rrset.mail",
  "hcloud_zone_rrset.apex_txt",
  "hcloud_zone_rrset.google_dkim",
];
function plan() {
  return {
    format_version: "1.2",
    resource_changes: expectedAddresses.map((address) => ({
      address,
      mode: "managed",
      change: { actions: ["no-op"], importing: { id: "synthetic" } },
    })),
  };
}
function dnsRecords() {
  return [
    ["@", "A", "192.0.2.1"],
    ["@", "AAAA", "2001:db8::1"],
    ["www", "CNAME", "example.test."],
    ["reboot", "CNAME", "example.test."],
    ["@", "MX", "1 smtp.example.test."],
    ["@", "TXT", '"v=spf1 include:_spf.example.test -all"'],
    ["google._domainkey", "TXT", '"v=DKIM1; p=synthetic"'],
    ["@", "NS", "ns.example.test."],
    ["@", "SOA", "ns.example.test. hostmaster.example.test. 1 2 3 4 5"],
  ].map(([name, type, value]) => ({
    name,
    type,
    records: [{ value, comment: "" }],
  }));
}
function api(records = dnsRecords(), { paginate = false } = {}) {
  const requests = [];
  return {
    requests,
    async fetch(url, options) {
      requests.push({ url, options });
      let body;
      const path = new URL(url).pathname;
      if (path.endsWith("servers/163944733"))
        body = {
          server: {
            name: "getsituate-production",
            image: { name: "ubuntu-24.04" },
          },
        };
      else if (path.endsWith("ssh_keys/118079158"))
        body = {
          ssh_key: {
            name: "getsituate-production",
            public_key: "ssh-ed25519 synthetic-public-key",
          },
        };
      else {
        assert.equal(path, "/v1/zones/getsituate.com/rrsets");
        const page = new URL(url).searchParams.get("page");
        body = {
          rrsets: paginate
            ? page === "1"
              ? records.slice(0, 4)
              : records.slice(4)
            : records,
          meta: {
            pagination: { next_page: paginate && page === "1" ? 2 : null },
          },
        };
      }
      return { ok: true, json: async () => body };
    },
  };
}
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-inventory-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("inventory uses only authenticated GET requests and preserves every TXT record", async () => {
  const records = dnsRecords();
  records[5].records.push({
    value: '"google-site-verification=synthetic"',
    comment: "verification",
  });
  const client = api(records, { paginate: true });
  assert.deepEqual(await inventory("synthetic-token", client.fetch), {
    ssh_public_key: "ssh-ed25519 synthetic-public-key",
    apex_txt_records: [
      { value: '"v=spf1 include:_spf.example.test -all"' },
      {
        value: '"google-site-verification=synthetic"',
        comment: "verification",
      },
    ],
    google_dkim_records: [{ value: '"v=DKIM1; p=synthetic"' }],
  });
  assert.equal(client.requests.length, 4);
  for (const { url, options } of client.requests) {
    assert.equal(new URL(url).origin, "https://api.hetzner.cloud");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.deepEqual(options.headers, {
      Authorization: "Bearer synthetic-token",
    });
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("inventory refuses incomplete, duplicate, or unrepresented DNS RRSets", async () => {
  for (const records of [
    dnsRecords().filter((r) => r.type !== "MX"),
    [...dnsRecords(), dnsRecords()[0]],
    [
      ...dnsRecords(),
      {
        name: "_dmarc",
        type: "TXT",
        records: [{ value: '"v=DMARC1; p=none"' }],
      },
    ],
    [
      ...dnsRecords(),
      {
        name: "delegated",
        type: "NS",
        records: [{ value: "ns.example.test." }],
      },
    ],
    [...dnsRecords(), null],
    dnsRecords().map((r) => (r.type === "MX" ? { ...r, records: [] } : r)),
  ])
    await assert.rejects(
      inventory("synthetic", api(records).fetch),
      /inventory|records/i,
    );
});

test("inventory rejects wrong identities, broken pagination, and unavailable credentials", async () => {
  await assert.rejects(
    inventory("", () => assert.fail("unexpected request")),
    /HCLOUD_TOKEN/,
  );
  const client = api();
  for (const change of [
    (body) => {
      if (body.server) body.server.name = "another-server";
    },
    (body) => {
      if (body.ssh_key) body.ssh_key.public_key = "-----BEGIN PRIVATE KEY-----";
    },
    (body) => {
      if (body.rrsets) body.meta.pagination.next_page = 1;
    },
    (body) => {
      if (body.rrsets) delete body.meta;
    },
  ]) {
    await assert.rejects(
      inventory("synthetic", async (...args) => {
        const response = await client.fetch(...args);
        const body = await response.json();
        change(body);
        return { ok: true, json: async () => body };
      }),
      /inventory|pagination/i,
    );
  }
});

test("provider errors do not expose credentials or response bodies", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error("synthetic-private-token");
    },
    async () => ({
      ok: false,
      status: 401,
      json: () => assert.fail("error body must not be read"),
    }),
    async () => ({
      ok: true,
      json: () => {
        throw new Error("synthetic-private-token");
      },
    }),
  ]) {
    await assert.rejects(
      inventory("synthetic-private-token", fetchImpl),
      (error) => {
        assert.doesNotMatch(error.message, /synthetic-private-token/);
        return true;
      },
    );
  }
});

test("inventory files are private, ignored variable files and never overwrite existing paths", (t) => {
  const directory = temporary(t);
  const output = join(directory, "production.tfvars.json");
  const snapshot = { apex_txt_records: [{ value: '"synthetic"' }] };
  assert.equal(saveInventory(output, snapshot), output);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), snapshot);
  if (process.platform !== "win32")
    assert.equal(lstatSync(output).mode & 0o777, 0o600);
  assert.throws(() => saveInventory(output, {}), /EEXIST/);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), snapshot);
  const target = join(directory, "target");
  writeFileSync(target, "unchanged");
  const link = join(directory, "link.tfvars.json");
  symlinkSync(target, link);
  assert.throws(() => saveInventory(link, {}), /EEXIST/);
  assert.equal(readFileSync(target, "utf8"), "unchanged");
  assert.throws(
    () => saveInventory(join(directory, "inventory.json"), {}),
    /tfvars/,
  );
  assert.throws(
    () => saveInventory(join(directory, "production.example.tfvars.json"), {}),
    /non-example/,
  );
});

test("adoption accepts imports and existing no-op resources only", () => {
  assert.deepEqual(checkAdoptionPlan(plan()), { resources: 11, imports: 11 });
  const existing = plan();
  existing.resource_changes.forEach((r) => delete r.change.importing);
  assert.deepEqual(checkAdoptionPlan(existing), { resources: 11, imports: 0 });
  const source = readFileSync(
    new URL("./terraform/main.tf", import.meta.url),
    "utf8",
  );
  const declared = [...source.matchAll(/resource "([^"]+)" "([^"]+)"/g)].map(
    (m) => `${m[1]}.${m[2]}`,
  );
  assert.deepEqual(
    declared.sort(),
    [...expectedAddresses, "hcloud_zone_rrset.dmarc"].sort(),
  );
});

test("DMARC publishes a non-enforcing policy without changing adoption permissions", () => {
  const source = readFileSync(
    new URL("./terraform/main.tf", import.meta.url),
    "utf8",
  );
  const resource = source.match(
    /resource "hcloud_zone_rrset" "dmarc" \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(resource);
  assert.match(resource, /zone\s*= hcloud_zone\.production\.id/);
  assert.match(resource, /name\s*= "_dmarc"/);
  assert.match(resource, /type\s*= "TXT"/);
  assert.match(resource, /ttl\s*= 300/);
  assert.ok(
    resource.includes('records = [{ value = "\\"v=DMARC1; p=none\\"" }]'),
  );
  assert.match(resource, /prevent_destroy = true/);
  const candidate = plan();
  candidate.resource_changes.push({
    address: "hcloud_zone_rrset.dmarc",
    mode: "managed",
    change: { actions: ["create"] },
  });
  assert.throws(() => checkAdoptionPlan(candidate));
});

test("adoption rejects every remote mutation, including comment-only DNS updates", () => {
  for (const actions of [
    ["create"],
    ["update"],
    ["delete"],
    ["delete", "create"],
    ["create", "delete"],
    ["read"],
    [],
  ]) {
    const candidate = plan();
    candidate.resource_changes[9].change.actions = actions;
    assert.throws(
      () => checkAdoptionPlan(candidate),
      /Resource changes are not allowed.*apex_txt/,
    );
  }
});

test("adoption fails closed on partial, unknown, duplicate or errored plans", () => {
  for (const alter of [
    (p) => {
      p.format_version = "2.0";
    },
    (p) => {
      p.errored = true;
    },
    (p) => {
      p.complete = false;
    },
    (p) => {
      p.deferred_changes = [{}];
    },
    (p) => {
      delete p.resource_changes;
    },
    (p) => {
      p.resource_changes.pop();
    },
    (p) => {
      p.resource_changes.push(p.resource_changes[0]);
    },
    (p) => {
      p.resource_changes[0] = p.resource_changes[1];
    },
    (p) => {
      p.resource_changes[0].address = "hcloud_server.other";
    },
    (p) => {
      p.resource_changes[0].mode = "data";
    },
    (p) => {
      delete p.resource_changes[0].change;
    },
  ]) {
    const candidate = plan();
    alter(candidate);
    assert.throws(() => checkAdoptionPlan(candidate));
  }
  assert.throws(() => checkAdoptionPlan(null));
});

test("plan-check CLI reads stdin without cloud credentials and returns a failing exit status for changes", () => {
  const script = fileURLToPath(new URL("./inspect.mjs", import.meta.url));
  for (const mutate of [false, true]) {
    const candidate = plan();
    if (mutate) candidate.resource_changes[0].change.actions = ["update"];
    const result = spawnSync(process.execPath, [script, "check-plan"], {
      input: JSON.stringify(candidate),
      encoding: "utf8",
      env: { CI: "true" },
    });
    assert.equal(result.status, mutate ? 1 : 0, result.stderr);
    if (!mutate) assert.match(result.stdout, /11 resources, 11 imports/);
  }
});

test("invalid commands are rejected before reading configuration or contacting Hetzner", async () => {
  for (const args of [
    [],
    ["apply"],
    ["inventory"],
    ["inventory", "public.json"],
    ["inventory", "production.example.tfvars.json"],
    ["check-plan", "extra"],
  ])
    await assert.rejects(main(args), /Usage:/);
});
