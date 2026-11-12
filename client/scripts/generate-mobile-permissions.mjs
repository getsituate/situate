import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const native = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../app/src-tauri",
);
const key = "native.ai.permission.localNetwork";
const xml = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

async function updatePlist(
  path,
  value,
  property = "NSLocalNetworkUsageDescription",
) {
  const source = await readFile(path, "utf8");
  const entry = `<key>${property}</key><string>${xml(value)}</string>`;
  const next = source.includes(`<key>${property}</key>`)
    ? source.replace(
        new RegExp(`<key>${property}</key>\\s*<string>[\\s\\S]*?</string>`),
        entry,
      )
    : source.replace(/<\/dict>(\s*<\/plist>\s*)$/, `  ${entry}\n</dict>$1`);
  if (!next.includes(`<key>${property}</key>`)) {
    throw new Error("Invalid application Info.plist dictionary");
  }
  if (next !== source) await writeFile(path, next);
}

export async function generateMobilePermissions(
  destination = native,
  catalogs = resolve(native, "../../packages/localization/src/catalogs"),
  generatedPlist,
) {
  const translations = {};
  for (const locale of ["en", "de"]) {
    const catalog = JSON.parse(
      await readFile(resolve(catalogs, `${locale}.native.json`), "utf8"),
    );
    const value = catalog[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(
        `Missing native permission translation: ${locale}:${key}`,
      );
    }
    translations[locale] = value;
  }
  for (const [locale, value] of Object.entries(translations)) {
    const directory = resolve(
      destination,
      "ios-permissions",
      `${locale}.lproj`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "InfoPlist.strings"),
      `"NSLocalNetworkUsageDescription" = ${JSON.stringify(value)};\n`,
    );
  }
  await updatePlist(resolve(destination, "Info.plist"), translations.en);
  if (generatedPlist) await updatePlist(generatedPlist, translations.en);
}

export async function generateMacPermissions(
  destination = native,
  catalogs = resolve(native, "../../packages/localization/src/catalogs"),
) {
  const key = "native.dictation.permission.microphone";
  for (const locale of ["en", "de"]) {
    const catalog = JSON.parse(
      await readFile(resolve(catalogs, `${locale}.native.json`), "utf8"),
    );
    const value = catalog[key];
    if (typeof value !== "string" || !value.trim())
      throw new Error(
        `Missing native permission translation: ${locale}:${key}`,
      );
    const directory = resolve(
      destination,
      "macos-permissions",
      `${locale}.lproj`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "InfoPlist.strings"),
      `"NSMicrophoneUsageDescription" = ${JSON.stringify(value)};\n`,
    );
    if (locale === "en")
      await updatePlist(
        resolve(destination, "Info.macos.plist"),
        value,
        "NSMicrophoneUsageDescription",
      );
  }
}

export async function generateAndroidAuthResources(
  destination = resolve(
    native,
    "../../crates/tauri-plugin-provider-platform/android/src/main/res",
  ),
  catalogs = resolve(native, "../../packages/localization/src/catalogs"),
) {
  for (const locale of ["en", "de"]) {
    const catalog = JSON.parse(
      await readFile(resolve(catalogs, `${locale}.native.json`), "utf8"),
    );
    const entries = ["channel", "title", "body", "cancel"].map((name) => {
      const key = `native.ai.authForeground.${name}`;
      const value = catalog[key];
      if (typeof value !== "string" || !value.trim())
        throw new Error(
          `Missing native notification translation: ${locale}:${key}`,
        );
      const escaped = xml(
        value
          .replaceAll("\\", "\\\\")
          .replaceAll("'", "\\'")
          .replaceAll('"', '\\"')
          .replaceAll("\n", "\\n"),
      );
      return `    <string name="situate_provider_auth_${name}" formatted="false">${escaped}</string>`;
    });
    const directory = resolve(
      destination,
      locale === "en" ? "values" : `values-${locale}`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "provider-auth.xml"),
      `<resources>\n${entries.join("\n")}\n</resources>\n`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args[0] === "--macos" && args.length === 1) {
    await generateMacPermissions();
  } else if (args[0] === "--android" && args.length === 1) {
    await generateAndroidAuthResources();
  } else {
    if (args.length && (args.length !== 2 || args[0] !== "--plist")) {
      throw new Error(
        "Usage: generate-mobile-permissions.mjs [--macos | --android | --plist <generated-plist>]",
      );
    }
    await generateMobilePermissions(undefined, undefined, args[1]);
  }
}
