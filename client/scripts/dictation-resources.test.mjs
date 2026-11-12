import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { assertNoDictationTtsResources } from "./dictation-resources.mjs";

async function fixture(t, mobile = false) {
  const root = await mkdtemp(join(tmpdir(), "situate-dictation-resources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "Situate.app");
  const content = mobile ? app : join(app, "Contents");
  await mkdir(content, { recursive: true });
  await writeFile(join(content, "Info.plist"), "<plist/>");
  return { root, app, content };
}

async function put(path) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "synthetic resource");
}

for (const mobile of [false, true]) {
  test(`accepts ${mobile ? "iOS" : "macOS"} app resources without TTS content`, async (t) => {
    const { app, content } = await fixture(t, mobile);
    await put(join(content, "Resources/dictation/THIRD-PARTY-NOTICES.txt"));
    await put(join(content, "Resources/dictation/loader.pl"));
    await put(join(content, "Resources/en.lproj/InfoPlist.strings"));
    await assertNoDictationTtsResources(app);
  });
}

for (const resource of [
  "Resources/FluidAudio_FluidAudio.bundle/Contents/Resources/luxtts_en_us_lexicon.tsv.zz",
  "Resources/luxtts_en_us_g2p_aux.json",
  "Resources/luxtts_en_us_lexicon.tsv.zz",
  "Frameworks/helper.framework/Resources/LuxTts/lexicon.bin",
  "Resources/G2p/aux.json",
  "Resources/g2p_aux.json",
  "Resources/FluidAudio_FluidAudio.bundle/unknown-new-resource.bin",
]) {
  test(`rejects unqualified packaged resource ${resource}`, async (t) => {
    const { app, content } = await fixture(t);
    await put(join(content, resource));
    await assert.rejects(
      assertNoDictationTtsResources(app),
      /Unqualified dictation resource:/,
    );
  });
}

test("rejects even an empty FluidAudio bundle", async (t) => {
  const { app, content } = await fixture(t);
  await mkdir(join(content, "FluidAudio_FluidAudio.bundle"));
  await assert.rejects(
    assertNoDictationTtsResources(app),
    /Unqualified dictation resource:/,
  );
});

test("inspects internal framework symlinks without looping", async (t) => {
  const { app, content } = await fixture(t);
  const framework = join(content, "Frameworks/helper.framework");
  await put(join(framework, "Versions/A/helper"));
  await symlink("A", join(framework, "Versions/Current"));
  await symlink("Versions/Current/helper", join(framework, "helper"));
  await symlink(".", join(framework, "cycle"));
  await assertNoDictationTtsResources(app);
  await symlink("Versions/Current/helper", join(framework, "luxtts_alias"));
  await assert.rejects(
    assertNoDictationTtsResources(app),
    /Unqualified dictation resource:/,
  );
});

test("fails closed for external and broken resource symlinks", async (t) => {
  const { root, app, content } = await fixture(t);
  await put(join(root, "outside/resource.bin"));
  const link = join(content, "linked-resource");
  await symlink(join(root, "outside"), link);
  await assert.rejects(
    assertNoDictationTtsResources(app),
    /App resource escapes package:/,
  );
  await rm(link);
  await symlink("missing", link);
  await assert.rejects(assertNoDictationTtsResources(app), { code: "ENOENT" });
});

test("missing app, non-app directory, and missing Info.plist are not clean packages", async (t) => {
  const { root, app, content } = await fixture(t);
  await assert.rejects(
    assertNoDictationTtsResources(join(root, "Missing.app")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    assertNoDictationTtsResources(root),
    /requires an unpacked .app directory/,
  );
  await rm(join(content, "Info.plist"));
  await assert.rejects(assertNoDictationTtsResources(app), { code: "ENOENT" });
});
