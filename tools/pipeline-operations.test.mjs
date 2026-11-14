import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  notesForCatalog,
  readConfiguration,
  inspectCandidateReservation,
  publicationEnvironment,
} from "./pipeline-operations.mjs";
import { digest } from "./pipeline-state.mjs";

test("publication forwards public verification identity and GitHub reads but no signing or provider keys", () => {
  const allowed = {
    PATH: "/synthetic/bin",
    APPLE_TEAM_ID: "TEAM123456",
    SITUATE_UPDATER_PUBLIC_KEY: "synthetic-public-key",
    GH_TOKEN: "synthetic-read-token",
    GH_CONFIG_DIR: "/synthetic/gh",
  };
  assert.deepEqual(
    publicationEnvironment({
      ...allowed,
      APPLE_API_PRIVATE_KEY: "synthetic-private-key",
      APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
      TAURI_SIGNING_PRIVATE_KEY: "synthetic-signing-key",
      OPENAI_API_KEY: "synthetic-provider-key",
      SITUATE_RELEASE_CONFIG_JSON: "synthetic-private-configuration",
    }),
    allowed,
  );
});

test("public notes use only the installed catalog entries and every catalog locale", () => {
  const notes = notesForCatalog({
    installedVersion: "2026.11.1",
    releases: [
      {
        version: "2026.11.1",
        locales: {
          en: {
            title: "Changes",
            entries: [{ title: "Search", paragraphs: ["Synthetic text."] }],
          },
          de: {
            title: "Änderungen",
            entries: [{ title: "Suche", paragraphs: ["Synthetischer Text."] }],
          },
          fr: {
            title: "Changements",
            entries: [
              { title: "Recherche", paragraphs: ["Texte synthétique."] },
            ],
          },
        },
      },
      {
        version: "2026.10.1",
        locales: { en: { title: "Older entry", entries: [] } },
      },
    ],
    emptyReason: "Internal synthetic reason",
  });
  assert.match(notes, /## en/);
  assert.match(notes, /## de/);
  assert.match(notes, /## fr/);
  assert.match(notes, /Texte synthétique\./);
  assert.doesNotMatch(notes, /Older entry|Internal synthetic reason/);
  assert.equal(
    notesForCatalog({
      installedVersion: "2026.11.1",
      releases: [
        {
          version: "2026.11.1",
          locales: {
            en: { title: "Changes", entries: [] },
            de: { title: "Änderungen", entries: [] },
          },
        },
      ],
    }),
    "",
  );
});

test("reservation inspection reconstructs interrupted identity from durable intent or tags", async () => {
  const reservation = {
    schemaVersion: 1,
    kind: "situate-release-reservation",
    operationId: "candidate-1",
    sourceRevision: "a".repeat(40),
    fragmentDigest: "b".repeat(64),
    generatedInputDigest: "c".repeat(64),
    version: "2026.11.1",
    tag: "v2026.11.1",
    buildSequence: 10000,
    buildNumber: "1.0.0",
  };
  const request = {
    operationId: reservation.operationId,
    sourceRevision: reservation.sourceRevision,
    fragmentDigest: reservation.fragmentDigest,
  };
  const adapter = (pending, tags = []) => ({
    withAllocatorLock: (action) => action({ pending: async () => pending }),
    readInventory: async () => ({ complete: true, tags }),
  });
  assert.deepEqual(await inspectCandidateReservation(request, adapter(null)), {
    status: "absent",
    reservation: null,
  });
  assert.deepEqual(
    await inspectCandidateReservation(request, adapter(reservation)),
    { status: "unresolved", reservation },
  );
  assert.deepEqual(
    await inspectCandidateReservation(
      request,
      adapter(null, [{ reservation }]),
    ),
    { status: "reserved", reservation },
  );
  await assert.rejects(
    inspectCandidateReservation(
      request,
      adapter({ ...reservation, sourceRevision: "d".repeat(40) }),
    ),
    /different workflow inputs/,
  );
  await assert.rejects(
    inspectCandidateReservation(
      request,
      adapter(null, [{ reservation }, { reservation }]),
    ),
    /Multiple reservations/,
  );
});

test("inline release configuration uses identical dotenv and hosted environment bytes without materializing files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-config-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes =
    '{"schemaVersion":1,"recoveryEvidence":{"synthetic":"$(not-a-command)"}}\n';
  writeFileSync(
    join(root, ".env"),
    `SITUATE_RELEASE_CONFIG_JSON='${bytes}'\nUNRELATED_SECRET=private-sentinel\n`,
    { mode: 0o600 },
  );
  const local = readConfiguration(root, undefined, { environment: {} });
  const hosted = readConfiguration(root, undefined, {
    environment: { CI: "true", SITUATE_RELEASE_CONFIG_JSON: bytes },
  });
  const expected = {
    sha256: digest(bytes),
    configuration: {
      schemaVersion: 1,
      recoveryEvidence: { synthetic: "$(not-a-command)" },
    },
  };
  assert.deepEqual(local, expected);
  assert.deepEqual(hosted, expected);
  assert.equal(existsSync(join(root, ".release-operations")), false);
  assert.equal(JSON.stringify(local).includes("private-sentinel"), false);
  assert.notEqual(
    readConfiguration(root, undefined, {
      environment: { SITUATE_RELEASE_CONFIG_JSON: bytes.trim() },
    }).sha256,
    local.sha256,
  );
});

test("configuration precedence preserves explicit empty values and rejects ambiguous or secret-bearing invalid JSON", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-config-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "config.json");
  const bytes = '{"schemaVersion":1,"recoveryEvidence":{"synthetic":true}}';
  writeFileSync(file, bytes, { mode: 0o600 });
  writeFileSync(join(root, ".env"), `SITUATE_RELEASE_CONFIG_FILE=${file}\n`, {
    mode: 0o600,
  });
  assert.equal(
    readConfiguration(root, undefined, { environment: {} }).file,
    file,
  );
  assert.equal(
    readConfiguration(root, undefined, {
      environment: { SITUATE_RELEASE_CONFIG_JSON: bytes },
    }).sha256,
    digest(bytes),
  );
  assert.equal(
    readConfiguration(root, file, {
      environment: { SITUATE_RELEASE_CONFIG_JSON: "invalid" },
    }).file,
    file,
  );
  assert.throws(
    () =>
      readConfiguration(root, undefined, {
        environment: { SITUATE_RELEASE_CONFIG_JSON: "" },
      }),
    /must contain a release configuration/,
  );
  assert.equal(
    readConfiguration(root, undefined, {
      environment: { SITUATE_RELEASE_CONFIG_FILE: "" },
    }),
    null,
  );
  assert.equal(
    readConfiguration(root, undefined, { environment: { CI: "true" } }),
    null,
  );
  assert.throws(
    () =>
      readConfiguration(root, undefined, {
        environment: {
          SITUATE_RELEASE_CONFIG_JSON: bytes,
          SITUATE_RELEASE_CONFIG_FILE: file,
        },
      }),
    /not both/,
  );
  assert.throws(
    () =>
      readConfiguration(root, undefined, {
        environment: {
          SITUATE_RELEASE_CONFIG_JSON: '{"PRIVATE_SENTINEL":invalid}',
        },
      }),
    (error) => {
      assert.equal(
        error.message,
        "Release configuration must contain valid JSON",
      );
      assert.equal(error.message.includes("PRIVATE_SENTINEL"), false);
      return true;
    },
  );
});

test("release configuration is explicit private data bound to exact bytes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "config.json");
  assert.equal(readConfiguration(root, file), null);
  const bytes = '{"schemaVersion":1,"recoveryEvidence":{"schemaVersion":1}}\n';
  writeFileSync(file, bytes, { mode: 0o600 });
  assert.equal(readConfiguration(root, file).sha256, digest(bytes));
  chmodSync(file, 0o644);
  assert.throws(() => readConfiguration(root, file), /private regular file/);
  chmodSync(file, 0o600);
  writeFileSync(file, '{"schemaVersion":99}\n');
  assert.throws(() => readConfiguration(root, file), /Unsupported/);
});
