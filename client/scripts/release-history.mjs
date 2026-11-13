import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  canonical,
  catalogDigest,
  compileReleaseCatalog,
  validateReleaseForBuild,
  validatePreparedRelease,
} from "../../tools/release-catalog.mjs";

import { validateGeneratedCatalog } from "../../tools/release-inputs.mjs";

export const releaseHistoryAsset = "situate-release-history.json";
export const releaseHistoryBytes = (catalog) => `${canonical(catalog)}\n`;
export const releaseHistoryDigest = catalogDigest;
export const emptyReleaseHistory = (version) => ({
  schemaVersion: 1,
  installedVersion: version,
  releases: [],
});

export function releaseContent(catalog) {
  const current = catalog.releases.find(
    (item) => item.version === catalog.installedVersion,
  );
  if (catalog.schemaVersion !== 1 || !current)
    throw new Error("Release history must include the installed version.");
  const locales = Object.keys(current.locales).sort();
  if (
    !locales.length ||
    catalog.releases.some(
      (item) => !isDeepStrictEqual(Object.keys(item.locales).sort(), locales),
    )
  )
    throw new Error(
      "Release history locale inventory differs between versions.",
    );
  return {
    version: catalog.installedVersion,
    sha256: releaseHistoryDigest(catalog),
    locales,
  };
}

export function validateReleaseContent(value, version) {
  if (
    !value ||
    value.version !== version ||
    !/^[a-f0-9]{64}$/.test(value.sha256 ?? "") ||
    !Array.isArray(value.locales) ||
    !value.locales.length ||
    value.locales.some(
      (locale) =>
        typeof locale !== "string" ||
        !/^[a-z]{2}(?:-[A-Za-z0-9]+)*$/.test(locale),
    ) ||
    !isDeepStrictEqual(value.locales, [...new Set(value.locales)].sort())
  )
    throw new Error("Invalid release-content binding.");
}

export function verifyReleaseHistoryResource(
  app,
  expected,
  version,
  { macos = true, identity } = {},
) {
  const path = join(
    app,
    macos ? "Contents/Resources" : "",
    releaseHistoryAsset,
  );
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!stat) {
    if (
      expected !== undefined ||
      (identity && Object.hasOwn(identity, "releaseContent"))
    )
      throw new Error("Signed app is missing its release-history resource.");
    return; // Retained bundles created before release history have neither binding nor resource.
  }
  if (!expected)
    throw new Error("Manifest omits the signed app's release-content binding.");
  validateReleaseContent(expected, version);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 8 * 1024 * 1024
  )
    throw new Error("Release history must be a regular bundle resource.");
  const bytes = readFileSync(path, "utf8");
  const catalog = JSON.parse(bytes);
  if (
    bytes !== releaseHistoryBytes(catalog) ||
    catalog.installedVersion !== version ||
    !isDeepStrictEqual(releaseContent(catalog), expected) ||
    (identity && !isDeepStrictEqual(identity.releaseContent, expected))
  )
    throw new Error(
      "Signed release history does not match the manifest or app version.",
    );
  return catalog;
}

export async function compileBuildReleaseHistory(
  repoRoot,
  version,
  { distribution, environment = process.env } = {},
) {
  const generated = readBuildReleaseHistory(version, environment);
  if (generated) return generated;
  const catalog =
    distribution === "direct"
      ? validatePreparedRelease(repoRoot, version)
      : validateReleaseForBuild(repoRoot, version, { environment });
  releaseContent(catalog);
  return catalog;
}

export function readBuildReleaseHistory(version, environment = process.env) {
  if (
    !Object.hasOwn(environment, "SITUATE_RELEASE_HISTORY_FILE") &&
    !Object.hasOwn(environment, "SITUATE_RELEASE_HISTORY_SHA256")
  )
    return;
  if (
    !environment.SITUATE_RELEASE_HISTORY_FILE ||
    !/^[a-f0-9]{64}$/.test(environment.SITUATE_RELEASE_HISTORY_SHA256 ?? "")
  )
    throw new Error(
      "Apple builds require both the release-history file and its digest.",
    );
  const bytes = readFileSync(environment.SITUATE_RELEASE_HISTORY_FILE, "utf8");
  const catalog = JSON.parse(bytes);
  if (
    catalog.installedVersion !== version ||
    bytes !== releaseHistoryBytes(catalog) ||
    releaseHistoryDigest(catalog) !== environment.SITUATE_RELEASE_HISTORY_SHA256
  )
    throw new Error(
      "Frontend release history does not match the Apple build input.",
    );
  validateGeneratedCatalog(catalog, { version });
  releaseContent(catalog);
  return catalog;
}

export function releaseHistoryPlugin({
  repoRoot,
  version,
  environment = process.env,
  compile,
} = {}) {
  let catalog;
  return {
    name: "situate-release-history",
    async config() {
      if (
        Object.hasOwn(environment, "SITUATE_RELEASE_VERSION") &&
        (environment.SITUATE_RELEASE_VERSION !== version ||
          !environment.SITUATE_RELEASE_HISTORY_FILE)
      )
        throw new Error(
          "Generated release version requires its bound history input.",
        );
      if (
        Object.hasOwn(environment, "SITUATE_RELEASE_HISTORY_FILE") ||
        Object.hasOwn(environment, "SITUATE_RELEASE_HISTORY_SHA256")
      ) {
        catalog = readBuildReleaseHistory(version, environment);
      } else {
        catalog = emptyReleaseHistory(version);
        try {
          const candidate = await (
            compile ??
            ((root, installedVersion) =>
              compileReleaseCatalog(root, {
                version: installedVersion,
                requireCurrent: false,
                verifyGit: false,
              }))
          )(repoRoot, version);
          if (candidate.releases.some((item) => item.version === version))
            catalog = candidate;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      return {
        define: { __SITUATE_RELEASE_HISTORY__: JSON.stringify(catalog) },
      };
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: releaseHistoryAsset,
        source: releaseHistoryBytes(catalog),
      });
    },
  };
}
