import { BlockList, isIP } from "node:net";

export function inventoryFromState(state, operatorPublicKey) {
  function require(condition) {
    if (!condition)
      throw new Error(
        "Terraform state does not describe one settled immutable production host. Inspect it manually before deploying.",
      );
  }
  require(Array.isArray(state?.resources));
  const rows = state.resources.filter(
    (row) => row.mode === "managed" && !row.module,
  );
  require(
    !rows.some(
      (row) => row.type === "hcloud_server" && row.name !== "immutable",
    ),
  );
  function instances(type, name) {
    const matches = rows.filter(
      (row) => row.type === type && row.name === name,
    );
    require(matches.length === 1 && Array.isArray(matches[0].instances));
    require(
      matches[0].instances.every(
        (row) => row.attributes && !row.deposed && !row.status,
      ),
    );
    return matches[0].instances;
  }
  function single(type, name) {
    const entries = instances(type, name);
    require(entries.length === 1);
    return entries[0];
  }
  const { index_key: generation, attributes: host } = single(
    "hcloud_server",
    "immutable",
  );
  const volumes = instances("hcloud_volume", "publication");
  const link = single("hcloud_volume_attachment", "publication").attributes;
  const disk = volumes.find(
    (volume) => String(volume.attributes.id) === String(link.volume_id),
  );
  const numeric = (value) => /^[1-9][0-9]{0,14}$/.test(String(value));
  require(
    numeric(host.id) &&
      numeric(host.image) &&
      numeric(link.volume_id) &&
      /^[a-z][a-z0-9-]{0,19}$/.test(generation) &&
      disk &&
      String(link.server_id) === String(host.id) &&
      link.automount === false &&
      host.delete_protection === true &&
      volumes.every(({ index_key }) =>
        /^[a-z][a-z0-9-]{0,19}$/.test(index_key),
      ),
  );
  for (const [name, address] of [
    ["apex_ipv4", host.ipv4_address],
    ["apex_ipv6", host.ipv6_address],
  ]) {
    const records = single("hcloud_zone_rrset", name).attributes.records;
    const record = records?.length === 1 && records[0].value;
    const version = name === "apex_ipv4" ? 4 : 6;
    require(isIP(address) === version && isIP(record) === version);
    const addresses = new BlockList();
    const family = version === 4 ? "ipv4" : "ipv6";
    addresses.addAddress(address, family);
    require(addresses.check(record, family));
  }
  const labels = host.labels;
  const digest =
    (labels?.qualification_a ?? "") + (labels?.qualification_b ?? "");
  require(
    /^[a-f0-9]{64}$/.test(digest) &&
      /^[a-f0-9]{40}$/.test(labels?.source_revision),
  );
  const txt = (name) => {
    const records = single("hcloud_zone_rrset", name).attributes.records;
    require(
      Array.isArray(records) &&
        records.length > 0 &&
        records.every(({ value }) => typeof value === "string"),
    );
    return records.map(({ value, comment }) => ({
      value,
      ...(comment ? { comment } : {}),
    }));
  };
  const ssh = single("hcloud_ssh_key", "production").attributes.public_key;
  require(
    typeof ssh === "string" &&
      ssh.startsWith("ssh-") &&
      /^ssh-ed25519 [A-Za-z0-9+/]{68}$/.test(operatorPublicKey),
  );
  return {
    ssh_public_key: ssh,
    apex_txt_records: txt("apex_txt"),
    google_dkim_records: txt("google_dkim"),
    qualified_hosts: {
      [generation]: {
        image_id: String(host.image),
        source_revision: labels.source_revision,
        qualification_sha256: digest,
        operator_public_key: operatorPublicKey,
      },
    },
    publication_volumes: volumes.map(({ index_key }) => index_key),
    publication_volume: disk.index_key,
    publication_host: generation,
    traffic_host: generation,
  };
}
