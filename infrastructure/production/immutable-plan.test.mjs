import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { checkImmutablePlan } from "./immutable-plan.mjs";

const host = 'hcloud_server.immutable["next"]';
const disk = 'hcloud_volume.publication["first"]';
const link = "hcloud_volume_attachment.publication[0]";
const ipv4 = "hcloud_zone_rrset.apex_ipv4";
const ipv6 = "hcloud_zone_rrset.apex_ipv6";
const mail = "hcloud_zone_rrset.mail";
const legacy = { ipv4_address: "192.0.2.3", ipv6_address: "2001:db8::3" };
const current = 'hcloud_server.immutable["current"]';
const active = {
  ...legacy,
  id: "515",
  delete_protection: true,
  rebuild_protection: true,
};
const candidatePin = {
  image: "223",
  labels: { source_revision: "a".repeat(40) },
  delete_protection: true,
};
const operation = {
  previous: "current",
  previousId: "515",
  candidate: "next",
  candidateId: "516",
  volumeId: "313",
  imageId: "223",
  sourceRevision: "a".repeat(40),
};
const revision = "a".repeat(40);
const receipt = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    imageId: "223",
    sourceRevision: revision,
    gates: {
      offlineBoot: true,
      storageFence: true,
      httpsAndRedirects: true,
      publicationAndFailback: true,
      independentRestore: true,
    },
  }),
);
const digest = createHash("sha256").update(receipt).digest("hex");
const row = (address, action = "no-op", after = {}, before = after) => ({
  address,
  mode: "managed",
  change: { actions: [action], before, after },
});
const legacyRecords = () =>
  [ipv4, ipv6].map((address, index) =>
    row(address, "no-op", {
      zone: "100",
      name: "@",
      type: index ? "AAAA" : "A",
      ttl: 900,
      records: [{ value: legacy[index ? "ipv6_address" : "ipv4_address"] }],
    }),
  );
const plan = (...rows) => ({
  format_version: "1.2",
  complete: true,
  applyable: true,
  errored: false,
  resource_changes: [
    row("hcloud_server.production", "no-op", legacy),
    row("hcloud_zone.production"),
    ...legacyRecords().filter(
      (record) => !rows.some((entry) => entry.address === record.address),
    ),
    ...rows,
  ],
  variables: {
    qualified_hosts: {
      value: {
        next: {
          image_id: "223",
          source_revision: revision,
          qualification_sha256: digest,
        },
      },
    },
    publication_volume: { value: "first" },
    publication_host: { value: "next" },
    traffic_host: { value: "next" },
  },
});
const candidate = {
  ...candidatePin,
  id: "516",
  ipv4_address: "192.0.2.4",
  ipv6_address: "2001:db8::4",
};
const volume = { id: "313" };
const lease = { volume_id: 313, server_id: 516, automount: false };

function records() {
  return [
    [ipv4, "A", candidate.ipv4_address],
    [ipv6, "AAAA", candidate.ipv6_address],
  ].map(([address, type, ip]) => {
    const previous = {
      zone: "100",
      name: "@",
      type,
      ttl: 900,
      records: [
        { value: legacy[type === "A" ? "ipv4_address" : "ipv6_address"] },
      ],
    };
    return row(
      address,
      "update",
      { ...previous, records: [{ value: ip }] },
      previous,
    );
  });
}

test("stage requires the exact attestation and leaves the protected serving VM and DNS in place", () => {
  const next = row(host, "create", {
    name: "getsituate-next",
    image: "223",
    labels: {
      source_revision: revision,
      qualification_a: digest.slice(0, 32),
      qualification_b: digest.slice(32),
    },
    delete_protection: true,
    rebuild_protection: true,
  });
  const state = row(disk, "create", {
    name: "getsituate-publication-first",
    delete_protection: true,
  });
  assert.equal(checkImmutablePlan(plan(next, state), "stage", receipt), 2);
  assert.equal(checkImmutablePlan(plan(state), "stage"), 1);
  assert.throws(() => checkImmutablePlan(plan(next), "stage"), /receipt/);
  assert.throws(
    () =>
      checkImmutablePlan(
        plan(next),
        "stage",
        Buffer.concat([receipt, Buffer.from("\n")]),
      ),
    /exact qualified/,
  );
  assert.throws(
    () => checkImmutablePlan(plan(next, ...records()), "stage", receipt),
    /unexpected change/,
  );
  const replacement = plan(next);
  replacement.resource_changes[0].change.actions = ["delete", "create"];
  assert.throws(
    () => checkImmutablePlan(replacement, "stage", receipt),
    /unexpected resource operation/,
  );
});

test("publication transfer separates detach and attach and does not automount", () => {
  const base = [row(host, "no-op", candidate), row(disk, "no-op", volume)];
  assert.equal(
    checkImmutablePlan(
      plan(
        ...base,
        row(current, "no-op", active),
        row(link, "delete", null, { ...lease, server_id: 515 }),
      ),
      "detach",
      undefined,
      operation,
    ),
    1,
  );
  assert.equal(
    checkImmutablePlan(plan(...base, row(link, "create", lease)), "attach"),
    1,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        plan(...base, row(link, "create", { ...lease, automount: true })),
        "attach",
      ),
    /manual mount/,
  );
  assert.throws(
    () =>
      checkImmutablePlan(plan(...base, row(link, "update", lease)), "attach"),
    /detached/,
  );
});

test("detach only accepts firewall drift caused by adding the verified candidate", () => {
  const planned = plan(
    row(host, "no-op", candidate),
    row(disk, "no-op", volume),
    row(current, "no-op", active),
    row(link, "delete", null, { ...lease, server_id: 515 }),
  );
  const member = (server) => ({ server, label_selector: "" });
  const before = { apply_to: [member(515)], rule: [{ port: "443" }] };
  const after = { ...before, apply_to: [member(515), member(516)] };
  const observe = (effect) => ({
    ...planned,
    resource_drift: [
      row("hcloud_firewall.production", "update", effect, before),
    ],
  });
  assert.equal(
    checkImmutablePlan(observe(after), "detach", undefined, operation),
    1,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        observe({ ...after, apply_to: [member(515), member(517)] }),
        "detach",
        undefined,
        operation,
      ),
    /free of drift/,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        observe({ ...after, rule: [{ port: "22" }] }),
        "detach",
        undefined,
        operation,
      ),
    /free of drift/,
  );
});

test("traffic accepts only the expected provider-side attachment observation", () => {
  const base = plan(
    row(host, "no-op", candidate),
    row(disk, "no-op", volume),
    row(current, "no-op", active),
    row(link, "no-op", lease),
    ...records(),
  );
  const before = { ...volume, server_id: null, size: 50 };
  const observed = { ...before, server_id: 516 };
  const withDrift = (after) => ({
    ...base,
    resource_drift: [row(disk, "update", after, before)],
  });
  assert.equal(
    checkImmutablePlan(withDrift(observed), "traffic", undefined, operation),
    2,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        withDrift({ ...observed, server_id: 517 }),
        "traffic",
        undefined,
        operation,
      ),
    /free of drift/,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        withDrift({ ...observed, size: 51 }),
        "traffic",
        undefined,
        operation,
      ),
    /free of drift/,
  );
});

test("routing and partial-DNS reconciliation require both final records on the attached host", () => {
  const base = [
    row(host, "no-op", candidate),
    row(disk, "no-op", volume),
    row(link, "no-op", lease),
  ];
  assert.equal(checkImmutablePlan(plan(...base, ...records()), "traffic"), 2);
  const [a, aaaa] = records();
  assert.equal(
    checkImmutablePlan(
      plan(
        ...base,
        a,
        row(ipv6, "no-op", aaaa.change.after),
        row(current, "no-op", active),
      ),
      "traffic",
      undefined,
      operation,
    ),
    1,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        plan(
          ...base,
          a,
          row(ipv6, "no-op", aaaa.change.before),
          row(current, "no-op", active),
        ),
        "traffic",
        undefined,
        operation,
      ),
    /unexpected traffic target/,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        plan(...base, ...records(), row(mail, "update")),
        "traffic",
      ),
    /only update apex/,
  );
  assert.equal(
    checkImmutablePlan(
      plan(...base, a, row(ipv6, "no-op", aaaa.change.after)),
      "traffic",
    ),
    1,
  );
  const stale = plan(...base, ...records());
  stale.variables.traffic_host.value = null;
  assert.throws(
    () => checkImmutablePlan(stale, "traffic"),
    /select an immutable generation/,
  );
  const drift = {
    ...plan(...base, ...records()),
    resource_drift: [row(mail, "update")],
  };
  assert.throws(() => checkImmutablePlan(drift, "traffic"), /free of drift/);
});

test("the one-time retirement targets only the migrated legacy VM", () => {
  const live = records().map(({ address, change }) =>
    row(address, "no-op", change.after),
  );
  const original = { ...active, id: "99" };
  const unlocked = {
    ...original,
    delete_protection: false,
    rebuild_protection: false,
    ignore_remote_firewall_ids: false,
    keep_disk: false,
    shutdown_before_deletion: false,
  };
  const base = [
    ...live,
    row(host, "no-op", candidate),
    row(disk, "no-op", volume),
    row(link, "no-op", lease),
  ];
  const migration = {
    ...operation,
    migration: true,
    previous: "legacy",
    previousId: "99",
  };
  const onlyLegacy = (change) => {
    const result = plan(...base);
    result.resource_changes[0] = change;
    return result;
  };
  const release = onlyLegacy(
    row("hcloud_server.production", "update", unlocked, original),
  );
  release.variables.retiring_generation = { value: "legacy" };
  assert.equal(
    checkImmutablePlan(release, "unprotect", undefined, migration),
    1,
  );
  const shutdown = structuredClone(release);
  shutdown.resource_drift = [
    row(
      "hcloud_server.production",
      "update",
      { ...original, status: "off" },
      { ...original, status: "running" },
    ),
  ];
  assert.equal(
    checkImmutablePlan(shutdown, "unprotect", undefined, migration),
    1,
  );
  shutdown.resource_drift[0].change.after.rebuild_protection = false;
  assert.throws(
    () => checkImmutablePlan(shutdown, "unprotect", undefined, migration),
    /free of drift/,
  );
  const unsafe = structuredClone(release);
  unsafe.resource_changes[0].change.after.keep_disk = true;
  assert.throws(
    () => checkImmutablePlan(unsafe, "unprotect", undefined, migration),
    /only lift/,
  );
  const destroy = onlyLegacy(
    row("hcloud_server.production", "delete", null, unlocked),
  );
  assert.equal(checkImmutablePlan(destroy, "retire", undefined, migration), 1);
  assert.throws(
    () => checkImmutablePlan(destroy, "retire", undefined, operation),
    /legacy ownership/,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        onlyLegacy(row("hcloud_server.production", "delete", null, original)),
        "retire",
        undefined,
        migration,
      ),
    /only delete/,
  );
  const stale = onlyLegacy(
    row("hcloud_server.production", "delete", null, unlocked),
  );
  stale.resource_changes.find(({ address }) => address === ipv4).change.after =
    records()[0].change.before;
  assert.throws(
    () => checkImmutablePlan(stale, "retire", undefined, migration),
    /unexpected traffic target/,
  );
});

test("retirement only changes the previous server after traffic and storage belong to the candidate", () => {
  const live = records().map(({ address, change }) =>
    row(address, "no-op", change.after),
  );
  const base = [
    ...live,
    row(host, "no-op", candidate),
    row(disk, "no-op", volume),
    row(link, "no-op", lease),
  ];
  const unlocked = {
    ...active,
    delete_protection: false,
    rebuild_protection: false,
  };
  const unblock = plan(...base, row(current, "update", unlocked, active));
  unblock.variables.retiring_generation = { value: "current" };
  assert.equal(
    checkImmutablePlan(unblock, "unprotect", undefined, operation),
    1,
  );
  const mismatch = structuredClone(unblock);
  mismatch.resource_changes.find(
    ({ address }) => address === current,
  ).change.after.rebuild_protection = true;
  assert.throws(
    () => checkImmutablePlan(mismatch, "unprotect", undefined, operation),
    /only lift/,
  );
  const altered = structuredClone(unblock);
  altered.resource_changes.find(
    ({ address }) => address === current,
  ).change.after.backups = false;
  assert.throws(
    () => checkImmutablePlan(altered, "unprotect", undefined, operation),
    /only lift/,
  );
  const retire = plan(...base, row(current, "delete", null, unlocked));
  assert.equal(checkImmutablePlan(retire, "retire", undefined, operation), 1);
  assert.throws(
    () => checkImmutablePlan(retire, "retire"),
    /journal is required/,
  );
  assert.throws(
    () =>
      checkImmutablePlan(
        plan(
          ...base,
          row(current, "delete", null, unlocked),
          row(mail, "update"),
        ),
        "retire",
        undefined,
        operation,
      ),
    /only delete/,
  );
  assert.throws(
    () =>
      checkImmutablePlan(retire, "retire", undefined, {
        ...operation,
        volumeId: "314",
      }),
    /recorded volume/,
  );
});
