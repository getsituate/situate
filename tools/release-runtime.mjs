import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, join } from "node:path";
import { withReleaseSSH } from "./release-environment.mjs";
import { ordinaryEnvironment } from "./pipeline-environment.mjs";
import { atomicJson, operationDirectory } from "./pipeline-state.mjs";
import {
  readPublicationHistory,
  sshArguments,
} from "../infrastructure/releases/transport.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const endpoint = "https://getsituate.com/releases/current/update.json";
const hashPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function qualificationEnvironment(environment) {
  return Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL"]
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
}

export function automaticQualification(configuration) {
  return (
    configuration?.qualification?.profile === "macos-direct-v1" &&
    !configuration.qualificationResources
  );
}

async function publicJson(url, request) {
  const response = await request(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, "Cannot read the current production update feed");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(
      size <= 1024 * 1024,
      "Production update feed exceeds its size limit",
    );
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Production update feed is not valid JSON");
  }
  return { value, sha256: sha256(bytes) };
}

export function readPredecessorManifest({
  destination,
  version,
  environment,
  execute = execFileSync,
}) {
  assert(versionPattern.test(version), "Invalid predecessor version");
  const program = `import base64,json,os,stat\np='/opt/situate/releases/${version}/manifest.json'\ns=os.lstat(p)\nif not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size > 1048576: raise ValueError('Invalid predecessor manifest')\nfd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)\ntry:\n s2=os.fstat(fd)\n if (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)!=(s2.st_dev,s2.st_ino,s2.st_size,s2.st_mtime_ns): raise ValueError('Manifest changed')\n data=os.read(fd,1048577)\n if len(data)!=s.st_size: raise ValueError('Manifest changed')\n print(base64.b64encode(data).decode())\nfinally: os.close(fd)`;
  let encoded;
  try {
    encoded = execute(
      "ssh",
      [
        ...sshArguments(destination),
        `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(program).toString("base64")}"))'`,
      ],
      {
        env: ordinaryEnvironment(environment),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    ).trim();
  } catch {
    throw new Error("Cannot read the exact host-channel predecessor manifest");
  }
  assert(
    /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
    "Invalid predecessor manifest transport",
  );
  const bytes = Buffer.from(encoded, "base64");
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Host-channel predecessor manifest is not valid JSON");
  }
  assert(
    manifest.status === "complete" && manifest.version === version,
    "Host-channel predecessor is not the expected complete release",
  );
  return { manifest, bytes, sha256: sha256(bytes) };
}

export async function downloadPredecessorAsset(
  url,
  file,
  expected,
  { request = fetch } = {},
) {
  const maximum = expected.size ?? 64 * 1024;
  assert(
    Number.isSafeInteger(maximum) &&
      maximum > 0 &&
      maximum <= 2 * 1024 ** 3 &&
      hashPattern.test(expected.sha256),
    "Invalid predecessor asset identity",
  );
  if (existsSync(file)) {
    const stat = lstatSync(file);
    assert(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        stat.size <= maximum &&
        sha256(readFileSync(file)) === expected.sha256,
      "Retained predecessor asset differs; preserve and inspect it",
    );
    return;
  }
  const partial = `${file}.partial`;
  const handle = await open(partial, "wx", 0o600);
  let completed = false;
  try {
    const response = await request(url, {
      redirect: "error",
      signal: AbortSignal.timeout(300_000),
    });
    assert(response.ok, "Cannot download the exact predecessor asset");
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert(size <= maximum, "Predecessor download exceeds its sealed size");
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    assert(
      (expected.size === undefined || size === expected.size) &&
        hash.digest("hex") === expected.sha256,
      "Predecessor download differs from its manifest",
    );
    await handle.sync();
    await handle.close();
    await rename(partial, file);
    completed = true;
  } finally {
    if (!completed) {
      await handle.close().catch(() => {});
      await rm(partial, { force: true });
    }
  }
}

export async function prepareReleaseRuntime(
  root,
  record,
  {
    destination,
    operation,
    environment = process.env,
    request = fetch,
    execute = execFileSync,
    resolveAddress = lookup,
    account = userInfo(),
    platform = process.platform,
    desktopProbe,
    readHistory = readPublicationHistory,
    readManifest = readPredecessorManifest,
    createHost,
    createProfile,
  } = {},
) {
  assert(
    automaticQualification(record.configuration),
    "Unknown automatic qualification profile",
  );
  assert(
    platform === "darwin",
    "Automatic final-artifact preparation requires macOS",
  );
  const hosted = environment.GITHUB_ACTIONS === "true";
  const localAccount = record.configuration.qualification.account;
  assert(
    hosted
      ? environment.GITHUB_REPOSITORY === "getsituate/situate"
      : localAccount?.mode === "ephemeral-host" &&
          localAccount.uid === account.uid &&
          localAccount.name === account.username &&
          localAccount.home === account.homedir,
    "Automatic preparation requires the trusted GitHub runner or an explicitly identified disposable local macOS host",
  );
  assert(
    account.uid > 500 &&
      typeof account.username === "string" &&
      account.homedir,
    "Missing isolated runner account identity",
  );
  const directory = operationDirectory(root, operation);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "runtime-configuration.json");
  assert(
    !existsSync(file),
    "Runtime preparation already exists; inspect it and use the original sealed plan instead of authorizing new inputs",
  );
  const probe =
    desktopProbe ?? (await import("./release-desktop.mjs")).probeReleaseDesktop;
  await probe({ environment: qualificationEnvironment(environment) });
  const runnerImage = hosted
    ? [environment.ImageOS, environment.ImageVersion].filter(Boolean).join(":")
    : `macos:${execute("/usr/bin/sw_vers", ["-buildVersion"], { env: qualificationEnvironment(environment), encoding: "utf8", timeout: 5000 }).trim()}`;
  assert(
    runnerImage && (!hosted || environment.ImageVersion),
    "Missing resolved macOS runner image identity",
  );
  const publicFeed = await publicJson(endpoint, request);
  const publicAddress = (
    await resolveAddress(new URL(endpoint).hostname, { family: 4 })
  ).address;
  assert(
    isIP(publicAddress) === 4 && !publicAddress.startsWith("127."),
    "Missing public production reference address",
  );
  const version = publicFeed.value.version;
  assert(
    versionPattern.test(version),
    "Production feed has no valid predecessor version",
  );
  const tls = record.configuration.qualification.tls;
  assert(
    tls && typeof tls === "object",
    "Missing private qualification TLS configuration",
  );
  return withReleaseSSH({ root, environment }, async (preparedEnvironment) => {
    const hostConfiguration = {
      ...tls,
      host: destination,
      sshIdentity: preparedEnvironment.WEBSITE_SSH_IDENTITY,
      sshKnownHosts: preparedEnvironment.WEBSITE_SSH_KNOWN_HOSTS,
      hostname: new URL(endpoint).hostname,
      feedPath: new URL(endpoint).pathname.slice(1),
      publicFeedSha256: publicFeed.sha256,
    };
    const host = (
      createHost ??
      (await import("../infrastructure/releases/qualification-host.mjs"))
        .createQualificationHost
    )(hostConfiguration);
    const history = await readHistory(root, {
      destination: {
        host: destination,
        sshIdentity: preparedEnvironment.WEBSITE_SSH_IDENTITY,
        sshKnownHosts: preparedEnvironment.WEBSITE_SSH_KNOWN_HOSTS,
      },
      environment: preparedEnvironment,
    });
    const predecessor = await readManifest({
      destination: {
        WEBSITE_DEPLOY_HOST: destination,
        WEBSITE_SSH_IDENTITY: preparedEnvironment.WEBSITE_SSH_IDENTITY,
        WEBSITE_SSH_KNOWN_HOSTS: preparedEnvironment.WEBSITE_SSH_KNOWN_HOSTS,
      },
      version,
      environment: preparedEnvironment,
      execute,
    });
    const published = history.releases?.find(
      (release) => release.version === version,
    );
    assert(
      published?.manifestSha256 === predecessor.sha256,
      "Predecessor differs from immutable host publication history",
    );
    const artifact = predecessor.manifest.artifacts?.[0];
    assert(
      artifact?.buildConfiguration?.endpoint === endpoint &&
        artifact.version === version &&
        artifact.buildConfiguration.publicKey ===
          record.configuration.updaterPublicKey &&
        ["darwin-aarch64", "darwin-x86_64"].every(
          (target) =>
            publicFeed.value.platforms?.[target]?.signature ===
            artifact.updater.signature,
        ),
      "Public feed, configured trust key and host predecessor disagree",
    );
    const predecessorDirectory = join(directory, "predecessor");
    mkdirSync(predecessorDirectory, { recursive: true, mode: 0o700 });
    const predecessorStat = lstatSync(predecessorDirectory);
    assert(
      predecessorStat.isDirectory() &&
        !predecessorStat.isSymbolicLink() &&
        (predecessorStat.mode & 0o077) === 0 &&
        predecessorStat.uid === process.getuid(),
      "Predecessor storage must be an owned private directory",
    );
    const manifestFile = join(predecessorDirectory, "manifest.json");
    if (existsSync(manifestFile))
      assert(
        sha256(readFileSync(manifestFile)) === predecessor.sha256,
        "Retained predecessor manifest changed",
      );
    else
      writeFileSync(manifestFile, predecessor.bytes, {
        mode: 0o600,
        flag: "wx",
      });
    for (const item of [
      artifact,
      artifact.updater,
      {
        path: artifact.updater.signaturePath,
        sha256: artifact.updater.signatureSha256,
      },
    ]) {
      assert(
        typeof item.path === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(item.path) &&
          basename(item.path) === item.path,
        "Invalid predecessor asset name",
      );
      await downloadPredecessorAsset(
        new URL(`/releases/${version}/${item.path}`, endpoint),
        join(predecessorDirectory, item.path),
        item,
        { request },
      );
    }
    const facts = await host.prepare({
      operationNonce: operation,
      operationId: operation,
    });
    const profile =
      createProfile ??
      (await import("../client/scripts/final-artifact-journeys.mjs"))
        .defaultFinalArtifactConfiguration;
    const qualification = profile({
      account: {
        mode: "ephemeral-host",
        uid: account.uid,
        name: account.username,
        home: account.homedir,
      },
      runnerImage,
      predecessor: {
        directory: predecessorDirectory,
        manifest: predecessor.manifest,
      },
      routing: {
        endpoint,
        privateAddress: facts.privateAddress,
        publicAddress,
        interface: facts.interface,
        identityPath: facts.identityPath,
        identitySha256: facts.identitySha256,
        publicFeedSha256: publicFeed.sha256,
        operationId: operation,
      },
    });
    const configuration = {
      ...record.configuration,
      configurationTemplateSha256: record.sha256,
      qualification,
      qualificationResources: {
        operation,
        destination,
        tls,
        facts,
        publicFeedSha256: publicFeed.sha256,
      },
    };
    atomicJson(file, configuration);
    return { file, configuration, sha256: sha256(readFileSync(file)) };
  });
}

export async function runPreparedQualification(
  root,
  {
    plan,
    record,
    configuration,
    directory,
    environment = process.env,
    signal,
    executeWorker,
    createHost,
    withRoute,
  },
) {
  const runtime = configuration.qualificationResources;
  let file = record.file;
  if (!file) {
    file = join(
      operationDirectory(root, plan.operation),
      "qualification-configuration.json",
    );
    if (existsSync(file)) {
      const stat = lstatSync(file);
      assert(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.nlink === 1 &&
          (stat.mode & 0o077) === 0 &&
          sha256(readFileSync(file)) === record.sha256,
        "Retained qualification configuration differs from its authorization",
      );
    } else writeFileSync(file, record.bytes, { flag: "wx", mode: 0o600 });
  }
  const execute =
    executeWorker ?? (await import("../client/scripts/ios-xcode.mjs")).run;
  const worker = async (_route, routeSignal) => {
    const signals = [signal, routeSignal, AbortSignal.timeout(1800_000)].filter(
      Boolean,
    );
    let output;
    try {
      output = await execute(
        process.execPath,
        [
          join(root, "tools/release-qualification-worker.mjs"),
          "--directory",
          directory,
          "--configuration",
          file,
          "--configuration-sha256",
          record.sha256,
        ],
        {
          cwd: root,
          env: qualificationEnvironment(environment),
          signal: AbortSignal.any(signals),
          capture: true,
          terminationGraceMs: 75_000,
        },
      );
    } catch (cause) {
      const error =
        cause instanceof Error
          ? cause
          : new Error("Qualification worker did not finish", { cause });
      error.uncertain = true;
      throw error;
    }
    try {
      return JSON.parse(output);
    } catch {
      const error = new Error(
        "Qualification worker returned no valid receipt; inspect the retained operation",
      );
      error.uncertain = true;
      throw error;
    }
  };
  if (!runtime) return worker();
  assert(
    runtime.operation === plan.operation &&
      runtime.destination === plan.destination,
    "Private qualification resources belong to another authorized operation",
  );
  const { createQualificationHost, withQualificationRoute } =
    await import("../infrastructure/releases/qualification-host.mjs");
  const host = (createHost ?? createQualificationHost)(
    {
      ...runtime.tls,
      host: plan.destination,
      sshIdentity: environment.WEBSITE_SSH_IDENTITY,
      sshKnownHosts: environment.WEBSITE_SSH_KNOWN_HOSTS,
      hostname: new URL(endpoint).hostname,
      feedPath: new URL(endpoint).pathname.slice(1),
      publicFeedSha256: runtime.publicFeedSha256,
    },
    { environment },
  );
  const operation = {
    operationNonce: plan.operation,
    operationId: plan.operation,
  };
  let knownOwner = false;
  let qualificationFailure;
  let cleanupFailure;
  let result;
  try {
    const state = await host.inspect(operation);
    assert(
      state.operationId === plan.operation &&
        state.status === "prepared" &&
        !state.uncertain,
      "Private listener requires its exact fresh prepared operation",
    );
    for (const name of [
      "identityPath",
      "identitySha256",
      "imageId",
      "certificateVolume",
    ])
      assert(
        state[name] === runtime.facts[name],
        "Private listener preparation differs from the sealed configuration",
      );
    knownOwner = true;
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
    const artifact = manifest.artifacts?.[0];
    assert(
      manifest.status === "complete" &&
        artifact?.buildConfiguration?.endpoint === endpoint,
      "Only the exact completed production-configured candidate can be staged",
    );
    const { metadata } = await import("../infrastructure/releases/publish.mjs");
    const feed = join(
      operationDirectory(root, plan.operation),
      "qualification-feed.json",
    );
    atomicJson(feed, metadata(manifest, artifact)["update.json"]);
    const files = [
      {
        path: "releases/current/update.json",
        source: feed,
        size: lstatSync(feed).size,
        sha256: sha256(readFileSync(feed)),
      },
    ];
    for (const item of [
      artifact,
      artifact.updater,
      {
        path: artifact.updater.signaturePath,
        sha256: artifact.updater.signatureSha256,
      },
    ]) {
      assert(
        typeof item.path === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(item.path),
        "Invalid candidate asset name",
      );
      const source = join(directory, item.path);
      files.push({
        path: `releases/${manifest.version}/${item.path}`,
        source,
        size: lstatSync(source).size,
        sha256: item.sha256,
      });
    }
    await host.stage({ ...operation, files });
    await host.serve(operation);
    result = await (withRoute ?? withQualificationRoute)(
      {
        host,
        ...operation,
        hostname: new URL(endpoint).hostname,
        privateAddress: configuration.qualification.routing.privateAddress,
        localPort: 443,
        trustedEphemeralRunner: true,
      },
      worker,
      { signal },
    );
  } catch (error) {
    qualificationFailure = { error };
  } finally {
    if (knownOwner) {
      try {
        await host.cleanup({ ...operation, retainArtifacts: true });
      } catch (error) {
        cleanupFailure = { error };
      }
    }
  }
  if (cleanupFailure) {
    const error = new AggregateError(
      qualificationFailure
        ? [qualificationFailure.error, cleanupFailure.error]
        : [cleanupFailure.error],
      "Private qualification cleanup is uncertain; inspect retained operation evidence",
    );
    error.uncertain = true;
    throw error;
  }
  if (qualificationFailure) throw qualificationFailure.error;
  return result;
}
