import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";

export const immutablePhases = [
  "stage",
  "detach",
  "attach",
  "traffic",
  "unprotect",
  "retire",
];
const generation = /^[a-z][a-z0-9-]{0,19}$/;
const server = /^hcloud_server\.immutable\["([a-z][a-z0-9-]{0,19})"\]$/;
const volume = /^hcloud_volume\.publication\["([a-z][a-z0-9-]{0,19})"\]$/;
const attachment = "hcloud_volume_attachment.publication[0]";
const apex = ["hcloud_zone_rrset.apex_ipv4", "hcloud_zone_rrset.apex_ipv6"];

function allowsFirewallDrift(drift, phase, operation) {
  if (!drift.length) return true;
  if (
    !operation ||
    drift.length !== 1 ||
    drift[0].address !== "hcloud_firewall.production" ||
    !isDeepStrictEqual(drift[0].change?.actions, ["update"])
  )
    return false;
  const { before, after } = drift[0].change;
  if (!before || !after) return false;
  const { apply_to: beforeLinks, ...beforePolicy } = before;
  const { apply_to: afterLinks, ...afterPolicy } = after;
  if (!isDeepStrictEqual(beforePolicy, afterPolicy)) return false;
  const members = (links) =>
    Array.isArray(links) &&
    links.every(
      (link) =>
        Number.isSafeInteger(link?.server) &&
        link.server > 0 &&
        link.label_selector === "",
    )
      ? links.map(({ server }) => String(server)).sort()
      : null;
  if (phase === "detach")
    return (
      isDeepStrictEqual(members(beforeLinks), [operation.previousId]) &&
      isDeepStrictEqual(
        members(afterLinks),
        [operation.previousId, operation.candidateId].sort(),
      )
    );
  if (phase === "stage" && operation.deletedFirewallMembers?.length)
    return (
      isDeepStrictEqual(
        members(beforeLinks),
        [operation.previousId, ...operation.deletedFirewallMembers].sort(),
      ) && isDeepStrictEqual(members(afterLinks), [operation.previousId])
    );
  return false;
}

export function checkImmutablePlan(plan, phase, receiptBytes, operation) {
  function require(condition, detail) {
    if (!condition) throw new Error(`Unsafe ${phase} plan: ${detail}.`);
  }
  require(immutablePhases.includes(phase) &&
    plan?.format_version === "1.2" &&
    plan.complete === true &&
    plan.applyable === true &&
    plan.errored === false &&
    !plan.deferred_changes?.length &&
    allowsFirewallDrift(plan.resource_drift ?? [], phase, operation) &&
    Array.isArray(
      plan.resource_changes,
    ), "plan must be complete, applyable and free of drift");
  const rows = new Map();
  const changed = new Map();
  for (const row of plan.resource_changes) {
    require(row.mode === "managed" &&
      !rows.has(row.address) &&
      !row.previous_address &&
      !row.deposed &&
      !row.change?.importing &&
      row.change?.actions?.length ===
        1, `unexpected resource operation at ${row.address}`);
    rows.set(row.address, row.change);
    if (row.change.actions[0] !== "no-op")
      changed.set(row.address, row.change.actions[0]);
  }
  const legacy = rows.get("hcloud_server.production");
  require((operation?.migration
    ? Boolean(legacy)
    : !legacy || legacy.actions[0] === "no-op") &&
    rows.get("hcloud_zone.production")?.actions[0] === "no-op" &&
    changed.size > 0, "legacy ownership and zone must be unchanged");
  if (!operation) {
    // The unjournaled path exists only for the initial import from the legacy
    // root disk. It cannot perform a second traffic handoff.
    const legacyRouting = apex.map((address, index) => {
      const key = index ? "ipv6_address" : "ipv4_address";
      const record = rows.get(address);
      const last = record?.before?.records;
      return (
        isIP(legacy?.before?.[key]) === (index ? 6 : 4) &&
        last?.length === 1 &&
        last[0]?.value === legacy.before[key]
      );
    });
    const finishesPartialTraffic =
      phase === "traffic" &&
      legacyRouting.some(Boolean) &&
      apex.every((address, index) =>
        changed.has(address) ? legacyRouting[index] : !legacyRouting[index],
      );
    require(legacy?.before &&
      ["stage", "attach", "traffic"].includes(phase) &&
      (legacyRouting.every(Boolean) ||
        finishesPartialTraffic), "a rollout journal is required outside the initial migration");
  }
  if (operation) {
    require(!operation.migration ||
      ["unprotect", "retire"].includes(phase), "legacy retirement phase");
    const previousAddress = operation.migration
      ? "hcloud_server.production"
      : `hcloud_server.immutable["${operation.previous}"]`;
    const candidateAddress = `hcloud_server.immutable["${operation.candidate}"]`;
    const previous = rows.get(previousAddress);
    const candidate = rows.get(candidateAddress);
    const publication = rows.get(attachment);
    const value = (key) => plan.variables?.[key]?.value;
    const numeric = (resource, key) => String(resource?.[key]);
    const attached = (resource, hostId) =>
      numeric(resource, "server_id") === hostId &&
      numeric(resource, "volume_id") === operation.volumeId &&
      resource?.automount === false;
    const routed = (server) =>
      isIP(server?.ipv4_address) === 4 &&
      isIP(server?.ipv6_address) === 6 &&
      apex.every((address, index) => {
        const records = rows.get(address)?.after?.records;
        return (
          records?.length === 1 &&
          records[0]?.value === server[index ? "ipv6_address" : "ipv4_address"]
        );
      });
    require(numeric(previous?.before, "id") ===
      operation.previousId, "different previous server");
    if (phase === "stage") {
      require(changed.size === 1 &&
        changed.get(candidateAddress) === "create" &&
        candidate.after?.image === operation.imageId &&
        candidate.after?.labels?.source_revision === operation.sourceRevision &&
        attached(publication?.after, operation.previousId) &&
        routed(
          previous.after,
        ), "stage must leave current storage and routing unchanged and create the one recorded candidate");
    } else {
      require(candidate?.actions[0] === "no-op" &&
        numeric(candidate.after, "id") === operation.candidateId &&
        candidate.after?.image === operation.imageId &&
        candidate.after?.labels?.source_revision === operation.sourceRevision &&
        candidate.after?.delete_protection ===
          true, "candidate must match the recorded qualified server");
      const switched = ["traffic", "unprotect", "retire"].includes(phase);
      require(routed(
        switched ? candidate.after : previous.after,
      ), "unexpected traffic target");
      if (phase === "detach")
        require(attached(
          publication?.before,
          operation.previousId,
        ), "only detach the recorded volume from the previous server");
      if (["attach", "traffic", "unprotect", "retire"].includes(phase)) {
        require(attached(publication?.after, operation.candidateId) &&
          value("publication_host") ===
            operation.candidate, "expected the recorded volume on the candidate");
      }
    }
    if (phase === "unprotect") {
      const {
        id: beforeId,
        delete_protection: beforeProtection,
        ...before
      } = previous.before ?? {};
      const {
        id: afterId,
        delete_protection: afterProtection,
        ...after
      } = previous.after ?? {};
      require(changed.size === 1 &&
        changed.get(previousAddress) === "update" &&
        value("retiring_generation") === operation.previous &&
        beforeId === afterId &&
        beforeProtection === true &&
        afterProtection === false &&
        JSON.stringify(before) === JSON.stringify(after) &&
        Object.values(previous.after_unknown ?? {}).every(
          (field) => field === false,
        ), "only lift the previous server's delete protection");
      return changed.size;
    }
    if (phase === "retire") {
      require(changed.size === 1 &&
        changed.get(previousAddress) === "delete" &&
        previous.before.delete_protection === false &&
        previous.after === null &&
        value("retiring_generation") ==
          null, "only delete the accepted previous server");
      return changed.size;
    }
  }
  require(!["unprotect", "retire"].includes(
    phase,
  ), "retirement requires a rollout journal");
  if (phase === "stage") {
    let hosts = 0;
    let volumes = 0;
    for (const [address, action] of changed) {
      const name = server.exec(address)?.[1];
      const after = rows.get(address).after;
      const diskName = volume.exec(address)?.[1];
      require(action === "create" &&
        (name || diskName), `unexpected change at ${address}`);
      if (name) {
        const pin = plan.variables?.qualified_hosts?.value?.[name];
        require(receiptBytes !=
          null, "supply the private exact-image qualification receipt");
        const receipt = JSON.parse(receiptBytes);
        require(typeof pin?.image_id === "string" &&
          /^[1-9][0-9]{0,14}$/.test(pin.image_id) &&
          /^[0-9a-f]{40}$/.test(pin.source_revision) &&
          createHash("sha256").update(receiptBytes).digest("hex") ===
            pin.qualification_sha256 &&
          receipt?.schemaVersion === 1 &&
          receipt.imageId === pin.image_id &&
          receipt.sourceRevision === pin.source_revision &&
          [
            "offlineBoot",
            "storageFence",
            "httpsAndRedirects",
            "publicationAndFailback",
            "independentRestore",
          ].every((gate) => receipt.gates?.[gate] === true) &&
          after?.name === `getsituate-${name}` &&
          after.image === pin.image_id &&
          after.labels?.source_revision === pin.source_revision &&
          after.labels?.qualification_a + after.labels?.qualification_b ===
            pin.qualification_sha256 &&
          after.delete_protection === true &&
          after.rebuild_protection ===
            true, "new host must use the exact qualified image and protections");
        ++hosts;
      } else {
        require(after?.name === `getsituate-publication-${diskName}` &&
          after.delete_protection ===
            true, "publication volume must be protected");
        ++volumes;
      }
    }
    require(hosts <= 1 &&
      volumes <= 1, "stage at most one host and one volume at a time");
    require(hosts > 0 ||
      receiptBytes ==
        null, "volume-only staging does not take an image receipt");
    return changed.size;
  }
  if (phase === "detach") {
    require(changed.size === 1 &&
      changed.get(attachment) ===
        "delete", "detach must only remove the attachment");
    return changed.size;
  }

  const name =
    plan.variables?.[phase === "attach" ? "publication_host" : "traffic_host"]
      ?.value;
  require(typeof name === "string" &&
    generation.test(name), "select an immutable generation");
  const host = rows.get(`hcloud_server.immutable["${name}"]`);
  const diskName = plan.variables?.publication_volume?.value;
  require(typeof diskName === "string" &&
    generation.test(diskName), "select a publication volume");
  const disk = rows.get(`hcloud_volume.publication["${diskName}"]`);
  const link = rows.get(attachment);
  const id = (value) =>
    (typeof value === "string" || Number.isSafeInteger(value)) &&
    /^[1-9][0-9]{0,14}$/.test(value);
  require(host?.actions[0] === "no-op" &&
    id(host.after?.id) &&
    disk?.actions[0] === "no-op" &&
    id(disk.after?.id) &&
    id(link?.after?.server_id) &&
    String(link.after.server_id) === String(host.after.id) &&
    id(link?.after?.volume_id) &&
    String(link.after.volume_id) === String(disk.after.id) &&
    link.after.automount ===
      false, "require the existing publication volume and selected host with manual mount");
  if (phase === "attach") {
    require(changed.size === 1 &&
      changed.get(attachment) === "create", "attach from detached state only");
  } else {
    require(link.actions[0] === "no-op" &&
      [...changed].every(
        ([address, action]) => apex.includes(address) && action === "update",
      ), "traffic may only update apex addresses to the attached host");
    for (const [index, address] of apex.entries()) {
      const { before, after, after_unknown: unknown } = rows.get(address);
      const ip = index ? host.after.ipv6_address : host.after.ipv4_address;
      require(isIP(ip) === (index ? 6 : 4) &&
        typeof before?.zone === "string" &&
        before.zone === after?.zone &&
        before.name === "@" &&
        after.name === "@" &&
        before.type === (index ? "AAAA" : "A") &&
        before.type === after.type &&
        before.ttl === after.ttl &&
        !unknown?.records?.[0]?.value &&
        after.records?.length === 1 &&
        after.records[0].value ===
          ip, `unexpected record change at ${address}`);
    }
  }
  return changed.size;
}
