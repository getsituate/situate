import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { childEnvironment, configuration } from "../../website/config.mjs";
import { rollOut, directoryAccess } from "../continuous-rollout.mjs";
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

function privateFile(path) {
  const info = lstatSync(path);
  ensure(
    info.isFile() &&
      info.nlink === 1 &&
      info.uid === process.getuid() &&
      !(info.mode & 0o077),
    "Expected a private owner-only file on the production runner.",
  );
  return path;
}

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
      `${command} failed; inspect the phase journal before continuing.`,
    );
  }
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
  "infrastructure/releases/remote.py",
  "infrastructure/website/config.mjs",
  ".github/workflows/deploy-hosting.yml",
];

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

function liveDriver(
  root,
  revision,
  inventory,
  operationRoot,
  credentials,
  qualification,
) {
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
  const pass = { ...credentials.env, SITUATE_ROLLOUT_DIRECTORY: root };
  const tf = (...args) =>
    execute(process.execPath, [terraform, ...args], {
      env: pass,
      timeout: 20 * 60_000,
    });
  const caPublic = execute("ssh-keygen", ["-y", "-f", ca])
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  const caHosts = join(operationRoot, "publisher-known-hosts");
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

  function beginStage(j, files) {
    const proofFile = join(files, "qualification.json");
    writeFileSync(proofFile, qualification.bytes, {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    const previous = j.completed.qualify.previous;
    const proposal = join(files, "proposal.json");
    write(proposal, {
      previous: old,
      previousId: previous.serverId,
      candidate: generation,
      volumeId: previous.volumeId,
      imageId: qualification.value.imageId,
      sourceRevision: revision,
    });
    tf("rollout-begin", proposal);
  }

  function variables(step, j) {
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
    let evidence = join(files, "qualification.json");
    if (step !== "stage") {
      const terraformJournal = json(join(root, "active", "operation.json"));
      evidence = join(files, `${phase}.evidence.json`);
      const observations = {
        detach: j.completed.fence,
        attach: j.completed.detach,
        route: j.completed.verifyCandidate,
        unprotect: j.completed.resume,
        retire: j.completed.resume,
      };
      write(evidence, {
        ...observations[step],
        operationId: terraformJournal.id,
        candidateId: j.completed.stage.candidate.serverId,
      });
    }
    tf("immutable-plan", phase, vars, plan, evidence);
    tf("immutable-apply", phase, plan, "--confirm-immutable-change", evidence);
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
      ensure(
        !existsSync(join(root, "active")),
        "An operator-controlled Terraform rollout is already active.",
      );
      if (existsSync(caHosts))
        ensure(
          readFileSync(privateFile(caHosts), "utf8") ===
            `@cert-authority ${domain} ${caPublic}\n`,
          "Publisher CA changed unexpectedly.",
        );
      else
        writeFileSync(caHosts, `@cert-authority ${domain} ${caPublic}\n`, {
          mode: 0o600,
          flag: "wx",
          flush: true,
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
        return { previous };
      }
      if (step === "stage") beginStage(j, files);
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
        await observeHttps({ ...previous, ...proof, public: true });
        write(join(files, "frozen-publication.json"), proof);
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
        await observeHttps({ ...candidate, ...proof });
        return { volumeVerified: true, candidateHttpsVerified: true };
      }
      if (step === "verifyPublic") {
        await retryObservation(
          () =>
            observeHttps({
              ...candidate,
              ...j.completed.fence.proof,
              public: true,
            }),
          8,
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
    async observe(step, j, files) {
      const phase = phaseName[step];
      if (step === "qualify" || step === "verifyPublic")
        return this.perform(step, j, files);
      const candidate = j.completed.stage?.candidate;
      if (
        step === "fence" &&
        existsSync(join(files, "frozen-publication.json"))
      ) {
        const previous = j.completed.qualify.previous;
        ssh(previous.ipv4, `${stateTool} fenced`);
        return {
          proof: json(join(files, "frozen-publication.json")),
          replacementReady: j.completed.prepare.ready,
          publishersSettled: true,
          oldHostFenced: true,
        };
      }
      if (step === "verifyCandidate") {
        await observeHost(candidate, { token: credentials.env.HCLOUD_TOKEN });
        ssh(
          candidate.ipv4,
          `${stateTool} check && systemctl is-active --quiet ${hostingService}`,
        );
        await observeHttps({ ...candidate, ...j.completed.fence.proof });
        return { volumeVerified: true, candidateHttpsVerified: true };
      }
      if (step === "resume") {
        try {
          ssh(j.completed.stage.candidate.ipv4, `${stateTool} writable`);
        } catch {
          return null;
        }
        return j.completed.verifyPublic;
      }
      if (!phase || !existsSync(join(files, `${phase}.tfplan`))) return null;
      const plan = join(files, `${phase}.tfplan`);
      const variables = join(files, `${phase}.tfvars.json`);
      // A recorded completion can be observed; otherwise ask Terraform to
      // compare the original attempted plan with a freshly refreshed no-op.
      if (!existsSync(`${plan}.${phase}.json.complete`)) {
        const args = [
          phase,
          plan,
          variables,
          join(files, `${phase}-${randomBytes(5).toString("hex")}.tfplan`),
        ];
        if (phase === "stage") args.push(join(files, "qualification.json"));
        tf("rollout-reconcile", ...args);
      }
      return phaseResult(step, files, json(variables));
    },
    async finish(j, files) {
      const next = j.completed.retire.inventory;
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
      const temporary = join(
        files,
        `final-${randomBytes(5).toString("hex")}.json`,
      );
      write(temporary, next);
      renameSync(temporary, join(operationRoot, "inventory.tfvars.json"));
      const marker = join(operationRoot, `accepted-${revision}.json`);
      if (!existsSync(marker))
        write(marker, {
          revision,
          digest: j.digest,
          candidate: fresh.serverId,
        });
    },
  };
}

async function main() {
  const env = process.env;
  ensure(
    process.argv.length === 2 &&
      env.CI &&
      env.GITHUB_REPOSITORY === "getsituate/situate" &&
      env.GITHUB_EVENT_NAME === "push" &&
      env.GITHUB_REF === "refs/heads/main",
    "Production deployment is restricted to pushes to the protected main branch.",
  );
  const revision = git("rev-parse", "HEAD");
  ensure(
    /^[a-f0-9]{40}$/.test(revision) && env.GITHUB_SHA === revision,
    "The checkout does not match the GitHub event.",
  );
  const root = env.SITUATE_CONTINUOUS_DIRECTORY ?? "";
  directoryAccess(root);
  const ledger = join(root, "rollouts");
  directoryAccess(ledger);
  if (
    existsSync(join(root, `accepted-${revision}.json`)) &&
    !existsSync(join(ledger, "operation"))
  )
    return;
  const activePath = join(ledger, "operation", "journal.json");
  const active = existsSync(activePath) ? json(privateFile(activePath)) : null;
  const inventory =
    active?.inventory ?? json(privateFile(join(root, "inventory.tfvars.json")));
  if (!active) {
    const last =
      inventory.qualified_hosts?.[inventory.traffic_host]?.source_revision;
    ensure(
      /^[a-f0-9]{40}$/.test(last),
      "The serving generation needs its deployed source revision.",
    );
    if (inputDigest(last) === inputDigest(revision)) {
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
  }
  const bytes = readFileSync(
    privateFile(join(root, "qualification", `${revision}.json`)),
  );
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
      ].every((gate) => value.gates?.[gate] === true),
    "The runner requires an approved image qualification for the merged revision.",
  );
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
  const credentials = {
    env: { ...childEnvironment(env), ...creds, CI: "true" },
    workspaceId: env.SITUATE_HCP_WORKSPACE_ID,
    operatorKey: privateFile(join(root, "operator.key")),
    publisherKey: privateFile(join(root, "publisher.key")),
    ca: privateFile(join(root, "host-ca.key")),
  };
  const status = JSON.parse(
    execute(process.execPath, [terraform, "status"], { env: credentials.env }),
  );
  ensure(
    status.workspaceId === credentials.workspaceId &&
      !status.locked &&
      status.stateVersion,
    "Production state does not match the runner's provisioned workspace.",
  );
  execute(process.execPath, [terraform, "init"], {
    env: credentials.env,
    timeout: 180_000,
  });
  await rollOut(
    ledger,
    { revision, target: "production", digest: hash(bytes), inventory },
    liveDriver(ledger, revision, inventory, root, credentials, {
      bytes,
      value,
      hash: hash(bytes),
    }),
  );
  console.log("Production replacement verified and predecessor retired.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
