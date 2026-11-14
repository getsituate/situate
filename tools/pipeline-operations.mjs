import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  digest,
  operationDirectory,
  saveOperation,
} from "./pipeline-state.mjs";
import { releaseEnvironment } from "./release-environment.mjs";
import { ordinaryEnvironment } from "./pipeline-environment.mjs";
import {
  githubAdapter,
  readOnlyGitHubAdapter,
} from "../infrastructure/releases/github.mjs";

const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const sha = /^[a-f0-9]{40}$/;
const hostFields = (plan, config) => ({
  WEBSITE_DEPLOY_HOST: plan.destination,
  ...(config.sshIdentity ? { WEBSITE_SSH_IDENTITY: config.sshIdentity } : {}),
  ...(config.sshKnownHosts
    ? { WEBSITE_SSH_KNOWN_HOSTS: config.sshKnownHosts }
    : {}),
});
const git = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: ordinaryEnvironment(),
  }).trim();
const previous = (operation, name) => {
  const stage = operation.stages.find(
    (entry) => entry.name === name && entry.status === "passed",
  );
  assert(stage?.output, `Missing successful predecessor: ${name}`);
  return stage.output;
};
const canonical = (value) =>
  JSON.stringify(value, (_key, entry) =>
    entry && !Array.isArray(entry) && typeof entry === "object"
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  );

export function readConfiguration(
  root,
  file,
  { environment = process.env } = {},
) {
  let bytes;
  if (file === undefined) {
    const names = [
      "SITUATE_RELEASE_CONFIG_JSON",
      "SITUATE_RELEASE_CONFIG_FILE",
    ];
    const explicit = names.some((name) => Object.hasOwn(environment, name));
    const values = explicit
      ? Object.fromEntries(
          names
            .filter((name) => Object.hasOwn(environment, name))
            .map((name) => [name, environment[name]]),
        )
      : releaseEnvironment(root, names, environment);
    if (Object.hasOwn(environment, "SITUATE_RELEASE_CONFIG_JSON"))
      assert(
        typeof values.SITUATE_RELEASE_CONFIG_JSON === "string" &&
          values.SITUATE_RELEASE_CONFIG_JSON.length > 0,
        "SITUATE_RELEASE_CONFIG_JSON must contain a release configuration",
      );
    if (values.SITUATE_RELEASE_CONFIG_JSON) {
      assert(
        !values.SITUATE_RELEASE_CONFIG_FILE,
        "Select either SITUATE_RELEASE_CONFIG_JSON or SITUATE_RELEASE_CONFIG_FILE, not both",
      );
      bytes = values.SITUATE_RELEASE_CONFIG_JSON;
    } else {
      file =
        values.SITUATE_RELEASE_CONFIG_FILE ??
        (environment.CI
          ? undefined
          : join(root, ".release-operations", "config.json"));
    }
  }
  if (bytes === undefined) {
    if (file === undefined || !existsSync(file)) return null;
    const stat = lstatSync(file);
    assert(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        (stat.mode & 0o077) === 0 &&
        (typeof process.getuid !== "function" || stat.uid === process.getuid()),
      "Release configuration must be an owned private regular file (0600)",
    );
    bytes = readFileSync(file, "utf8");
  }
  let configuration;
  try {
    configuration = JSON.parse(bytes);
  } catch {
    throw new Error("Release configuration must contain valid JSON");
  }
  assert(
    configuration?.schemaVersion === 1,
    "Unsupported release configuration",
  );
  return {
    ...(file !== undefined ? { file: resolve(file) } : {}),
    sha256: digest(bytes),
    configuration,
  };
}

export async function readBaseline(
  root,
  { repository, source, environment = process.env },
) {
  const { readCompletedReleaseBaseline } = await import("./github-release.mjs");
  const completed = await readCompletedReleaseBaseline(root, {
    repository,
    revision: source,
    environment,
  });
  if (completed)
    return {
      source: completed.source,
      identity: completed.identity,
      catalogSha256: completed.catalogSha256,
    };
  const checkpoint = "releases/migration-checkpoint.json";
  const entry = git(root, ["ls-tree", source, "--", checkpoint]);
  if (entry) {
    const pin = JSON.parse(
      git(root, ["show", `${source}:${checkpoint}`]),
    ).release;
    assert(sha.test(pin?.revision), "Missing legacy published source identity");
    git(root, ["merge-base", "--is-ancestor", pin.revision, source]);
    return { source: pin.revision, legacy: true };
  }
  const catalogs = readdirSync(join(root, "releases"), {
    withFileTypes: true,
  }).filter(
    (entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name),
  );
  assert.equal(
    catalogs.length,
    0,
    "Legacy history needs a verified published source checkpoint",
  );
  const roots = git(root, ["rev-list", "--max-parents=0", source]).split("\n");
  assert.equal(roots.length, 1, "Ambiguous initial release history");
  return { source: roots[0], legacy: true };
}

export async function resolveRelease(_root, { repository, releaseId }) {
  const { readOnlyGitHubAdapter } =
    await import("../infrastructure/releases/github.mjs");
  const { inspectGitHubRelease } = await import("./github-release.mjs");
  const github = readOnlyGitHubAdapter();
  const release = await github.getRelease(repository, Number(releaseId));
  const matches = [
    ...(release.body ?? "").matchAll(
      /<!-- situate-release:([A-Za-z0-9+/=]+) -->/g,
    ),
  ];
  assert.equal(matches.length, 1, "Release has no unique sealed identity");
  const marker = JSON.parse(
    Buffer.from(matches[0][1], "base64").toString("utf8"),
  );
  const identity = {
    ...marker.identity,
    repository,
    releaseId: Number(releaseId),
  };
  await inspectGitHubRelease(
    { identity, evidenceSha256: marker.evidenceSha256 },
    { github },
  );
  return { identity, evidenceSha256: marker.evidenceSha256 };
}

export async function inspectCandidateReservation(request, adapter) {
  const { validateReservation } = await import("./release-reservation.mjs");
  return adapter.withAllocatorLock(async (lease) => {
    const pending = await lease.pending();
    const inventory = await adapter.readInventory(lease);
    assert(
      inventory.complete === true && Array.isArray(inventory.tags),
      "Reservation inventory is incomplete",
    );
    const candidates = inventory.tags
      .filter((tag) => tag.reservation?.operationId === request.operationId)
      .map((tag) => tag.reservation);
    assert(
      candidates.length <= 1,
      "Multiple reservations belong to this operation",
    );
    const ownPending =
      pending?.operationId === request.operationId ? pending : undefined;
    const reservation = ownPending ?? candidates[0];
    if (!reservation) return { status: "absent", reservation: null };
    validateReservation(reservation);
    for (const key of ["operationId", "sourceRevision", "fragmentDigest"])
      assert.equal(
        reservation[key],
        request[key],
        "Durable reservation belongs to different workflow inputs",
      );
    if (ownPending && candidates[0])
      assert.deepEqual(
        ownPending,
        candidates[0],
        "Pending and tagged reservation bindings differ",
      );
    return { status: ownPending ? "unresolved" : "reserved", reservation };
  });
}

export function notesForCatalog(catalog) {
  const current = catalog.releases.find(
    (entry) => entry.version === catalog.installedVersion,
  );
  assert(current, "Catalog is missing the candidate release");
  return Object.entries(current.locales)
    .filter(([, text]) => text.entries.length > 0)
    .map(([locale, text]) =>
      [
        `## ${locale}`,
        text.title,
        ...text.entries.flatMap((entry) => [
          `### ${entry.title}`,
          ...entry.paragraphs,
        ]),
      ].join("\n\n"),
    )
    .join("\n\n");
}

async function verifiedBuilds(
  root,
  plan,
  { hostSnapshot: history },
  environment,
) {
  const { readGitHubMigrationHistory } = await import("./github-release.mjs");
  assert(
    history.complete === true && Array.isArray(history.builds),
    "Controlled host build inventory is unavailable",
  );
  const published = await readGitHubMigrationHistory(root, {
    repository: plan.repository,
    includeBuilds: true,
    environment,
  });
  return { complete: true, builds: [...history.builds, ...published.builds] };
}

function publisherArguments(action, plan, config, directory, stage) {
  return [
    action,
    "--release",
    directory,
    "--reviewed-revision",
    plan.source,
    "--destination",
    plan.destination,
    "--release-receipt",
    join(directory, "github-release-receipt.json"),
    ...(config.sshIdentity ? ["--ssh-identity", config.sshIdentity] : []),
    ...(config.sshKnownHosts
      ? ["--ssh-known-hosts", config.sshKnownHosts]
      : []),
    ...(config.updaterPublicKey
      ? ["--updater-public-key", config.updaterPublicKey]
      : []),
    ...(config.recoveryEvidence
      ? ["--recovery-evidence", config.recoveryEvidence]
      : []),
    ...(stage ? ["--stage", stage] : []),
  ];
}
export function publicationEnvironment(environment) {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "LANG",
      "CI",
      "VOLTA_HOME",
      "SSH_AUTH_SOCK",
      "SITUATE_UPDATER_PUBLIC_KEY",
      "APPLE_TEAM_ID",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GH_CONFIG_DIR",
    ]
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
}
function publish(root, args, environment = process.env) {
  const env = publicationEnvironment(environment);
  return execFileSync(
    process.execPath,
    [join(root, "infrastructure/releases/publish.mjs"), ...args],
    {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export async function productionStages(
  root,
  plan,
  { environment = process.env } = {},
) {
  const configRecord = readConfiguration(root, plan.configurationFile, {
    environment,
  });
  assert(
    configRecord && configRecord.sha256 === plan.configurationDigest,
    "Blocked: plan with a private, reviewed release configuration before execution",
  );
  const config = {
    ...configRecord.configuration,
    sshIdentity:
      configRecord.configuration.sshIdentity ??
      environment.WEBSITE_SSH_IDENTITY,
    sshKnownHosts:
      configRecord.configuration.sshKnownHosts ??
      environment.WEBSITE_SSH_KNOWN_HOSTS,
  };
  assert(
    config.recoveryEvidence,
    "Blocked: independent backup and signing/access recovery evidence is required",
  );
  const { assertRecoveryReady } =
    await import("../infrastructure/releases/recovery.mjs");
  const recoveryEvidence =
    typeof config.recoveryEvidence === "string"
      ? json(config.recoveryEvidence)
      : config.recoveryEvidence;
  assertRecoveryReady(recoveryEvidence, { host: plan.destination });
  if (typeof config.recoveryEvidence !== "string") {
    const { atomicJson } = await import("./pipeline-state.mjs");
    const evidenceFile = join(
      operationDirectory(root, plan.operation),
      "recovery-evidence.json",
    );
    atomicJson(evidenceFile, recoveryEvidence);
    config.recoveryEvidence = evidenceFile;
  }
  const host = hostFields(plan, config);
  const { createHostAllocatorLock, createBuilderNotaryJournal } =
    await import("../infrastructure/releases/allocator.mjs");
  const hostLock = createHostAllocatorLock(host, { environment });
  const notaryJournal = createBuilderNotaryJournal(host, {
    operationId: plan.operation,
    withAllocatorLock: hostLock,
  });
  const outputRoot =
    config.artifactRoot ?? join(tmpdir(), "situate-release-artifacts");
  const directory = join(resolve(outputRoot), plan.operation);
  const stageDirectory = `${directory}-publication`;
  const preparedInputs = async (operation, identity) => {
    const { assembleReleaseInputs, verifyReleaseInputs } =
      await import("./release-inputs.mjs");
    const retainedManifest = join(`${directory}-inputs`, "release-inputs.json");
    const retainedCatalog = join(
      `${directory}-inputs`,
      "situate-release-history.json",
    );
    if (existsSync(retainedManifest)) {
      const bytes = readFileSync(retainedManifest, "utf8");
      const manifest = JSON.parse(bytes);
      const catalogBytes = readFileSync(retainedCatalog, "utf8");
      const catalog = verifyReleaseInputs(manifest, catalogBytes);
      assert(
        manifest.source === plan.source &&
          manifest.version === identity.version &&
          manifest.build === identity.buildNumber &&
          manifest.tag === identity.tag,
        "Retained inputs belong to another candidate",
      );
      if (identity.generatedInputDigest)
        assert.equal(
          digest(bytes),
          identity.generatedInputDigest,
          "Retained inputs differ from the reserved identity",
        );
      return {
        manifest,
        catalog,
        catalogBytes,
        fragmentDigest: manifest.fragmentDigest,
      };
    }
    let completed;
    if (!plan.baseline.legacy) {
      const { readCompletedReleaseBaseline } =
        await import("./github-release.mjs");
      completed = await readCompletedReleaseBaseline(root, {
        repository: plan.repository,
        revision: plan.source,
        environment,
      });
      assert(
        completed &&
          completed.source === plan.baseline.source &&
          completed.catalogSha256 === plan.baseline.catalogSha256,
        "Completed catalog inputs changed",
      );
      completed.catalogBytes = Buffer.isBuffer(completed.catalogBytes)
        ? completed.catalogBytes.toString("utf8")
        : completed.catalogBytes;
    }
    return assembleReleaseInputs(root, {
      source: plan.source,
      baseline: plan.baseline.source,
      version: identity.version,
      build: identity.buildNumber,
      tag: identity.tag,
      ...(completed ? { previous: completed } : {}),
    });
  };
  const identity = (operation) => {
    const reservation =
      operation.reservation ?? previous(operation, "reserve").reservation;
    return {
      repository: plan.repository,
      tag: reservation.tag,
      sourceRevision: plan.source,
      version: reservation.version,
      operationId: plan.operation,
      inputSha256: reservation.generatedInputDigest,
    };
  };
  const coordinator = async () => {
    const { createHostReleaseCoordinator } =
      await import("../infrastructure/releases/allocator.mjs");
    assert.equal(
      typeof createHostReleaseCoordinator,
      "function",
      "Blocked: controlled-host release coordination is unavailable",
    );
    return createHostReleaseCoordinator(host, {
      operationId: plan.operation,
      planDigest: plan.authorizationDigest,
      sourceRevision: plan.source,
      withAllocatorLock: hostLock,
    });
  };
  const { createGitReservationAdapter } =
    await import("./release-reservation.mjs");
  const allocator = createGitReservationAdapter({
    root,
    hostConfig: host,
    withAllocatorLock: hostLock,
    environment: publicationEnvironment(environment),
    readVerifiedBuilds: (snapshot) =>
      verifiedBuilds(root, plan, snapshot, environment),
  });
  const stages = {
    compatibility: async ({ operation, resume = false }) => {
      const claim = await coordinator();
      if (resume) await claim.inspect();
      await claim.claim({ resume });
      const fresh = await readBaseline(root, {
        repository: plan.repository,
        source: plan.source,
        environment,
      });
      assert.equal(
        digest(fresh),
        digest(plan.baseline),
        "Completed release history changed; inspect and plan a successor",
      );
      const { qualifyPublicCompatibilityMigrations } =
        await import("./published-migrations.mjs");
      const { readPublicationHistory } =
        await import("../infrastructure/releases/transport.mjs");
      const result = await qualifyPublicCompatibilityMigrations(root, {
        revision: plan.source,
        history: readPublicationHistory(root, {
          environment,
          destination: {
            host: plan.destination,
            sshIdentity: config.sshIdentity,
            sshKnownHosts: config.sshKnownHosts,
          },
        }),
      });
      operation.compatibility = result;
      saveOperation(root, operation);
      return result;
    },
    reserve: async ({ operation }) => {
      const { collectFragments } = await import("./change-fragments.mjs");
      const fragments = collectFragments(root, {
        base: plan.baseline.source,
        head: plan.source,
      }).map(({ id, path, sha256 }) => ({ id, path, sha256 }));
      const { reserveRelease } = await import("./release-reservation.mjs");
      const result = await reserveRelease(
        {
          operationId: plan.operation,
          sourceRevision: plan.source,
          fragmentDigest: digest(canonical(fragments)),
          prepareInputs: async (reserved) => {
            const inputs = await preparedInputs(operation, reserved);
            const { writeReleaseInputs } = await import("./release-inputs.mjs");
            writeReleaseInputs(`${directory}-inputs`, inputs, {
              repoRoot: root,
            });
            return {
              generatedInputDigest: digest(`${canonical(inputs.manifest)}\n`),
              fragmentDigest: inputs.fragmentDigest,
            };
          },
        },
        allocator,
      );
      operation.reservation = result.reservation;
      saveOperation(root, operation);
      assert.equal(
        result.status,
        "reserved",
        "Reservation outcome is unknown; inspect before reconciliation",
      );
      return result;
    },
    inputs: async ({ operation }) => {
      const inputs = await preparedInputs(operation, operation.reservation);
      assert.equal(
        digest(`${canonical(inputs.manifest)}\n`),
        operation.reservation.generatedInputDigest,
        "Generated inputs differ from the reserved identity",
      );
      const { writeReleaseInputs } = await import("./release-inputs.mjs");
      return writeReleaseInputs(`${directory}-inputs`, inputs, {
        repoRoot: root,
      });
    },
    build: async ({ operation, signal }) => {
      const { buildAppleRelease, loadAppleSettings } =
        await import("../client/scripts/apple-release.mjs");
      const inputs = await preparedInputs(operation, operation.reservation);
      const { qualifyPublishedMigrations } =
        await import("./published-migrations.mjs");
      const { readPublicationHistory } =
        await import("../infrastructure/releases/transport.mjs");
      const built = await buildAppleRelease({
        root: join(root, "client"),
        settings: loadAppleSettings(
          join(root, "client"),
          undefined,
          environment,
        ),
        environment,
        platform: "macos",
        macosArch: "universal",
        distribution: "direct",
        buildNumber: operation.reservation.buildNumber,
        expectedVersion: operation.reservation.version,
        releaseInputs: inputs,
        sourceVerification: operation.verification,
        publicCompatibility: {
          schemaVersion: 1,
          source: plan.source,
          qualification: operation.compatibility,
        },
        qualifyMigrations: (repositoryRoot, { revision }) => {
          assert.equal(
            revision,
            plan.source,
            "Builder comparison source differs",
          );
          return qualifyPublishedMigrations(repositoryRoot, {
            revision,
            history: readPublicationHistory(root, {
              environment,
              destination: {
                host: plan.destination,
                sshIdentity: config.sshIdentity,
                sshKnownHosts: config.sshKnownHosts,
              },
            }),
          });
        },
        notaryJournal,
        signal,
      });
      assert(typeof built === "string", "Builder returned no final artifacts");
      return {
        directory: built,
        manifestSha256: digest(readFileSync(join(built, "manifest.json"))),
      };
    },
    qualify: async ({ operation, signal }) => {
      const built = previous(operation, "build");
      const { createFinalArtifactQualificationHost } =
        await import("../client/scripts/final-artifact-qualification.mjs");
      const qualificationHost = createFinalArtifactQualificationHost(
        config.qualification,
      );
      const { writeQualificationReceipt } =
        await import("./release-qualification.mjs");
      return writeQualificationReceipt({
        directory: built.directory,
        qualificationHost,
        signal,
      });
    },
    github: async ({ operation, reconcile = false }) => {
      const built = previous(operation, "build");
      previous(operation, "qualify");
      const inputs = await preparedInputs(operation, operation.reservation);
      const notes = notesForCatalog(inputs.catalog);
      const { createEvidenceFromDirectory, createGitHubRelease } =
        await import("./github-release.mjs");
      const request = {
        identity: identity(operation),
        directory: built.directory,
        notes,
      };
      const result = await createGitHubRelease(
        {
          ...createEvidenceFromDirectory(request),
          identity: request.identity,
          notes,
          journalPath: join(
            operationDirectory(root, plan.operation),
            "github-journal.json",
          ),
        },
        {
          github: githubAdapter({ environment }),
          authorize: async (expected) =>
            assert.deepEqual(expected.identity, request.identity),
          reconcile,
        },
      );
      await (await coordinator()).complete();
      return {
        identity: result.identity,
        releaseId: result.release?.id,
        evidenceSha256: result.evidenceSha256,
      };
    },
    download: async () => {
      const { downloadGitHubRelease } = await import("./github-release.mjs");
      const result = await downloadGitHubRelease(
        {
          ...plan.release,
          destination: directory,
        },
        { github: readOnlyGitHubAdapter({ environment }) },
      );
      return { directory, receipt: result.receipt, identity: result.identity };
    },
    verify: async ({ operation }) => {
      const downloaded = previous(operation, "download");
      publish(
        root,
        publisherArguments("check", plan, config, downloaded.directory),
        environment,
      );
      return {
        directory: downloaded.directory,
        receiptSha256: digest(
          readFileSync(
            join(downloaded.directory, "github-release-receipt.json"),
          ),
        ),
      };
    },
    promote: async ({ operation }) => {
      const downloaded = previous(operation, "verify");
      const args = publisherArguments(
        "publish",
        plan,
        config,
        downloaded.directory,
        stageDirectory,
      );
      const output = publish(
        root,
        [
          ...args,
          "--confirm",
          `${plan.destination}:${plan.release.identity.version}`,
        ],
        environment,
      );
      return { releaseId: plan.releaseId, outputSha256: digest(output) };
    },
    inspect: async ({ operation }) => {
      if (plan.workflow === "publish") {
        const downloaded = operation.stages.find(
          (entry) => entry.name === "download" && entry.status === "passed",
        )?.output;
        if (
          !downloaded ||
          !existsSync(join(downloaded.directory, "publication-journal.json"))
        )
          return { state: "no-host-request", release: plan.release };
        return {
          state: "observed",
          host: JSON.parse(
            publish(
              root,
              publisherArguments("inspect", plan, config, downloaded.directory),
              environment,
            ),
          ),
        };
      }
      const { collectFragments } = await import("./change-fragments.mjs");
      const fragmentDigest = digest(
        canonical(
          collectFragments(root, {
            base: plan.baseline.source,
            head: plan.source,
          }).map(({ id, path, sha256 }) => ({ id, path, sha256 })),
        ),
      );
      const reservation = await inspectCandidateReservation(
        {
          operationId: plan.operation,
          sourceRevision: plan.source,
          fragmentDigest,
        },
        allocator,
      );
      let githubRelease = null;
      const githubJournal = join(
        operationDirectory(root, plan.operation),
        "github-journal.json",
      );
      if (existsSync(githubJournal)) {
        const record = json(githubJournal);
        const { inspectGitHubOperation, createEvidenceFromDirectory } =
          await import("./github-release.mjs");
        const built = previous(operation, "build");
        const inputs = await preparedInputs(operation, operation.reservation);
        const { evidence } = createEvidenceFromDirectory({
          identity: record.identity,
          directory: built.directory,
          notes: notesForCatalog(inputs.catalog),
        });
        githubRelease = await inspectGitHubOperation(
          {
            identity: {
              ...record.identity,
              ...(record.releaseId ? { releaseId: record.releaseId } : {}),
            },
            evidence,
            evidenceSha256: record.evidenceSha256,
          },
          { github: readOnlyGitHubAdapter({ environment }) },
        );
      }
      return {
        githubRelease,
        coordination: await (await coordinator()).inspect(),
        reservation,
        notarization: await notaryJournal.inspect(),
      };
    },
    reconcile: async ({ operation, observation, resolution = "resume" }) => {
      if (plan.workflow === "publish") {
        const downloaded = previous(operation, "download");
        const args = publisherArguments(
          "reconcile",
          plan,
          config,
          downloaded.directory,
          stageDirectory,
        );
        publish(
          root,
          [
            ...args,
            "--confirm",
            `${plan.destination}:${plan.release.identity.version}`,
          ],
          environment,
        );
        const last = operation.stages.at(-1);
        assert.equal(
          last.name,
          "promote",
          "Only the inspected publication can be reconciled",
        );
        last.output = { releaseId: plan.releaseId, reconciled: true };
        last.status = "passed";
        return;
      }
      const last = operation.stages.at(-1);
      assert(last, "Operation has no interrupted stage");
      if (resolution === "abandon") {
        assert(
          ["compatibility", "reserve"].includes(last.name) &&
            observation.remote.reservation?.status === "absent" &&
            !operation.reservation,
          "Only an authoritatively unreserved candidate can be abandoned",
        );
        await (await coordinator()).complete();
        operation.status = "abandoned";
        return;
      }
      if (last.name === "compatibility") {
        last.output = await stages.compatibility({ operation, resume: true });
        last.status = "passed";
        return;
      }
      if (
        last.name === "reserve" &&
        !operation.reservation &&
        observation.remote.reservation?.reservation
      ) {
        operation.reservation = observation.remote.reservation.reservation;
        const inputs = await preparedInputs(operation, operation.reservation);
        assert.equal(
          digest(`${canonical(inputs.manifest)}\n`),
          operation.reservation.generatedInputDigest,
          "Recovered reservation input bytes differ",
        );
        saveOperation(root, operation);
      }
      if (last.name === "reserve" && operation.reservation) {
        const { reconcileReservation } =
          await import("./release-reservation.mjs");
        const result = await reconcileReservation(
          operation.reservation,
          allocator,
        );
        assert.equal(
          result.status,
          "reserved",
          "Reservation remains unresolved; no tag was repeated",
        );
        last.output = result;
        last.status = "passed";
        return;
      }
      if (last.name === "github") {
        last.output = await stages.github({ operation, reconcile: true });
        last.status = "passed";
        return;
      }
      if (
        ["inputs", "qualify"].includes(last.name) &&
        last.status === "failed"
      ) {
        operation.stages.pop();
        return;
      }
      throw new Error(
        "The retained Apple or release operation remains unresolved; no submission, tag or package was repeated",
      );
    },
  };
  return stages;
}
