import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updaterSignatureFixture } from "./updater-signing-fixture.mjs";
import {
  updaterSigningConfiguration,
  verifyUpdaterSignature,
  updaterEndpoint,
} from "./updater-signing.mjs";

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-updater-signature-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("verifies both minisign signatures and rejects bytes, version, key and trusted-comment tampering", (t) => {
  const path = join(temporary(t), "archive");
  const bytes = Buffer.from("synthetic payload");
  writeFileSync(path, bytes);
  const signed = updaterSignatureFixture(bytes);
  verifyUpdaterSignature(path, signed.signature, signed.publicKey, "1.2.3");
  assert.throws(
    () =>
      verifyUpdaterSignature(path, signed.signature, signed.publicKey, "1.2.4"),
    /version/,
  );
  const tampered = Buffer.from(
    Buffer.from(signed.signature, "base64")
      .toString()
      .replace("version:1.2.3", "version:1.2.4"),
  ).toString("base64");
  assert.throws(
    () => verifyUpdaterSignature(path, tampered, signed.publicKey, "1.2.4"),
    /verification failed/,
  );
  assert.throws(
    () =>
      verifyUpdaterSignature(
        path,
        signed.signature,
        updaterSignatureFixture(bytes).publicKey,
        "1.2.3",
      ),
    /verification failed/,
  );
  writeFileSync(path, "changed bytes");
  assert.throws(
    () =>
      verifyUpdaterSignature(path, signed.signature, signed.publicKey, "1.2.3"),
    /verification failed/,
  );
});

test("direct signing config parses only required root dotenv data and separates secrets from embedded config", (t) => {
  const directory = temporary(t);
  writeFileSync(
    join(directory, ".env"),
    'SITUATE_UPDATER_PUBLIC_KEY="public"\nTAURI_SIGNING_PRIVATE_KEY="private\nmultiline"\nTAURI_SIGNING_PRIVATE_KEY_PASSWORD="password"\nOTHER_SECRET=ignored\n',
    { mode: 0o600 },
  );
  const result = updaterSigningConfiguration(join(directory, "client"), {});
  assert.deepEqual(result.public, {
    distribution: "direct",
    publicKey: "public",
    endpoint: updaterEndpoint,
  });
  assert.deepEqual(result.signer, {
    TAURI_SIGNING_PRIVATE_KEY: "private\nmultiline",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "password",
  });
  assert.throws(
    () =>
      updaterSigningConfiguration(join(directory, "client"), {
        TAURI_SIGNING_PRIVATE_KEY: "",
      }),
    /require/,
  );
  assert.throws(
    () =>
      updaterSigningConfiguration(join(directory, "client"), { CI: "true" }),
    /require/,
  );
  for (const endpoint of [
    "http://getsituate.com/feed",
    "https://user@getsituate.com/feed",
    "https://getsituate.com/feed?secret=a",
  ])
    assert.throws(
      () =>
        updaterSigningConfiguration(join(directory, "client"), {
          SITUATE_UPDATER_ENDPOINT: endpoint,
        }),
      /HTTPS/,
    );
});
