import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProvisioningProfile } from "./apple-release.mjs";

function temporaryProfile(t, contents) {
  const root = mkdtempSync(join(tmpdir(), "situate-profile-parser-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "profile.plist");
  writeFileSync(path, contents);
  return path;
}

test("reads profile dates and certificate data without exposing certificate contents", async (t) => {
  const path = temporaryProfile(
    t,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date>
<key>DeveloperCertificates</key><array><data></data></array>
<key>TeamIdentifier</key><array><string>TEAM123456</string></array>
<key>ApplicationIdentifierPrefix</key><array><string>LEGACY1234</string></array>
<key>Entitlements</key><dict>
<key>application-identifier</key><string>LEGACY1234.dev.example.app</string>
<key>get-task-allow</key><false/>
</dict></dict></plist>`,
  );
  assert.deepEqual(await readProvisioningProfile(path), {
    ExpirationDate: "2099-01-01T00:00:00Z",
    TeamIdentifier: ["TEAM123456"],
    ApplicationIdentifierPrefix: ["LEGACY1234"],
    CertificateSha256: [
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    Entitlements: {
      "application-identifier": "LEGACY1234.dev.example.app",
      "get-task-allow": false,
    },
    ProvisionedDevices: false,
    ProvisionsAllDevices: false,
  });
});

test("malformed profiles fail instead of returning permissive defaults", async (t) => {
  await assert.rejects(
    readProvisioningProfile(temporaryProfile(t, "invalid plist")),
    /python3 failed/,
  );
});
