import assert from "node:assert/strict";
import { test } from "node:test";
import { inventoryFromState } from "./hosting-inventory.mjs";

const key = `ssh-ed25519 ${"A".repeat(68)}`;
const row = (type, name, attributes, index_key) => ({
  type,
  name,
  mode: "managed",
  instances: [{ attributes, index_key }],
});
function fixture() {
  return {
    resources: [
      row(
        "hcloud_server",
        "immutable",
        {
          id: "51",
          image: "123",
          delete_protection: true,
          ipv4_address: "192.0.2.1",
          ipv6_address: "2001:db8::1",
          labels: {
            source_revision: "a".repeat(40),
            qualification_a: "b".repeat(32),
            qualification_b: "c".repeat(32),
          },
        },
        "current",
      ),
      row("hcloud_volume", "publication", { id: "64" }, "live"),
      row(
        "hcloud_volume_attachment",
        "publication",
        { volume_id: 64, server_id: 51, automount: false },
        0,
      ),
      row("hcloud_zone_rrset", "apex_ipv4", {
        records: [{ value: "192.0.2.1" }],
      }),
      row("hcloud_zone_rrset", "apex_ipv6", {
        records: [{ value: "2001:db8:0:0::1" }],
      }),
      row("hcloud_zone_rrset", "apex_txt", {
        records: [{ value: '"fixture"', comment: null }],
      }),
      row("hcloud_zone_rrset", "google_dkim", {
        records: [{ value: '"fixture"', comment: "fixture" }],
      }),
      row("hcloud_ssh_key", "production", { public_key: `${key} fixture` }),
    ],
  };
}

test("a new runner can read the settled generation from HCP state", () => {
  const inventory = inventoryFromState(fixture(), key);
  assert.equal(inventory.traffic_host, "current");
  assert.equal(inventory.publication_volume, "live");
  assert.equal(
    inventory.qualified_hosts.current.qualification_sha256,
    "b".repeat(32) + "c".repeat(32),
  );
  assert.deepEqual(inventory.apex_txt_records, [{ value: '"fixture"' }]);
});

test("interrupted and legacy topologies do not start another rollout", () => {
  for (const mutate of [
    (state) =>
      state.resources[0].instances.push(
        structuredClone(state.resources[0].instances[0]),
      ),
    (state) =>
      (state.resources[0].instances[0].attributes.delete_protection = false),
    (state) => (state.resources[0].name = "production"),
    (state) => (state.resources[2].instances[0].attributes.server_id = 52),
    (state) =>
      (state.resources[3].instances[0].attributes.records[0].value =
        "192.0.2.2"),
  ]) {
    const state = fixture();
    mutate(state);
    assert.throws(() => inventoryFromState(state, key), /settled immutable/);
  }
});
