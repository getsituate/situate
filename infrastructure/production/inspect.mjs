#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuration } from "../website/config.mjs";

const rrsets = {
  "@/A": "apex_ipv4",
  "@/AAAA": "apex_ipv6",
  "www/CNAME": "www",
  "reboot/CNAME": "reboot",
  "@/MX": "mail",
  "@/TXT": "apex_txt",
  "google._domainkey/TXT": "google_dkim",
};
const addresses = [
  "hcloud_server.production",
  "hcloud_firewall.production",
  "hcloud_ssh_key.production",
  "hcloud_zone.production",
  ...Object.values(rrsets).map((key) => `hcloud_zone_rrset.${key}`),
];

export async function inventory(token, fetchImpl = fetch) {
  if (!token?.trim())
    throw new Error("Set HCLOUD_TOKEN before reading production inventory.");
  async function get(path) {
    let response;
    try {
      response = await fetchImpl(`https://api.hetzner.cloud/v1/${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(`Hetzner inventory request failed: ${path}.`);
    }
    if (!response.ok)
      throw new Error(
        `Hetzner inventory request failed: HTTP ${response.status}.`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error("Hetzner returned invalid inventory JSON.");
    }
  }

  const [{ server }, { ssh_key: key }] = await Promise.all([
    get("servers/163944733"),
    get("ssh_keys/118079158"),
  ]);
  if (
    server?.name !== "getsituate-production" ||
    key?.name !== "getsituate-production" ||
    server.image?.name !== "ubuntu-24.04" ||
    typeof key.public_key !== "string" ||
    !key.public_key.startsWith("ssh-")
  )
    throw new Error(
      "Production server or SSH key does not match the expected inventory.",
    );

  const dns = new Map();
  let page = 1;
  do {
    const result = await get(
      `zones/getsituate.com/rrsets?per_page=100&page=${page}`,
    );
    if (!Array.isArray(result.rrsets))
      throw new Error("Hetzner returned an invalid DNS inventory.");
    for (const record of result.rrsets) {
      if (
        !record ||
        typeof record.name !== "string" ||
        typeof record.type !== "string"
      )
        throw new Error("Hetzner returned an invalid DNS inventory.");
      if (record.name === "@" && ["NS", "SOA"].includes(record.type)) continue;
      const id = `${record.name}/${record.type}`;
      if (!Object.hasOwn(rrsets, id) || dns.has(id))
        throw new Error(
          "DNS inventory differs from the production Terraform configuration. Review all RRSets before adoption.",
        );
      if (
        !Array.isArray(record.records) ||
        !record.records.length ||
        record.records.some(
          (item) =>
            typeof item.value !== "string" ||
            !item.value ||
            (item.comment != null && typeof item.comment !== "string"),
        )
      )
        throw new Error("Hetzner returned invalid DNS records.");
      // The provider reads empty record comments as null.
      dns.set(
        id,
        record.records.map(({ value, comment }) => ({
          value,
          ...(comment ? { comment } : {}),
        })),
      );
    }
    const pagination = result.meta?.pagination;
    if (!pagination || !Object.hasOwn(pagination, "next_page"))
      throw new Error("Hetzner returned invalid DNS pagination.");
    const next = pagination.next_page;
    if (
      next != null &&
      (!Number.isSafeInteger(next) || next <= page || next > 100)
    )
      throw new Error("Hetzner returned invalid DNS pagination.");
    page = next;
  } while (page != null);
  if (dns.size !== Object.keys(rrsets).length)
    throw new Error(
      "DNS inventory is incomplete. Review all RRSets before adoption.",
    );

  return {
    ssh_public_key: key.public_key,
    apex_txt_records: dns.get("@/TXT"),
    google_dkim_records: dns.get("google._domainkey/TXT"),
  };
}

export function checkAdoptionPlan(plan) {
  const changes = plan?.resource_changes;
  if (plan?.format_version !== "1.2")
    throw new Error("Unsupported Terraform plan JSON format.");
  if (plan.errored || plan.complete === false || plan.deferred_changes?.length)
    throw new Error("The adoption plan must be complete and free of errors.");
  if (
    !Array.isArray(changes) ||
    changes.length !== addresses.length ||
    new Set(changes.map((change) => change.address)).size !==
      addresses.length ||
    changes.some(
      (change) =>
        change.mode !== "managed" || !addresses.includes(change.address),
    )
  )
    throw new Error(
      "The adoption plan must contain exactly the 11 production resource addresses.",
    );
  for (const change of changes) {
    if (
      !Array.isArray(change.change?.actions) ||
      change.change.actions.length !== 1 ||
      change.change.actions[0] !== "no-op"
    )
      throw new Error(
        `Resource changes are not allowed during adoption: ${change.address}.`,
      );
  }
  return {
    resources: changes.length,
    imports: changes.filter((change) => change.change.importing).length,
  };
}

export function saveInventory(path, snapshot) {
  if (!path.endsWith(".tfvars.json") || path.endsWith(".example.tfvars.json"))
    throw new Error(
      "Inventory output must be a non-example .tfvars.json file.",
    );
  const output = resolve(path);
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  return output;
}

export async function main(args) {
  if (
    args.length === 2 &&
    args[0] === "inventory" &&
    args[1].endsWith(".tfvars.json") &&
    !args[1].endsWith(".example.tfvars.json")
  ) {
    const { HCLOUD_TOKEN } = configuration(["HCLOUD_TOKEN"]);
    const output = saveInventory(args[1], await inventory(HCLOUD_TOKEN));
    console.log(`Inventory saved to ${output}`);
  } else if (args.length === 1 && args[0] === "check-plan") {
    const result = checkAdoptionPlan(JSON.parse(readFileSync(0, "utf8")));
    console.log(
      `${result.resources} resources, ${result.imports} imports, no resource changes.`,
    );
  } else {
    throw new Error(
      "Usage: node infrastructure/production/inspect.mjs inventory <output.tfvars.json> | check-plan < plan.json",
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
