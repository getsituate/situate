import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateMobilePermissions,
  generateMacPermissions,
  generateAndroidAuthResources,
} from "./generate-mobile-permissions.mjs";

test("macOS microphone permission uses both catalogs and preserves unrelated settings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-microphone-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "Info.macos.plist"),
    "<plist><dict><key>Existing</key><true/></dict></plist>",
  );
  for (const locale of ["en", "de"])
    await writeFile(
      join(root, `${locale}.native.json`),
      JSON.stringify({
        "native.dictation.permission.microphone": `${locale}: Speech & draft`,
      }),
    );
  await generateMacPermissions(root, root);
  await generateMacPermissions(root, root);
  const plist = await readFile(join(root, "Info.macos.plist"), "utf8");
  assert.match(plist, /<key>Existing<\/key><true\/>/);
  assert.match(plist, /en: Speech &amp; draft/);
  assert.equal(
    (plist.match(/<key>NSMicrophoneUsageDescription<\/key>/g) ?? []).length,
    1,
  );
  for (const locale of ["en", "de"])
    assert.equal(
      await readFile(
        join(root, "macos-permissions", `${locale}.lproj`, "InfoPlist.strings"),
        "utf8",
      ),
      `"NSMicrophoneUsageDescription" = "${locale}: Speech & draft";\n`,
    );
  await writeFile(join(root, "de.native.json"), "{}");
  await assert.rejects(
    generateMacPermissions(root, root),
    /Missing native permission translation/,
  );
});

test("native permission resources use catalogs and preserve unrelated plist settings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-permission-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalogs = join(root, "catalogs");
  await mkdir(catalogs);
  await writeFile(
    join(root, "Info.plist"),
    "<plist><dict><key>UIFileSharingEnabled</key><true/></dict></plist>",
  );
  for (const locale of ["en", "de"]) {
    await writeFile(
      join(catalogs, `${locale}.native.json`),
      JSON.stringify({
        "native.ai.permission.localNetwork": `${locale}: A & B "quoted"`,
      }),
    );
  }
  const generated = join(root, "generated.plist");
  await writeFile(
    generated,
    "<plist><dict><key>Nested</key><dict><key>Enabled</key><true/></dict></dict></plist>",
  );
  await generateMobilePermissions(root, catalogs, generated);
  await generateMobilePermissions(root, catalogs, generated);
  const generatedText = await readFile(generated, "utf8");
  assert.match(
    generatedText,
    /<true\/><\/dict>\s*<key>NSLocalNetworkUsageDescription<\/key>/,
  );
  const plist = await readFile(join(root, "Info.plist"), "utf8");
  assert.match(plist, /<key>UIFileSharingEnabled<\/key><true\/>/);
  assert.match(plist, /en: A &amp; B &quot;quoted&quot;/);
  assert.equal(
    plist.match(/<key>NSLocalNetworkUsageDescription<\/key>/g).length,
    1,
  );
  assert.doesNotMatch(plist, /NSAppTransportSecurity|NSAllowsArbitraryLoads/);
  for (const locale of ["en", "de"]) {
    assert.equal(
      await readFile(
        join(root, "ios-permissions", `${locale}.lproj`, "InfoPlist.strings"),
        "utf8",
      ),
      `"NSLocalNetworkUsageDescription" = "${locale}: A & B \\"quoted\\"";\n`,
    );
  }
});

test("Tauri includes permission translations as native bundle resources", async () => {
  const app = fileURLToPath(new URL("../app/", import.meta.url));
  const config = JSON.parse(
    await readFile(join(app, "src-tauri/tauri.ios.conf.json"), "utf8"),
  );
  const template = await readFile(
    resolve(app, config.bundle.iOS.template),
    "utf8",
  );
  assert.match(
    template,
    /path: \.\.\/\.\.\/ios-permissions\r?\n\s+buildPhase: resources/,
  );
  assert.match(template, /generate-mobile-permissions\.mjs.*--plist/);
  assert.match(
    config.build.beforeBuildCommand,
    /generate-mobile-permissions\.mjs/,
  );
  assert.equal(config.bundle.resources, undefined);
});

test("Android sign-in notification resources use catalogs and escape Android strings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-notification-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const locale of ["en", "de"]) {
    const entries = Object.fromEntries(
      ["channel", "title", "body", "cancel"].map((name) => [
        `native.ai.authForeground.${name}`,
        `${locale} & it's private`,
      ]),
    );
    await writeFile(
      join(root, `${locale}.native.json`),
      JSON.stringify(entries),
    );
  }
  await generateAndroidAuthResources(join(root, "res"), root);
  for (const locale of ["en", "de"]) {
    const content = await readFile(
      join(
        root,
        "res",
        locale === "en" ? "values" : "values-de",
        "provider-auth.xml",
      ),
      "utf8",
    );
    assert.ok(content.includes(`${locale} &amp; it\\&apos;s private`));
    assert.equal((content.match(/<string /g) ?? []).length, 4);
  }
  await writeFile(join(root, "de.native.json"), "{}");
  await assert.rejects(
    generateAndroidAuthResources(join(root, "res"), root),
    /Missing native notification translation/,
  );
});

test("missing permission copy fails rather than emitting a localization key", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-permission-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "en.native.json"), "{}");
  await assert.rejects(
    generateMobilePermissions(root, root),
    /Missing native permission translation/,
  );
});
