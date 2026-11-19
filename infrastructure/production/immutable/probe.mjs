import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { childEnvironment, configuration } from "../../website/config.mjs";

const apex = "getsituate.com";
const id = /^[1-9][0-9]{0,14}$/;
const hash = /^[a-f0-9]{64}$/;
const revision = /^[a-f0-9]{40}$/;

function require(condition, message) {
  if (!condition) throw new Error(message);
}

// Stream artifacts rather than holding a DMG or archive in memory.
function curl(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      [
        "--disable",
        "--silent",
        "--show-error",
        "--fail",
        "--noproxy",
        "*",
        "--proto",
        "=https",
        "--connect-timeout",
        "10",
        "--max-time",
        "180",
        ...args,
      ],
      {
        stdio: ["ignore", "pipe", "ignore"],
        env: childEnvironment(),
      },
    );
    const digest = createHash("sha256");
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (capture && bytes > 1024 * 1024) {
        tooLarge = true;
        child.kill();
      } else if (capture) chunks.push(chunk);
      else digest.update(chunk);
    });
    child.once("error", () => reject(new Error("Could not start curl.")));
    child.once("close", (code) => {
      if (code !== 0 || tooLarge) reject(new Error("HTTPS probe failed."));
      else resolve(capture ? Buffer.concat(chunks) : digest.digest("hex"));
    });
  });
}

async function get(token, path, fetcher) {
  require(typeof token === "string" &&
    token.trim(), "Set a Hetzner API token for provider verification.");
  const response = await fetcher(`https://api.hetzner.cloud/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  require(response.status === 200, "Hetzner did not confirm the resource.");
  return response.json();
}

export async function observeHost(expected, { token, fetcher = fetch } = {}) {
  require(id.test(expected.serverId) &&
    id.test(expected.imageId) &&
    revision.test(expected.sourceRevision) &&
    /^[a-z][a-z0-9-]{0,19}$/.test(
      expected.generation,
    ), "Invalid host identity.");
  const { server } = await get(token, `servers/${expected.serverId}`, fetcher);
  require(String(server?.id) === expected.serverId &&
    String(server.image?.id) === expected.imageId &&
    server.name === `getsituate-${expected.generation}` &&
    server.labels?.source_revision === expected.sourceRevision &&
    server.status ===
      "running", "Hetzner server does not match the expected running image and generation.");
  const ipv4 = server.public_net?.ipv4?.ip;
  // Hetzner returns a network, not the serving IPv6 address selected by Terraform.
  const assigned = server.public_net?.ipv6?.ip;
  const network =
    typeof assigned === "string" && /^([\da-f:]+)\/(\d{1,3})$/i.exec(assigned);
  require(network &&
    isIP(network[1]) === 6 &&
    Number(network[2]) <=
      128, "Hetzner did not confirm the candidate's IPv6 network.");
  const range = new BlockList();
  range.addSubnet(network[1], Number(network[2]), "ipv6");
  require(isIP(ipv4) === 4 &&
    isIP(expected.ipv6) === 6 &&
    ipv4 === expected.ipv4 &&
    range.check(
      expected.ipv6,
      "ipv6",
    ), "Server addresses are missing or unexpected.");
  if (expected.volumeId !== undefined) {
    require(id.test(expected.volumeId), "Invalid volume identity.");
    const { volume } = await get(
      token,
      `volumes/${expected.volumeId}`,
      fetcher,
    );
    require(String(volume?.id) === expected.volumeId &&
      String(volume.server) ===
        expected.serverId, "The expected volume is not attached to this server.");
  }
  return { ipv4, ipv6: expected.ipv6 };
}

function releasePath(value, version, suffix) {
  const entry = new URL(value);
  const base = `/releases/${version}/`;
  const name = entry.pathname.slice(base.length);
  require(entry.origin === `https://${apex}` &&
    !entry.username &&
    !entry.password &&
    !entry.search &&
    !entry.hash &&
    entry.pathname.startsWith(base) &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) &&
    name.endsWith(suffix), "Unexpected release URL.");
  return entry.pathname;
}

const normalize6 = (value) => new URL(`http://[${value}]`).hostname;

export async function observeHttps(
  expected,
  {
    request = curl,
    requestV6 = request,
    lookup4 = resolve4,
    lookup6 = resolve6,
  } = {},
) {
  require(hash.test(expected.downloadSha256) &&
    hash.test(expected.updateSha256) &&
    hash.test(expected.updaterSha256) &&
    hash.test(
      expected.signatureSha256,
    ), "Supply independently captured release digests.");
  require(isIP(expected.ipv4) === 4 &&
    isIP(expected.ipv6) === 6, "Supply both candidate addresses.");
  if (expected.public) {
    for (const name of [apex, `www.${apex}`, `reboot.${apex}`]) {
      const [ipv4, ipv6] = await Promise.all([lookup4(name), lookup6(name)]);
      require(ipv4.length === 1 &&
        ipv4[0] === expected.ipv4 &&
        ipv6.length === 1 &&
        normalize6(ipv6[0]) ===
          normalize6(
            expected.ipv6,
          ), "Public DNS does not point exclusively to the candidate.");
    }
  }
  for (const address of [expected.ipv4, `[${expected.ipv6}]`]) {
    const route = (name) =>
      address ? ["--resolve", `${name}:443:${address}`] : [];
    const obtain = (name, path, extra, capture) =>
      (address.startsWith("[") ? requestV6 : request)(
        [...route(name), ...extra, `https://${name}${path}`],
        {
          capture,
        },
      );
    require((await obtain(apex, "/healthz", [], true)).toString() ===
      "ok\n", "Candidate did not return the hosting health response.");
    const home = await obtain(
      apex,
      "/",
      ["--output", "/dev/null", "--write-out", "%{http_code} %{content_type}"],
      true,
    );
    require(/^200 text\/html\b/.test(
      home.toString(),
    ), "The website does not return an HTML home page.");
    for (const alias of [`www.${apex}`, `reboot.${apex}`]) {
      const result = await obtain(
        alias,
        "/cutover-probe?test=1",
        [
          "--output",
          "/dev/null",
          "--write-out",
          "%{http_code} %{redirect_url}",
        ],
        true,
      );
      require(result.toString() ===
        `301 https://${apex}/cutover-probe?test=1`, "Canonical HTTPS redirect is incorrect.");
    }
    const read = async (name, digest) => {
      const body = await obtain(
        apex,
        `/releases/current/${name}.json`,
        [],
        true,
      );
      require(createHash("sha256").update(body).digest("hex") ===
        digest, "Public release metadata does not match the frozen publication.");
      return JSON.parse(body);
    };
    const download = await read("download", expected.downloadSha256);
    const update = await read("update", expected.updateSha256);
    const version = download.version;
    require(typeof version === "string" &&
      /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?$/.test(version) &&
      version === update.version &&
      hash.test(download.sha256) &&
      download.distribution === "direct" &&
      update.distribution ===
        "direct", "The current endpoints do not agree on a direct release.");
    const updater = update.platforms?.["darwin-aarch64"];
    const intel = update.platforms?.["darwin-x86_64"];
    require(updater?.url === intel?.url &&
      updater?.signature === intel?.signature &&
      typeof updater?.signature ===
        "string", "Updater architectures do not agree.");
    const packagePath = releasePath(download.url, version, ".dmg");
    const updaterPath = releasePath(updater.url, version, ".tar.gz");
    for (const [path, digest] of [
      [packagePath, download.sha256],
      [updaterPath, expected.updaterSha256],
      [`${updaterPath}.sig`, expected.signatureSha256],
    ]) {
      require((await obtain(apex, path, [], false)) ===
        digest, "Published artifact differs from the expected bytes.");
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw new Error(
        "Pipe a private candidate and publication observation record into this command.",
      );
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 16384) throw new Error("Observation record is too large.");
      chunks.push(chunk);
    }
    const expected = JSON.parse(Buffer.concat(chunks));
    const { HCLOUD_TOKEN } = configuration(["HCLOUD_TOKEN"]);
    await observeHost(expected, { token: HCLOUD_TOKEN });
    await observeHttps(expected);
    console.log("Candidate identity, endpoints and release bytes verified.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
