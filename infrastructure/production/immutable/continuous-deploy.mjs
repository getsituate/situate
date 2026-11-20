import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { childEnvironment, configuration } from "../../website/config.mjs";
import { rollOut } from "../continuous-rollout.mjs";
import { deploymentGate } from "../hosting-deployment.mjs";
import { main as terraformMain } from "../terraform.mjs";
import { inventoryFromState } from "./hosting-inventory.mjs";
import { observeHost, observeHttps } from "./probe.mjs";
import { verifiedHostKey } from "./enrollment.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const terraform = fileURLToPath(new URL("../terraform.mjs", import.meta.url));
const domain = "getsituate.com";
const stateTool = "sudo -n /usr/local/lib/situate/state.sh";
const enrollUnits = "situate-enrollment.path situate-enrollment.service";
const hostingService = "situate-serving.service";
const phaseName = {
  route: "traffic",
  stage: "stage",
  detach: "detach",
  attach: "attach",
  unprotect: "unprotect",
  retire: "retire",
};
const id = /^[1-9][0-9]{0,14}$/;
const sha = /^[a-f0-9]{64}$/;
const name = /^[a-z][a-z0-9-]{0,19}$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ensure = (condition, detail) => {
  if (!condition) throw new Error(detail);
};
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
    flag: "wx",
    flush: true,
  });

function execute(
  command,
  args,
  { env = childEnvironment(), input, timeout = 120_000 } = {},
) {
  try {
    return execFileSync(command, args, {
      cwd: repository,
      env,
      input,
      timeout,
      encoding: "utf8",
      stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch {
    throw new Error(
      `${command} failed; inspect live state before making further changes.`,
    );
  }
}

function terraformCommand(env, ...args) {
  return execute(process.execPath, [terraform, ...args], {
    env,
    timeout: 180_000,
  });
}

function keyFile(root, value, name) {
  ensure(
    typeof value === "string" && value.trim(),
    `Missing hosting ${name} SSH key.`,
  );
  const path = join(root, `${name}.key`);
  writeFileSync(path, `${value.trim()}\n`, { mode: 0o600, flag: "wx" });
  return path;
}

function git(...args) {
  return execute("git", args);
}

const deploymentInputs = [
  "infrastructure/production/terraform",
  "infrastructure/production/docker/nginx.conf",
  "infrastructure/production/immutable",
  "infrastructure/production/terraform.mjs",
  "infrastructure/production/hcp.mjs",
  "infrastructure/production/immutable-plan.mjs",
  "infrastructure/production/rollout-journal.mjs",
  "infrastructure/production/rollout-reconcile.mjs",
  "infrastructure/production/continuous-rollout.mjs",
  "infrastructure/production/hosting-deployment.mjs",
  "infrastructure/releases/remote.py",
  "infrastructure/website/config.mjs",
  ".github/workflows/deploy-hosting.yml",
];

function spawnGitObjectType(revision) {
  try {
    return git("cat-file", "-t", revision);
  } catch {
    return null;
  }
}

function inputDigest(revision) {
  return hash(
    git("ls-tree", "-r", revision, "--", ...deploymentInputs)
      .split("\n")
      .filter(
        (entry) => !/\.(test\.mjs|md|example)$|\/test_[^/]+\.py$/.test(entry),
      )
      .join("\n"),
  );
}

async function retryObservation(observe, repeats = 18, interval = 5000) {
  for (let attempt = 0; attempt < repeats; attempt++) {
    try {
      return await observe();
    } catch (error) {
      if (attempt === repeats - 1) throw error;
      await wait(interval);
    }
  }
}

function qualifyImage(root, revision, token, event) {
  const path = join(root, "qualification.json");
  const builder = fileURLToPath(
    new URL("github-rehearsal.py", import.meta.url),
  );
  const result = spawnSync(
    "python3",
    ["-B", builder, "qualify-production", path],
    {
      cwd: repository,
      env: { ...childEnvironment(), ...event, HCLOUD_TOKEN: token },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 1_800_000,
    },
  );
  ensure(
    result.status === 0 && !result.error,
    "Image qualification failed; inspect the temporary Hetzner resources for this run.",
  );
  const bytes = readFileSync(path);
  const value = JSON.parse(bytes);
  ensure(
    value.sourceRevision === revision &&
      id.test(value.imageId) &&
      value.schemaVersion === 1 &&
      [
        "offlineBoot",
        "storageFence",
        "httpsAndRedirects",
        "publicationAndFailback",
        "independentRestore",
      ].every((check) => value.gates?.[check] === true),
    "Image qualification does not match the deployed revision.",
  );
  return { value, hash: hash(bytes) };
}

function liveDriver(root, revision, inventory, credentials, event) {
  const old = inventory.traffic_host;
  const generation = `g${revision.slice(0, 15)}`;
  const disks = inventory.publication_volumes;
  const volume = inventory.publication_volume;
  const operatorKey = credentials.operatorKey;
  const publisherKey = credentials.publisherKey;
  const ca = credentials.ca;
  const publicKey = execute("ssh-keygen", ["-y", "-f", operatorKey])
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  const publisherPublic = execute("ssh-keygen", ["-y", "-f", publisherKey])
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  ensure(
    inventory.ssh_public_key.split(/\s+/).slice(0, 2).join(" ") ===
      publisherPublic,
    "Publisher identity differs from the infrastructure inventory.",
  );
  ensure(
    name.test(old) &&
      old !== generation &&
      old !== "legacy" &&
      old === inventory.publication_host &&
      Array.isArray(disks) &&
      disks.includes(volume) &&
      Object.keys(inventory.qualified_hosts).length === 1 &&
      inventory.qualified_hosts[old]?.operator_public_key === publicKey &&
      !inventory.retiring_generation &&
      !Object.hasOwn(inventory, "enrollment_tokens"),
    "The runner needs the settled immutable production inventory and both installed identities.",
  );
  const tf = (...args) => terraformCommand(credentials.env, ...args);
  const caPublic = execute("ssh-keygen", ["-y", "-f", ca])
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  const caHosts = join(root, "publisher-known-hosts");
  function ssh(
    host,
    command,
    {
      key = operatorKey,
      known = caHosts,
      principal = domain,
      login = "situate-ops",
      input,
    } = {},
  ) {
    ensure(isIP(host) === 4, "Invalid SSH destination.");
    return execute(
      "ssh",
      [
        "-F",
        "/dev/null",
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${known}`,
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        `HostKeyAlias=${principal}`,
        "-o",
        "ConnectTimeout=10",
        "-i",
        key,
        `${login}@${host}`,
        command,
      ],
      { input, timeout: 300_000 },
    );
  }

  function verifyHttps(target, proof, peer, publicDns = false) {
    // The hosted runner may only have IPv4. Use the other verified host as
    // an independent IPv6 client, not the VM whose listener is being tested.
    const quote = (arg) => `'${arg.replaceAll("'", "'\\''")}'`;
    const requestV6 = (args, { capture }) => {
      const command = [
        "curl",
        "--disable",
        "--silent",
        "--show-error",
        "--fail",
        "--ipv6",
        "--noproxy",
        "*",
        "--proto",
        "=https",
        "--max-time",
        "180",
        ...args,
      ]
        .map(quote)
        .join(" ");
      const output = ssh(
        peer.ipv4,
        `bash -o pipefail -c ${quote(`${command} | ${capture ? "head -c 1048577 | base64 -w0" : "sha256sum"}`)}`,
      );
      if (!capture) return output.split(/\s+/)[0];
      const bytes = Buffer.from(output, "base64");
      ensure(
        bytes.length <= 1048576,
        "IPv6 probe exceeded its response limit.",
      );
      return bytes;
    };
    return observeHttps(
      { ...target, ...proof, public: publicDns },
      { requestV6 },
    );
  }

  function readState(directory) {
    const state = join(
      directory,
      `state-${randomBytes(8).toString("hex")}.tfstate`,
    );
    tf("export", state);
    return json(state).resources;
  }

  function snapshot(files, generation) {
    const resources = readState(files);
    const server = resources
      .find(
        (row) =>
          row.type === "hcloud_server" &&
          row.name === "immutable" &&
          !row.module,
      )
      ?.instances.find((row) => row.index_key === generation)?.attributes;
    const disk = resources
      .find(
        (row) =>
          row.type === "hcloud_volume" &&
          row.name === "publication" &&
          !row.module,
      )
      ?.instances.find((row) => row.index_key === volume)?.attributes;
    ensure(
      server &&
        disk &&
        id.test(String(server.id)) &&
        id.test(String(server.image)) &&
        id.test(String(disk.id)) &&
        isIP(server.ipv4_address) === 4 &&
        isIP(server.ipv6_address) === 6,
      "HCP does not confirm the selected host and volume identities.",
    );
    return {
      generation,
      sourceRevision: server.labels.source_revision,
      serverId: String(server.id),
      imageId: String(server.image),
      ipv4: server.ipv4_address,
      ipv6: server.ipv6_address,
      volumeId: String(disk.id),
    };
  }

  function provider(path) {
    return fetch(`https://api.hetzner.cloud/v1/${path}`, {
      headers: { Authorization: `Bearer ${credentials.env.HCLOUD_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  }

  async function attachment(host) {
    const response = await provider(`volumes/${host.volumeId}`);
    ensure(response.ok, "Hetzner did not confirm the publication volume.");
    return (await response.json()).volume.server;
  }

  function variables(step, j) {
    const qualification = j.completed.rehearse;
    const stage = step === "stage";
    const candidate = {
      image_id: qualification.value.imageId,
      source_revision: revision,
      qualification_sha256: qualification.hash,
      operator_public_key: publicKey,
    };
    const next = {
      ...inventory,
      qualified_hosts: {
        ...inventory.qualified_hosts,
        [generation]: candidate,
      },
    };
    if (stage)
      next.enrollment_tokens = {
        [generation]: randomBytes(32).toString("hex"),
      };
    if (step === "detach")
      next.publication_host = next.publication_volume = null;
    if (["attach", "route", "unprotect", "retire"].includes(step))
      next.publication_host = generation;
    if (["route", "unprotect", "retire"].includes(step))
      next.traffic_host = generation;
    if (step === "unprotect") next.retiring_generation = old;
    if (step === "retire") delete next.qualified_hosts[old];
    ensure(
      !j.completed.stage ||
        j.completed.stage.candidate.imageId === candidate.image_id,
      "Qualification changed during rollout.",
    );
    return next;
  }

  async function phase(step, j, files) {
    const phase = phaseName[step];
    const vars = join(files, `${phase}.tfvars.json`);
    const next = variables(step, j);
    write(vars, next);
    const plan = join(files, `${phase}.tfplan`);
    const previous = j.completed.qualify.previous;
    const deployment = {
      previous: old,
      previousId: previous.serverId,
      candidate: generation,
      candidateId: j.completed.stage?.candidate.serverId,
      volumeId: previous.volumeId,
      imageId: j.completed.rehearse.value.imageId,
      sourceRevision: revision,
      deletedFirewallMembers: j.completed.qualify.deletedFirewallMembers,
    };
    const evidence =
      step === "stage" ? [join(files, "qualification.json")] : [];
    const options = { deployment, environment: credentials.env };
    await terraformMain(
      ["immutable-plan", phase, vars, plan, ...evidence],
      options,
    );
    await terraformMain(
      [
        "immutable-apply",
        phase,
        plan,
        "--confirm-immutable-change",
        ...evidence,
      ],
      options,
    );
    return phaseResult(step, files, next);
  }

  async function phaseResult(step, files, next) {
    if (step === "stage") return { candidate: snapshot(files, generation) };
    if (step === "detach") {
      const host = snapshot(files, generation);
      await retryObservation(async () =>
        ensure(
          (await attachment(host)) === null,
          "Hetzner has not confirmed volume detachment.",
        ),
      );
      return { volumeDetached: true };
    }
    if (step === "attach") {
      const host = snapshot(files, generation);
      await retryObservation(async () =>
        observeHost(host, { token: credentials.env.HCLOUD_TOKEN }),
      );
    }
    if (step === "retire") return { inventory: next };
    return { applied: true };
  }

  async function enroll(candidate, token, files) {
    const key = await retryObservation(async () => {
      const response = await fetch(
        `http://${candidate.ipv4}/.well-known/situate-host-key`,
        { redirect: "error", signal: AbortSignal.timeout(3000) },
      );
      ensure(
        response.ok &&
          Number(response.headers.get("content-length")) > 0 &&
          Number(response.headers.get("content-length")) <= 1024,
        "Candidate has not published a bounded enrollment proof.",
      );
      const reader = response.body.getReader();
      const entries = [];
      let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1024) {
          await reader.cancel();
          throw new Error("Enrollment response exceeds its limit.");
        }
        entries.push(value);
      }
      return verifiedHostKey(
        JSON.parse(Buffer.concat(entries)),
        candidate.serverId,
        token,
      );
    }, 35);
    const pinned = join(files, "candidate-known-hosts");
    const publicFile = join(files, "candidate.pub");
    writeFileSync(pinned, `${candidate.ipv4} ${key}\n`, {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    writeFileSync(publicFile, `${key}\n`, {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    const remote = { known: pinned, principal: candidate.ipv4 };
    const run = (command, input) =>
      ssh(candidate.ipv4, command, { ...remote, input });
    run(`sudo -n /usr/local/lib/situate/verify-boot.sh ${revision}`);
    if (credentials.websiteKey)
      run(
        "sudo -n /usr/bin/python3 -I /usr/local/lib/situate/website_content.py install-key",
        `${credentials.websiteKey}\n`,
      );
    execute("ssh-keygen", [
      "-q",
      "-s",
      ca,
      "-h",
      "-I",
      candidate.serverId,
      "-n",
      domain,
      "-V",
      "-5m:+52w",
      publicFile,
    ]);
    const certificate = readFileSync(join(files, "candidate-cert.pub"), "utf8");
    run("sudo -n tee /etc/ssh/situate-host-cert.pub >/dev/null", certificate);
    run(
      "sudo -n tee /etc/ssh/situate-host-cert.conf >/dev/null",
      "HostCertificate /etc/ssh/situate-host-cert.pub\n",
    );
    run(
      `sudo -n /usr/sbin/sshd -t && sudo -n systemctl reload ssh && sudo -n systemctl stop ${enrollUnits}`,
    );
    ssh(candidate.ipv4, "true");
    ssh(candidate.ipv4, "true", { key: publisherKey, login: "deploy" });
  }

  return {
    async preflight() {
      const status = JSON.parse(tf("status"));
      ensure(
        status.workspaceId === credentials.workspaceId &&
          !status.locked &&
          status.stateVersion,
        "Production state does not match the runner's provisioned workspace.",
      );
      writeFileSync(caHosts, `@cert-authority ${domain} ${caPublic}\n`, {
        mode: 0o600,
        flag: "wx",
      });
    },
    async perform(step, j, files) {
      const previous = j.completed.qualify?.previous;
      const candidate = j.completed.stage?.candidate;
      const runNew = (command) => ssh(candidate.ipv4, command);
      if (step === "qualify") {
        const previous = snapshot(files, old);
        await observeHost(previous, { token: credentials.env.HCLOUD_TOKEN });
        ssh(previous.ipv4, `${stateTool} writable`);
        const firewall = readState(files).find(
          (row) =>
            row.type === "hcloud_firewall" &&
            row.name === "production" &&
            !row.module,
        )?.instances[0]?.attributes;
        ensure(
          Array.isArray(firewall?.apply_to),
          "Terraform state is missing the production firewall membership.",
        );
        const deletedFirewallMembers = firewall.apply_to
          .filter(({ server }) => String(server) !== previous.serverId)
          .map(({ server }) => String(server));
        for (const member of deletedFirewallMembers) {
          ensure(
            id.test(member) &&
              (await provider(`servers/${member}`)).status === 404,
            "Unexpected live server in the production firewall membership.",
          );
        }
        return { previous, deletedFirewallMembers };
      }
      if (step === "rehearse")
        return qualifyImage(
          files,
          revision,
          credentials.env.HCLOUD_TOKEN,
          event,
        );
      if (phaseName[step]) return phase(step, j, files);
      if (step === "prepare") {
        const token = json(join(files, "stage.tfvars.json")).enrollment_tokens[
          generation
        ];
        const hostOnly = { ...candidate };
        delete hostOnly.volumeId;
        await observeHost(hostOnly, { token: credentials.env.HCLOUD_TOKEN });
        await enroll(candidate, token, files);
        return { ready: true };
      }
      if (step === "fence") {
        ensure(
          String(await attachment(previous)) === previous.serverId,
          "The old host no longer has the volume.",
        );
        ssh(previous.ipv4, `${stateTool} freeze`);
        const proof = JSON.parse(ssh(previous.ipv4, `${stateTool} evidence`));
        await verifyHttps(previous, proof, candidate, true);
        ssh(
          previous.ipv4,
          `sudo -n systemctl stop ${hostingService} && ${stateTool} unmount && ${stateTool} fenced`,
        );
        return {
          proof,
          replacementReady: j.completed.prepare.ready,
          publishersSettled: true,
          oldHostFenced: true,
        };
      }
      if (step === "verifyCandidate") {
        const proof = j.completed.fence.proof;
        ensure(
          [proof.siteSha256, proof.downloadSha256, proof.updateSha256].every(
            (digest) => sha.test(digest),
          ),
          "Invalid frozen state proof.",
        );
        runNew(
          `${stateTool} mount ${candidate.volumeId} && ${stateTool} bind ${proof.siteSha256} ${proof.downloadSha256} ${proof.updateSha256} && sudo -n systemctl start ${hostingService}`,
        );
        await verifyHttps(candidate, proof, previous);
        const privateStatus = ssh(
          candidate.ipv4,
          "curl -qfsS --noproxy '*' --max-time 10 --connect-to getsituate.com:443:127.0.0.1:24443 -o /dev/null -w '%{http_code}' https://getsituate.com/healthz",
          { key: publisherKey, login: "deploy" },
        );
        ensure(
          privateStatus.trim() === "204",
          "The candidate's private release qualification route is unavailable.",
        );
        return { volumeVerified: true, candidateHttpsVerified: true };
      }
      if (step === "verifyPublic") {
        await retryObservation(
          () => verifyHttps(candidate, j.completed.fence.proof, previous, true),
          33,
          30000,
        );
        ssh(candidate.ipv4, "true", { key: publisherKey, login: "deploy" });
        return { publicEndpointsVerified: true, publisherTargetVerified: true };
      }
      if (step === "resume") {
        runNew(`${stateTool} enable --confirm-publication`);
        runNew(`${stateTool} writable`);
        return j.completed.verifyPublic;
      }
      throw new Error("Unknown production rollout step.");
    },
    async finish(j, files) {
      const response = await provider(
        `servers/${j.completed.qualify.previous.serverId}`,
      );
      ensure(
        response.status === 404,
        "Hetzner did not confirm the predecessor's deletion.",
      );
      const fresh = snapshot(files, generation);
      ensure(
        fresh.serverId === j.completed.stage.candidate.serverId &&
          Number(fresh.serverId) === (await attachment(fresh)),
        "The candidate is no longer the recorded volume owner.",
      );
    },
  };
}

async function main() {
  const env = process.env;
  ensure(
    process.argv.length === 2 &&
      env.CI &&
      env.GITHUB_REPOSITORY === "getsituate/situate" &&
      ["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME) &&
      env.GITHUB_REF === "refs/heads/main",
    "Production deployment requires an authorized run on protected main.",
  );
  const revision = git("rev-parse", "HEAD");
  ensure(
    /^[a-f0-9]{40}$/.test(revision) && env.GITHUB_SHA === revision,
    "The checkout does not match the GitHub event.",
  );
  const gate = deploymentGate({
    token: env.GITHUB_TOKEN,
    revision,
    runId: env.GITHUB_RUN_ID,
  });
  await gate.check();
  const directory = mkdtempSync(join(tmpdir(), "situate-hosting-"));
  try {
    await deploy(directory, env, revision, gate);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function deploy(root, env, revision, gate) {
  const creds = configuration([
    "HCLOUD_TOKEN",
    "TF_CLOUD_ORGANIZATION",
    "TF_TOKEN_app_terraform_io",
  ]);
  ensure(
    Object.values(creds).every(
      (value) => typeof value === "string" && value.trim(),
    ) && /^ws-[A-Za-z0-9]+$/.test(env.SITUATE_HCP_WORKSPACE_ID),
    "Provision the production cloud credentials and pin the HCP workspace ID.",
  );
  const websiteKey = env.WEBSITE_CONTENT_PUBLIC_KEY?.trim();
  ensure(
    (!websiteKey && env.WEBSITE_DEPLOY_ENABLED !== "true") ||
      /^ssh-ed25519 [A-Za-z0-9+/]{68}$/.test(websiteKey ?? ""),
    "Expected a dedicated Ed25519 website publication public key.",
  );
  const credentials = {
    websiteKey,
    env: { ...childEnvironment(env), ...creds, CI: "true" },
    workspaceId: env.SITUATE_HCP_WORKSPACE_ID,
  };
  const tf = (...args) => terraformCommand(credentials.env, ...args);
  const status = JSON.parse(tf("status"));
  ensure(
    status.workspaceId === credentials.workspaceId &&
      !status.locked &&
      status.stateVersion,
    "Production state does not match the configured HCP workspace.",
  );
  tf("init");
  const exportFile = join(root, "preflight.tfstate");
  tf("export", exportFile);
  credentials.operatorKey = keyFile(root, env.HOSTING_OPERATOR_KEY, "operator");
  const operatorPublic = execute("ssh-keygen", [
    "-y",
    "-f",
    credentials.operatorKey,
  ])
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  const inventory = inventoryFromState(json(exportFile), operatorPublic);
  ensure(
    !websiteKey ||
      (websiteKey !== operatorPublic &&
        websiteKey !==
          inventory.ssh_public_key.split(/\s+/).slice(0, 2).join(" ")),
    "Website publication requires its own SSH key.",
  );
  const last =
    inventory.qualified_hosts[inventory.traffic_host].source_revision;
  const baseline = spawnGitObjectType(last);
  if (baseline === "commit" && inputDigest(last) === inputDigest(revision)) {
    console.log("No production hosting inputs changed.");
    return;
  }
  const latest = git(
    "ls-remote",
    "https://github.com/getsituate/situate.git",
    "refs/heads/main",
  ).split(/\s+/)[0];
  ensure(
    latest === revision,
    "This is no longer the latest main revision. The newer workflow owns rollout selection.",
  );
  const event = Object.fromEntries(
    [
      "GITHUB_REPOSITORY",
      "GITHUB_REF",
      "GITHUB_SHA",
      "GITHUB_EVENT_NAME",
      "GITHUB_RUN_ID",
      "GITHUB_RUN_ATTEMPT",
    ].map((name) => [name, env[name]]),
  );
  credentials.publisherKey = keyFile(
    root,
    env.HOSTING_PUBLISHER_KEY,
    "publisher",
  );
  credentials.ca = keyFile(root, env.HOSTING_HOST_CA_KEY, "host-ca");
  await rollOut(
    root,
    liveDriver(root, revision, inventory, credentials, event),
    gate,
  );
  console.log("Production replacement verified and predecessor retired.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch {
    console.error(
      "Production deployment stopped. Inspect the GitHub deployment gate, Terraform, Hetzner and DNS before retrying or clearing the gate.",
    );
    process.exitCode = 1;
  }
}
