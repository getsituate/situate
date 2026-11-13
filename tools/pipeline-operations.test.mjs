import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      PIPELINE_CONFIGURATION_JSON: "synthetic-private-configuration",
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
